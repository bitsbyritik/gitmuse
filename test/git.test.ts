import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseCommitMessage } from '../src/prompt.js';

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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isGitRepo', () => {
  it('returns true when git rev-parse exits 0', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '.git', stderr: '', pid: 1, output: [], signal: null });
    expect(isGitRepo()).toBe(true);
  });

  it('returns false when git rev-parse exits non-zero', () => {
    mockedSpawnSync.mockReturnValue({ status: 128, stdout: '', stderr: '', pid: 1, output: [], signal: null });
    expect(isGitRepo()).toBe(false);
  });
});

describe('getStagedDiff', () => {
  it('throws NoStagedChangesError when diff is empty', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '.git', stderr: '', pid: 1, output: [], signal: null });
    mockedExecSync.mockReturnValueOnce('');  // diff --cached returns empty
    expect(() => getStagedDiff(200)).toThrow(NoStagedChangesError);
  });

  it('throws NotAGitRepoError when not in git repo', () => {
    mockedSpawnSync.mockReturnValue({ status: 128, stdout: '', stderr: '', pid: 1, output: [], signal: null });
    expect(() => getStagedDiff(200)).toThrow(NotAGitRepoError);
  });

  it('truncates diffs longer than maxLines', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '.git', stderr: '', pid: 1, output: [], signal: null });
    const longDiff = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    mockedExecSync
      .mockReturnValueOnce(longDiff)   // git diff --cached
      .mockReturnValueOnce('main');    // git rev-parse --abbrev-ref HEAD

    const result = getStagedDiff(100);
    expect(result.diff).toContain('truncated');
    expect(result.diff.split('\n').length).toBeLessThan(110);
  });

  it('returns full diff when under maxLines', () => {
    mockedSpawnSync.mockReturnValue({ status: 0, stdout: '.git', stderr: '', pid: 1, output: [], signal: null });
    const smallDiff = 'diff --git a/foo.ts b/foo.ts\n+added line';
    mockedExecSync
      .mockReturnValueOnce(smallDiff)
      .mockReturnValueOnce('main');

    const result = getStagedDiff(200);
    expect(result.diff).toBe(smallDiff);
    expect(result.staged).toBe(true);
  });
});

describe('getCurrentBranch', () => {
  it('returns branch name on success', () => {
    mockedExecSync.mockReturnValue('feature/auth\n');
    expect(getCurrentBranch()).toBe('feature/auth');
  });

  it('returns HEAD on error', () => {
    mockedExecSync.mockImplementation(() => { throw new Error('not a repo'); });
    expect(getCurrentBranch()).toBe('HEAD');
  });
});
