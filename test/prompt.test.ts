import { describe, it, expect } from 'vitest';
import {
  buildPrompt,
  parseCommitMessage,
  applyTypeEmoji,
  normalizeCommitMessage,
  COMMIT_TYPES,
} from '../src/prompt.js';
import type { DiffResult, StagedFile } from '../src/types.js';
import { categorize } from '../src/classify.js';
import { DEFAULTS } from '../src/config.js';

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

function makeDiff(over: Partial<DiffResult> = {}): DiffResult {
  return {
    diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new',
    branch: 'feat/login',
    staged: true,
    lineCount: 5,
    files: [],
    insertions: 0,
    deletions: 0,
    trimmed: false,
    evidence: { notes: [] },
    ...over,
  };
}

const diff = makeDiff();

describe('buildPrompt', () => {
  it('includes the branch name', () => {
    const prompt = buildPrompt(diff, DEFAULTS);
    expect(prompt).toContain('feat/login');
  });

  it('includes the diff content', () => {
    const prompt = buildPrompt(diff, DEFAULTS);
    expect(prompt).toContain('+new');
  });

  it('instructs no emoji when emoji=false', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, emoji: false });
    expect(prompt).toContain('Do NOT use emoji');
  });

  it('instructs emoji when emoji=true', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, emoji: true });
    expect(prompt).toContain('emoji');
    expect(prompt).not.toContain('Do NOT use emoji');
  });

  it('lists every commit type with a selection rule', () => {
    const prompt = buildPrompt(diff, DEFAULTS);
    for (const { type, when } of COMMIT_TYPES) {
      expect(prompt).toContain(`\`${type}\``);
      expect(prompt).toContain(when);
    }
  });

  it('pairs each type with its emoji when emoji=true', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, emoji: true });
    for (const { type, emoji } of COMMIT_TYPES) {
      expect(prompt).toContain(`${emoji} \`${type}\``);
    }
  });

  it('omits type emoji from the guide when emoji=false', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, emoji: false });
    for (const { emoji } of COMMIT_TYPES) {
      expect(prompt).not.toContain(emoji);
    }
  });

  it('warns against defaulting to feat', () => {
    const prompt = buildPrompt(diff, DEFAULTS);
    expect(prompt).toContain('Never fall back to');
  });

  it('summarises every staged file with status, churn and kind', () => {
    const prompt = buildPrompt(
      makeDiff({
        files: [
          file('src/auth/login.ts', { status: 'added', insertions: 30, deletions: 0 }),
          file('README.md', { insertions: 4, deletions: 2 }),
          file('package-lock.json', { insertions: 900, deletions: 20, trimmed: true }),
        ],
        insertions: 934,
        deletions: 22,
        trimmed: true,
      }),
      DEFAULTS,
    );

    expect(prompt).toContain('3 files changed, +934 −22');
    expect(prompt).toContain('- A  src/auth/login.ts  +30 −0  [source]');
    expect(prompt).toContain('- M  README.md  +4 −2  [docs]');
    expect(prompt).toContain('[deps, diff trimmed]');
    // The model must trust the summary over the (trimmed) diff
    expect(prompt).toContain('the diff below may be trimmed');
  });

  it('shows renames as old → new and binaries as binary', () => {
    const prompt = buildPrompt(
      makeDiff({
        files: [
          file('src/new.ts', { status: 'renamed', oldPath: 'src/old.ts' }),
          file('assets/logo.png', { binary: true }),
        ],
      }),
      DEFAULTS,
    );

    expect(prompt).toContain('- R  src/old.ts → src/new.ts');
    expect(prompt).toContain('- M  assets/logo.png  binary  [asset]');
  });

  it('passes the inferred type, scope and notes to the model', () => {
    const prompt = buildPrompt(
      makeDiff({
        files: [file('README.md')],
        evidence: {
          suggestedType: 'docs',
          reason: 'every changed file is documentation → `docs`',
          suggestedScope: 'auth',
          notes: ['1 new file added: README.md'],
        },
      }),
      DEFAULTS,
    );

    expect(prompt).toContain('What the changed files already tell you');
    expect(prompt).toContain('use `docs` unless the diff clearly shows otherwise');
    expect(prompt).toContain('likely scope: `auth`');
    expect(prompt).toContain('1 new file added: README.md');
  });

  it('omits both sections when there is nothing to report', () => {
    const prompt = buildPrompt(diff, DEFAULTS);
    expect(prompt).not.toContain('Change summary');
    expect(prompt).not.toContain('What the changed files already tell you');
  });

  it('includes language instruction for non-English', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, language: 'fr' });
    expect(prompt).toContain('fr');
  });

  it('omits language instruction for English', () => {
    const prompt = buildPrompt(diff, { ...DEFAULTS, language: 'en' });
    // Should not have a language instruction line
    expect(prompt).not.toContain('Write the commit message in en');
  });
});

