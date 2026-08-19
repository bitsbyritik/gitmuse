import type { Config, CommitMessage, DiffResult, FileStatus } from './types.js';

export interface CommitTypeSpec {
  /** Conventional-commit type token. */
  type: string;
  /** Gitmoji used when emoji output is enabled. */
  emoji: string;
  /** Selection rule shown to the model — when this type is the right one. */
  when: string;
}

/**
 * The conventional-commit types gitmuse accepts, each paired with the single
 * emoji that represents it. The emoji is decided here, never by the model —
 * see applyTypeEmoji().
 */
export const COMMIT_TYPES: readonly CommitTypeSpec[] = [
  { type: 'feat', emoji: '✨', when: 'introduces a capability that did not exist before' },
  { type: 'fix', emoji: '🐛', when: 'corrects behaviour that was broken or wrong' },
  { type: 'docs', emoji: '📝', when: 'touches only docs, README, comments or examples' },
  { type: 'style', emoji: '💄', when: 'formatting, whitespace or naming only — no logic change' },
  { type: 'refactor', emoji: '♻️', when: 'restructures code without changing behaviour' },
  { type: 'perf', emoji: '⚡️', when: 'makes existing behaviour faster or lighter' },
  { type: 'test', emoji: '✅', when: 'adds or changes tests only' },
  { type: 'build', emoji: '📦', when: 'changes dependencies, bundler or build config' },
  { type: 'ci', emoji: '👷', when: 'changes CI workflows, pipelines or release automation' },
  { type: 'chore', emoji: '🔧', when: 'tooling, config or housekeeping that fits nothing above' },
  { type: 'revert', emoji: '⏪️', when: 'reverts a previous commit' },
];

const EMOJI_BY_TYPE = new Map(COMMIT_TYPES.map((t) => [t.type, t.emoji]));

export const COMMIT_TYPE_NAMES = COMMIT_TYPES.map((t) => t.type);

/** `<type>(<scope>)!: <description>` — scope, `!` and emoji prefix are optional. */
const SUBJECT_PATTERN = /^([a-zA-Z]+)(\([^)]*\))?(!)?:\s*(.+)$/;

/** Any pictographic character, variation selector or ZWJ used to build emoji. */
const EMOJI_CHARS = /[\p{Extended_Pictographic}\uFE0F\u200D]/gu;

/** Markdown fences models add despite being told not to. */
const FENCE_PATTERN = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/;

/**
 * Builds the LLM prompt from a staged diff and the active config.
 * All provider adapters receive this exact string.
 */
const STATUS_LETTER: Record<FileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  typechange: 'T',
  unknown: '?',
};

/**
 * The facts about the change, stated before any code. The diff can be trimmed
 * to fit the budget; this list never is, so it is what the model should trust
 * about *which* files changed.
 */
function renderChangeSummary(diff: DiffResult): string {
  if (diff.files.length === 0) return '';

  const rows = diff.files.map((file) => {
    const name = file.oldPath ? `${file.oldPath} → ${file.path}` : file.path;
    const churn = file.binary
      ? 'binary'
      : `+${String(file.insertions)} −${String(file.deletions)}`;
    const tags = [file.category, file.trimmed ? 'diff trimmed' : ''].filter(Boolean);
    return `- ${STATUS_LETTER[file.status]}  ${name}  ${churn}  [${tags.join(', ')}]`;
  });

  const plural = diff.files.length === 1 ? 'file' : 'files';

  return `
## Change summary (complete — the diff below may be trimmed)
${String(diff.files.length)} ${plural} changed, +${String(diff.insertions)} −${String(diff.deletions)}
${rows.join('\n')}
`;
}

/** What the file list alone already proves, so the model does not have to guess it. */
function renderEvidence(diff: DiffResult): string {
  const { suggestedType, reason, suggestedScope, notes } = diff.evidence;
  const lines: string[] = [];

  if (suggestedType && reason) {
    lines.push(
      `- ${reason} — use \`${suggestedType}\` unless the diff clearly shows otherwise`,
    );
  }
  if (suggestedScope) {
    lines.push(`- likely scope: \`${suggestedScope}\` — use it only if it fits the change`);
  }
  for (const note of notes) lines.push(`- ${note}`);

  if (lines.length === 0) return '';

  return `
## What the changed files already tell you
${lines.join('\n')}
`;
}

/** Longest correction we will pass through — well past a sentence, short of a novel. */
const MAX_HINT_LENGTH = 500;

/**
 * The developer's correction, placed after the diff.
 *
 * Last position on purpose: the diff can run to hundreds of lines, and an
 * instruction buried above it competes with everything that follows. Models
 * weight the final instruction most heavily, which is exactly what a correction
 * needs.
 */
function renderHint(hint: string | undefined): string {
  const text = hint?.trim().slice(0, MAX_HINT_LENGTH);
  if (!text) return '';

  return `

## Correction from the developer — this overrides the guidance above
Your previous message was not what they wanted. They said:

"${text}"

Rewrite the commit message so it follows this instruction exactly, while still
obeying the format rules. Output ONLY the new commit message.`;
}

