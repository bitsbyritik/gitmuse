import type { Config, CommitMessage, DiffResult } from './types.js';

const COMMIT_TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

/**
 * Builds the LLM prompt from a staged diff and the active config.
 * All provider adapters receive this exact string.
 */
export function buildPrompt(diff: DiffResult, config: Config): string {
  const emojiLine = config.emoji
    ? 'Prefix the commit type with a relevant emoji (e.g. ✨ feat, 🐛 fix, 📚 docs).'
    : 'Do NOT use emoji anywhere in the message.';

  const langLine =
    config.language !== 'en'
      ? `Write the commit message in ${config.language}.`
      : '';

  return `You are an expert software engineer writing a git commit message.

Analyse the following staged diff and produce a single conventional commit message.

## Rules
- Format: <type>(<optional scope>): <short description>
- Valid types: ${COMMIT_TYPES.join(', ')}
- Subject line: 72 characters maximum, imperative mood ("add X", not "added X")
- ${emojiLine}
- For complex changes, add ONE blank line then a concise body (2–4 sentences max)
- Do NOT wrap the output in markdown fences or backticks
- Output ONLY the commit message — no explanation, no preamble
${langLine}

## Staged diff
Branch: ${diff.branch}

\`\`\`diff
${diff.diff}
\`\`\``;
}

/**
 * Parses the raw LLM response into a structured CommitMessage.
 * Trims whitespace and separates the subject from the optional body.
 */
export function parseCommitMessage(raw: string): CommitMessage {
  const trimmed = raw.trim();
  const newlineIndex = trimmed.indexOf('\n');

  if (newlineIndex === -1) {
    return { subject: trimmed, raw: trimmed };
  }

  const subject = trimmed.slice(0, newlineIndex).trim();
  const body = trimmed.slice(newlineIndex + 1).trim();

  return {
    subject,
    body: body || undefined,
    raw: trimmed,
  };
}