describe('parseCommitMessage', () => {
  it('parses a subject-only message', () => {
    const result = parseCommitMessage('feat: add login');
    expect(result.subject).toBe('feat: add login');
    expect(result.body).toBeUndefined();
    expect(result.raw).toBe('feat: add login');
  });

  it('parses subject + body', () => {
    const raw = 'feat: add login\n\nThis adds the login endpoint with JWT support.';
    const result = parseCommitMessage(raw);
    expect(result.subject).toBe('feat: add login');
    expect(result.body).toBe('This adds the login endpoint with JWT support.');
  });

  it('trims leading/trailing whitespace', () => {
    const result = parseCommitMessage('  feat: add login  ');
    expect(result.subject).toBe('feat: add login');
  });

  it('handles blank body lines gracefully', () => {
    const result = parseCommitMessage('feat: add login\n\n\n');
    expect(result.body).toBeUndefined();
  });
});

describe('applyTypeEmoji', () => {
  it('gives each type its own emoji', () => {
    expect(applyTypeEmoji('fix: correct off-by-one', true)).toBe('🐛 fix: correct off-by-one');
    expect(applyTypeEmoji('docs: update README', true)).toBe('📝 docs: update README');
    expect(applyTypeEmoji('refactor: split engine', true)).toBe('♻️ refactor: split engine');
    expect(applyTypeEmoji('feat: add login', true)).toBe('✨ feat: add login');
  });

  it('replaces a wrong emoji with the one for the parsed type', () => {
    expect(applyTypeEmoji('✨ fix: correct off-by-one', true)).toBe('🐛 fix: correct off-by-one');
    expect(applyTypeEmoji('✨ chore(deps): bump vitest', true)).toBe('🔧 chore(deps): bump vitest');
  });

  it('keeps scope and breaking-change marker', () => {
    expect(applyTypeEmoji('feat(api)!: drop v1 routes', true)).toBe('✨ feat(api)!: drop v1 routes');
  });

  it('strips emoji when emoji are disabled', () => {
    expect(applyTypeEmoji('✨ feat: add login', false)).toBe('feat: add login');
    expect(applyTypeEmoji('fix: 🐛 correct parsing', false)).toBe('fix: correct parsing');
  });

  it('normalises the type case', () => {
    expect(applyTypeEmoji('Fix: correct parsing', false)).toBe('fix: correct parsing');
  });

  it('leaves unknown types alone', () => {
    expect(applyTypeEmoji('wip: something', true)).toBe('wip: something');
    expect(applyTypeEmoji('just a sentence', true)).toBe('just a sentence');
  });
});

describe('normalizeCommitMessage', () => {
  it('fixes the emoji and keeps the body', () => {
    const result = normalizeCommitMessage('✨ fix: handle null user\n\nGuards the lookup.', true);
    expect(result.subject).toBe('🐛 fix: handle null user');
    expect(result.body).toBe('Guards the lookup.');
    expect(result.raw).toBe('🐛 fix: handle null user\n\nGuards the lookup.');
  });

  it('strips markdown fences the model added', () => {
    const result = normalizeCommitMessage('```\ndocs: update README\n```', true);
    expect(result.subject).toBe('📝 docs: update README');
  });

  it('removes emoji the model added despite emoji being off', () => {
    expect(normalizeCommitMessage('✨ test: cover retry path', false).raw).toBe(
      'test: cover retry path',
    );
  });
});