export function buildPrompt(diff: DiffResult, config: Config, hint?: string): string {
  const useEmoji = config.emoji;

  const typeGuide = COMMIT_TYPES.map((t) =>
    useEmoji ? `- ${t.emoji} \`${t.type}\` — ${t.when}` : `- \`${t.type}\` — ${t.when}`,
  ).join('\n');

  const emojiRules = useEmoji
    ? `- Start the subject with the emoji listed above for the type you chose, then a space — e.g. \`🐛 fix(auth): reject expired tokens\`
- Each type has exactly ONE emoji. Never reuse ✨ for a non-feat commit and never invent a different emoji`
    : '- Do NOT use emoji anywhere in the message.';

  const examples = (
    useEmoji
      ? [
          '🐛 fix(auth): reject expired refresh tokens',
          '📝 docs: document the config command',
          '♻️ refactor(engine): extract retry loop into a helper',
          '✨ feat(cli): add --dry-run flag',
        ]
      : [
          'fix(auth): reject expired refresh tokens',
          'docs: document the config command',
          'refactor(engine): extract retry loop into a helper',
          'feat(cli): add --dry-run flag',
        ]
  ).join('\n');

  const langLine =
    config.language !== 'en' ? `Write the commit message in ${config.language}.` : '';

  return `You are an expert software engineer writing a git commit message.

Analyse the staged changes below and produce a single conventional commit message.
${renderChangeSummary(diff)}${renderEvidence(diff)}
## Step 1 — choose the type (the most important decision)
Pick the ONE type that matches what this diff actually does:
${typeGuide}

Type selection rules — follow them strictly:
- Most commits are NOT features. Only use \`feat\` when the diff lets a user do something they could not do before
- Only \`.md\`/docs files changed → \`docs\`. Only tests changed → \`test\`
- Only \`package.json\`, lockfiles or bundler config → \`build\`. Only \`.github/workflows\` or CI config → \`ci\`
- Code moved, renamed, extracted or simplified with the same behaviour → \`refactor\`
- A corrected condition, off-by-one, crash, wrong output or bad error handling → \`fix\`
- If two types could fit, pick the more specific one. Never fall back to \`feat\` because you are unsure

## Step 2 — write the message
- Format: <type>(<optional scope>): <short description>
- Subject line: 72 characters maximum, imperative mood ("add X", not "added X")
- Describe what changed in the code, never the file list itself
${emojiRules}
- For complex changes, add ONE blank line then a concise body (2–4 sentences max)
- Do NOT wrap the output in markdown fences or backticks
- Output ONLY the commit message — no explanation, no preamble
${langLine}

## Example subjects
${examples}

## Staged diff
Branch: ${diff.branch}

\`\`\`diff
${diff.diff}
\`\`\`${renderHint(hint)}`;
}

/**
 * Forces the subject's emoji to match its commit type.
 *
 * Models — small local ones especially — reuse one emoji for every commit or
 * emit emoji even when asked not to. Rather than trusting the output, any emoji
 * in the subject is stripped and the canonical emoji for the parsed type is
 * re-applied (or omitted when `useEmoji` is false). Subjects that are not
 * conventional commits, or use an unknown type, are left untouched apart from
 * emoji removal when emoji are disabled.
 */
export function applyTypeEmoji(subject: string, useEmoji: boolean): string {
  const bare = subject.replace(EMOJI_CHARS, '').replace(/\s+/g, ' ').trim();
  const match = SUBJECT_PATTERN.exec(bare);

  if (!match) return useEmoji ? subject.trim() : bare;

  const [, rawType, scope, bang, description] = match;
  const type = rawType?.toLowerCase() ?? '';
  const emoji = EMOJI_BY_TYPE.get(type);

  if (!emoji || !description) return useEmoji ? subject.trim() : bare;

  const line = `${type}${scope ?? ''}${bang ?? ''}: ${description.trim()}`;
  return useEmoji ? `${emoji} ${line}` : line;
}

/**
 * Parses the raw LLM response into a structured CommitMessage.
 * Strips markdown fences, trims whitespace, and separates subject from body.
 */
export function parseCommitMessage(raw: string): CommitMessage {
  const fenced = FENCE_PATTERN.exec(raw.trim());
  const trimmed = (fenced?.[1] ?? raw).trim();
  const newlineIndex = trimmed.indexOf('\n');

  if (newlineIndex === -1) {
    return { subject: trimmed, raw: trimmed };
  }

  const subject = trimmed.slice(0, newlineIndex).trim();
  const body = trimmed.slice(newlineIndex + 1).trim();

  return {
    subject,
    body: body || undefined,
    raw: body ? `${subject}\n\n${body}` : subject,
  };
}

/**
 * Parses a raw LLM response and normalises the subject's emoji to match its
 * commit type. This is what the engine commits — parseCommitMessage alone
 * trusts whatever the model produced.
 */
export function normalizeCommitMessage(raw: string, useEmoji: boolean): CommitMessage {
  const parsed = parseCommitMessage(raw);
  const subject = applyTypeEmoji(parsed.subject, useEmoji);

  return {
    subject,
    body: parsed.body,
    raw: parsed.body ? `${subject}\n\n${parsed.body}` : subject,
  };
}
