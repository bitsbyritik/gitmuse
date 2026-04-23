import { describe, it, expect } from 'vitest';
import { buildPrompt, parseCommitMessage } from '../src/prompt.js';
import type { DiffResult } from '../src/types.js';
import { DEFAULTS } from '../src/config.js';

const diff: DiffResult = {
  diff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new',
  branch: 'feat/login',
  staged: true,
  lineCount: 5,
};

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
