import { describe, it, expect } from 'vitest';
import { categorize, inferEvidence, inferScope, isNoise } from '../src/classify.js';
import type { FileCategory, StagedFile } from '../src/types.js';

/** Builds a StagedFile with the category the classifier would pick. */
function file(path: string, over: Partial<StagedFile> = {}): StagedFile {
  return {
    path,
    status: 'modified',
    insertions: 3,
    deletions: 1,
    binary: false,
    category: categorize(path),
    ...over,
  };
}

describe('categorize', () => {
  const cases: [string, FileCategory][] = [
    ['src/engine.ts', 'source'],
    ['bin/cli.ts', 'source'],
    ['test/git.test.ts', 'test'],
    ['src/prompt.test.ts', 'test'],
    ['internal/server_test.go', 'test'],
    ['spec/models/user_spec.rb', 'test'],
    ['README.md', 'docs'],
    ['docs/usage.mdx', 'docs'],
    ['LICENSE', 'docs'],
    ['CONTRIBUTING.md', 'docs'],
    ['package-lock.json', 'deps'],
    ['pnpm-lock.yaml', 'deps'],
    ['package.json', 'deps'],
    ['go.mod', 'deps'],
    ['requirements-dev.txt', 'deps'],
    ['.github/workflows/ci.yml', 'ci'],
    ['.gitlab-ci.yml', 'ci'],
    ['Jenkinsfile', 'ci'],
    ['dist/cli.js', 'generated'],
    ['coverage/lcov.info', 'generated'],
    ['src/app.min.js', 'generated'],
    ['test/__snapshots__/app.snap', 'generated'],
    ['assets/logo.png', 'asset'],
    ['fonts/inter.woff2', 'asset'],
    ['tsconfig.json', 'config'],
    ['.prettierrc', 'config'],
    ['.gitignore', 'config'],
    ['vitest.config.ts', 'config'],
    ['Dockerfile', 'config'],
  ];

  for (const [path, expected] of cases) {
    it(`classifies ${path} as ${expected}`, () => {
      expect(categorize(path)).toBe(expected);
    });
  }
});

describe('isNoise', () => {
  it('treats lockfiles, build output, assets and binaries as noise', () => {
    expect(isNoise(file('package-lock.json'))).toBe(true);
    expect(isNoise(file('dist/cli.js'))).toBe(true);
    expect(isNoise(file('assets/logo.png'))).toBe(true);
    expect(isNoise(file('src/x.ts', { binary: true }))).toBe(true);
  });

  it('keeps source, tests, docs and config', () => {
    expect(isNoise(file('src/engine.ts'))).toBe(false);
    expect(isNoise(file('test/git.test.ts'))).toBe(false);
    expect(isNoise(file('README.md'))).toBe(false);
    expect(isNoise(file('tsconfig.json'))).toBe(false);
  });
});

describe('inferScope', () => {
  it('uses the shared directory for several files', () => {
    expect(inferScope([file('src/adapters/ollama.ts'), file('src/adapters/groq.ts')])).toBe(
      'adapters',
    );
  });

  it('walks past meaningless segments like src/', () => {
    expect(inferScope([file('src/engine.ts'), file('src/git.ts')])).toBeUndefined();
  });

  it('uses the file name when only one file changed at the top of a tree', () => {
    expect(inferScope([file('src/git.ts')])).toBe('git');
  });

  it('uses the directory for a single nested file', () => {
    expect(inferScope([file('src/agents/claude-code.ts')])).toBe('agents');
  });

  it('ignores lockfiles when guessing scope', () => {
    expect(inferScope([file('src/auth/login.ts'), file('package-lock.json')])).toBe('auth');
  });
});

describe('inferEvidence', () => {
  it('pins docs-only changes', () => {
    const evidence = inferEvidence([file('README.md'), file('docs/usage.md')]);
    expect(evidence.suggestedType).toBe('docs');
    expect(evidence.reason).toContain('documentation');
  });

  it('pins test-only, ci-only, deps-only and config-only changes', () => {
    expect(inferEvidence([file('test/a.test.ts')]).suggestedType).toBe('test');
    expect(inferEvidence([file('.github/workflows/ci.yml')]).suggestedType).toBe('ci');
    expect(inferEvidence([file('package-lock.json')]).suggestedType).toBe('build');
    expect(inferEvidence([file('tsconfig.json')]).suggestedType).toBe('chore');
  });

  it('treats dependency + build config together as build', () => {
    expect(
      inferEvidence([file('package.json'), file('tsup.config.ts')]).suggestedType,
    ).toBe('build');
  });

  it('claims nothing for a mixed source change, but says tests came along', () => {
    const evidence = inferEvidence([file('src/auth.ts'), file('test/auth.test.ts')]);
    expect(evidence.suggestedType).toBeUndefined();
    expect(evidence.notes.join(' ')).toContain('source and tests changed together');
  });

  it('ignores build output when deciding the type', () => {
    const evidence = inferEvidence([file('README.md'), file('dist/cli.js')]);
    expect(evidence.suggestedType).toBe('docs');
  });

  it('calls a pure move a refactor', () => {
    const evidence = inferEvidence([
      file('src/new/a.ts', { status: 'renamed', oldPath: 'src/old/a.ts', insertions: 0, deletions: 0 }),
    ]);
    expect(evidence.suggestedType).toBe('refactor');
    expect(evidence.notes.join(' ')).toContain('no content change');
  });

  it('reports added and deleted files', () => {
    const evidence = inferEvidence([
      file('src/a.ts', { status: 'added' }),
      file('src/b.ts', { status: 'deleted' }),
    ]);
    const notes = evidence.notes.join(' ');
    expect(notes).toContain('1 new file added: src/a.ts');
    expect(notes).toContain('1 file deleted: src/b.ts');
  });

  it('warns not to describe the noise', () => {
    const evidence = inferEvidence([file('src/a.ts'), file('package-lock.json')]);
    expect(evidence.notes.join(' ')).toContain('noise');
  });

  it('returns empty evidence for no files', () => {
    expect(inferEvidence([])).toEqual({ notes: [] });
  });
});
