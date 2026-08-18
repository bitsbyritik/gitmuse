import { describe, it, expect, vi, beforeEach } from 'vitest';

// git.ts uses child_process — mock it to avoid needing a real git repo in CI
vi.mock('child_process', () => ({
  execSync: vi.fn(),
  spawnSync: vi.fn(),
}));

import { execSync, spawnSync } from 'child_process';
import { getStagedDiff, isGitRepo, getCurrentBranch } from '../src/git.js';
import { NoStagedChangesError, NotAGitRepoError } from '../src/errors.js';

const mockedExecSync = vi.mocked(execSync);
const mockedSpawnSync = vi.mocked(spawnSync);

const inRepo = (): void => {
  mockedSpawnSync.mockReturnValue({
    status: 0,
    stdout: '.git',
    stderr: '',
    pid: 1,
    output: [],
    signal: null,
  });
};

/** Answers each git command by what it asks for, not by call order. */
function mockGit(parts: { nameStatus?: string; numstat?: string; diff?: string; branch?: string }): void {
  mockedExecSync.mockImplementation((command: string) => {
    if (command.includes('--name-status')) return parts.nameStatus ?? '';
    if (command.includes('--numstat')) return parts.numstat ?? '';
    if (command.includes('--abbrev-ref')) return `${parts.branch ?? 'main'}\n`;
    if (command.includes('diff --cached')) return parts.diff ?? '';
    return '';
  });
}

const section = (path: string, bodyLines: number): string =>
  [
    `diff --git a/${path} b/${path}`,
    'index 111..222 100644',
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1,3 +1,4 @@',
    ...Array.from({ length: bodyLines }, (_, i) => `+line ${String(i)}`),
  ].join('\n');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isGitRepo', () => {
  it('returns true when git rev-parse exits 0', () => {
    inRepo();
    expect(isGitRepo()).toBe(true);
  });

  it('returns false when git rev-parse exits non-zero', () => {
    mockedSpawnSync.mockReturnValue({
      status: 128,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    expect(isGitRepo()).toBe(false);
  });
});

describe('getStagedDiff', () => {
  it('throws NoStagedChangesError when nothing is staged', () => {
    inRepo();
    mockGit({ nameStatus: '' });
    expect(() => getStagedDiff(200)).toThrow(NoStagedChangesError);
  });

  it('throws NotAGitRepoError when not in a git repo', () => {
    mockedSpawnSync.mockReturnValue({
      status: 128,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    expect(() => getStagedDiff(200)).toThrow(NotAGitRepoError);
  });

  it('reads status, churn and category for every staged file', () => {
    inRepo();
    mockGit({
      nameStatus: [
        'A\tsrc/auth/login.ts',
        'M\tREADME.md',
        'D\tsrc/legacy.ts',
        'R087\tsrc/deep/old.ts\tsrc/deep/new.ts',
      ].join('\n'),
      numstat: [
        '30\t0\tsrc/auth/login.ts',
        '4\t2\tREADME.md',
        '0\t40\tsrc/legacy.ts',
        '1\t1\tsrc/deep/{old.ts => new.ts}',
      ].join('\n'),
      diff: section('src/auth/login.ts', 3),
      branch: 'feat/login',
    });

    const result = getStagedDiff(200);

    expect(result.files).toHaveLength(4);
    expect(result.branch).toBe('feat/login');
    expect(result.insertions).toBe(35);
    expect(result.deletions).toBe(43);

    const added = result.files.find((f) => f.path === 'src/auth/login.ts');
    expect(added).toMatchObject({ status: 'added', insertions: 30, category: 'source' });

    expect(result.files.find((f) => f.path === 'README.md')).toMatchObject({
      status: 'modified',
      category: 'docs',
    });
    expect(result.files.find((f) => f.path === 'src/legacy.ts')).toMatchObject({
      status: 'deleted',
      deletions: 40,
    });

    // Rename: numstat compresses the path, we resolve it back to the new one
    expect(result.files.find((f) => f.path === 'src/deep/new.ts')).toMatchObject({
      status: 'renamed',
      oldPath: 'src/deep/old.ts',
      insertions: 1,
      deletions: 1,
    });
  });

  it('marks binary files instead of counting lines', () => {
    inRepo();
    mockGit({
      nameStatus: 'M\tassets/logo.png',
      numstat: '-\t-\tassets/logo.png',
      diff: 'diff --git a/assets/logo.png b/assets/logo.png\nBinary files differ',
    });

    const [file] = getStagedDiff(200).files;
    expect(file).toMatchObject({ binary: true, category: 'asset', insertions: 0 });
  });

  it('omits lockfile diffs so the source change keeps the budget', () => {
    inRepo();
    mockGit({
      nameStatus: 'M\tpackage-lock.json\nM\tsrc/git.ts',
      numstat: '4000\t3000\tpackage-lock.json\n5\t1\tsrc/git.ts',
      diff: `${section('package-lock.json', 400)}\n${section('src/git.ts', 5)}`,
    });

    const result = getStagedDiff(200);

    expect(result.diff).toContain('[diff omitted — deps file');
    expect(result.diff).not.toContain('+line 300');
    // the source file survives in full
    expect(result.diff).toContain('+++ b/src/git.ts');
    expect(result.diff).toContain('+line 4');
    expect(result.trimmed).toBe(true);
  });

  it('shares the budget between files instead of truncating at the head', () => {
    inRepo();
    mockGit({
      nameStatus: 'M\tsrc/a.ts\nM\tsrc/b.ts',
      numstat: '100\t0\tsrc/a.ts\n100\t0\tsrc/b.ts',
      diff: `${section('src/a.ts', 100)}\n${section('src/b.ts', 100)}`,
    });

    const result = getStagedDiff(60);

    // Both files are represented — the second one is not pushed out entirely
    expect(result.diff).toContain('+++ b/src/a.ts');
    expect(result.diff).toContain('+++ b/src/b.ts');
    expect(result.diff).toContain('more diff lines trimmed');
    expect(result.files.every((f) => f.trimmed)).toBe(true);
  });

  it('keeps a small diff untouched', () => {
    inRepo();
    const diff = section('src/foo.ts', 2);
    mockGit({ nameStatus: 'M\tsrc/foo.ts', numstat: '2\t0\tsrc/foo.ts', diff });

    const result = getStagedDiff(200);
    expect(result.diff).toBe(diff);
    expect(result.trimmed).toBe(false);
    expect(result.staged).toBe(true);
  });

  it('carries the inferred evidence', () => {
    inRepo();
    mockGit({
      nameStatus: 'M\tREADME.md\nM\tdocs/usage.md',
      numstat: '3\t1\tREADME.md\n2\t0\tdocs/usage.md',
      diff: section('README.md', 3),
    });

    expect(getStagedDiff(200).evidence.suggestedType).toBe('docs');
  });
});

describe('getCurrentBranch', () => {
  it('returns branch name on success', () => {
    mockedExecSync.mockReturnValue('feature/auth\n');
    expect(getCurrentBranch()).toBe('feature/auth');
  });

  it('returns HEAD on error', () => {
    mockedExecSync.mockImplementation(() => {
      throw new Error('not a repo');
    });
    expect(getCurrentBranch()).toBe('HEAD');
  });
});
