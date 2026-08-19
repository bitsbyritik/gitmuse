import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execaSync } from 'execa';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import type { DiffResult, TuiResult } from './types.js';
import { askSelect, askText } from './ui.js';
import { isTty, terminalColumns } from './tty.js';

const noColor = Boolean(process.env['NO_COLOR']);
const paint = (text: string, fn: (s: string) => string): string => (noColor ? text : fn(text));

/** Every action the menu offers. Only commit/retry/abort escape to the engine. */
type MenuAction = 'commit' | 'subject' | 'editor' | 'retry' | 'hint' | 'diff' | 'abort';

/**
 * Pipes an async token stream to stdout in real time.
 * Returns the full accumulated message string.
 *
 * Nothing is written before the first token arrives. The spinner stops on that
 * same token, and ora clears whichever line the cursor is on — so emitting even
 * a newline first would send it to clear the blank line below its own frame and
 * strand "Asking gemini…" on screen.
 */
export async function streamToTerminal(tokenStream: AsyncIterable<string>): Promise<string> {
  let full = '';

  for await (const token of tokenStream) {
    full += token;
    process.stdout.write(token);
  }

  if (full) process.stdout.write('\n');
  return full;
}

/** Emoji and CJK occupy two columns; everything else counts as one. */
const WIDE = /[\p{Extended_Pictographic}ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/u;

function displayWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    // Zero-width joiners and variation selectors add no columns of their own.
    if (char === '\u200D' || char === '\uFE0F') continue;
    width += WIDE.test(char) ? 2 : 1;
  }
  return width;
}

/** How many terminal rows `text` occupies once wrapped at the current width. */
function renderedRows(text: string): number {
  const columns = terminalColumns();
  if (columns <= 0) return 0;

  return text
    .split('\n')
    .reduce((rows, line) => rows + Math.max(1, Math.ceil(displayWidth(line) / columns)), 0);
}

/**
 * Erases the streamed draft.
 *
 * The tokens are streamed raw so generation feels live, but what gets committed
 * is the *normalised* message — the emoji is rewritten to match the commit type,
 * so the draft on screen is not always what git will record. Clearing it means
 * the message is shown once, and shown correctly.
 */
export function eraseStreamed(text: string): boolean {
  if (!isTty(process.stdout)) return false;

  const rows = renderedRows(text);
  if (rows <= 0) return false;

  // Up to the first line of the draft, then clear everything below.
  process.stdout.write(`\u001B[${String(rows)}A\u001B[0J`);
  return true;
}

/** Opens $EDITOR with the current message. Returns the saved content, or the original on failure. */
function openInEditor(initial: string): string {
  const editor =
    process.env['EDITOR'] ??
    process.env['VISUAL'] ??
    (process.platform === 'win32' ? 'notepad' : 'nano');

  const tmpFile = join(tmpdir(), `gitmuse-${randomUUID()}.txt`);
  writeFileSync(tmpFile, initial, 'utf8');

  const result = execaSync(editor, [tmpFile], { stdio: 'inherit', reject: false });

  let edited = initial;
  try {
    edited = readFileSync(tmpFile, 'utf8').trim();
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // best-effort cleanup
    }
  }

  if (result.failed) return initial;
  return edited;
}

/** Colours a unified diff the way git does. */
function colourDiff(diff: string): string {
  if (noColor) return diff;

  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return chalk.bold(line);
      if (line.startsWith('diff --git')) return chalk.bold.white(line);
      if (line.startsWith('@@')) return chalk.cyan(line);
      if (line.startsWith('[')) return chalk.yellow(line);
      if (line.startsWith('+')) return chalk.green(line);
      if (line.startsWith('-')) return chalk.red(line);
      return chalk.dim(line);
    })
    .join('\n');
}

/**
 * Shows the diff gitmuse actually sent — trimming and all — so what the model
 * saw is inspectable, not a black box. Uses the user's pager when there is one.
 */
function showDiff(diff: DiffResult): void {
  const header = [
    `  ${String(diff.files.length)} file(s) staged  +${String(diff.insertions)} −${String(diff.deletions)}  on ${diff.branch}`,
    diff.trimmed
      ? '  Trimmed to fit the model — noisy files are summarised, not sent in full.'
      : '  Sent to the model in full.',
    '',
  ].join('\n');

  const body = `${header}${colourDiff(diff.diff)}\n`;
  const pager = process.env['GIT_PAGER'] ?? process.env['PAGER'];

  if (isTty(process.stdout)) {
    // -F exits immediately for a short diff, -R keeps the colours, -X leaves the
    // output on screen instead of wiping it on quit.
    const [command, ...args] = pager ? pager.split(' ') : ['less', '-FRX'];
    if (command) {
      const result = execaSync(command, args, {
        input: body,
        stdio: ['pipe', 'inherit', 'inherit'],
        reject: false,
      });
      if (!result.failed) return;
    }
  }

  console.log(body);
}

/** The generated message, framed. */
export function showMessage(message: string): void {
  const border = noColor ? '---' : chalk.dim('─'.repeat(Math.min(terminalColumns(60), 60)));
  console.log(border);
  console.log(paint(message, chalk.cyan));
  console.log(`${border}\n`);
}

function menuOptions(diff: DiffResult): { value: MenuAction; label: string; hint: string }[] {
  return [
    { value: 'commit', label: 'Commit', hint: 'use this message' },
    { value: 'subject', label: 'Edit subject', hint: 'quick inline fix' },
    { value: 'editor', label: 'Edit in $EDITOR', hint: 'subject and body' },
    { value: 'hint', label: 'Retry with a hint', hint: 'say what to change' },
    { value: 'retry', label: 'Retry', hint: 'regenerate from scratch' },
    {
      value: 'diff',
      label: 'View staged diff',
      hint: `${String(diff.files.length)} files, +${String(diff.insertions)} −${String(diff.deletions)}`,
    },
    { value: 'abort', label: 'Abort', hint: 'commit nothing' },
  ];
}

/** Splits a message into its subject line and everything after it. */
function splitMessage(message: string): { subject: string; body: string } {
  const newline = message.indexOf('\n');
  if (newline === -1) return { subject: message.trim(), body: '' };

  return {
    subject: message.slice(0, newline).trim(),
    body: message.slice(newline + 1).trim(),
  };
}

/**
 * Displays the generated message and an interactive action menu.
 *
 * Edits and the diff view are handled here and loop back to the menu — the
 * engine only ever sees commit, retry or abort, because only those three need
 * it to do anything.
 */
export async function showTui(
  message: string,
  diff: DiffResult,
  alreadyShown = false,
): Promise<TuiResult> {
  let current = message;
  let visible = alreadyShown;

  for (;;) {
    if (!visible) showMessage(current);
    visible = true;

    const action = await askSelect<MenuAction>({
      message: 'What do you want to do?',
      options: menuOptions(diff),
    });

    switch (action) {
      case 'commit':
        return { action: 'commit', message: current };

      case 'abort':
        return { action: 'abort', message: current };

      case 'retry':
        return { action: 'retry', message: current };

      case 'hint': {
        const hint = await askText({
          message: 'What should it change?',
          placeholder: "it's a fix, not a feat — and scope it to the parser",
        });
        if (!hint.trim()) break;
        return { action: 'retry', message: current, hint: hint.trim() };
      }

      case 'subject': {
        const { subject, body } = splitMessage(current);
        const edited = await askText({
          message: 'Subject',
          initialValue: subject,
          validate: (value) =>
            value.trim().length === 0 ? 'The subject cannot be empty.' : undefined,
        });
        current = body ? `${edited.trim()}\n\n${body}` : edited.trim();
        visible = false;
        break;
      }

      case 'editor':
        current = openInEditor(current);
        visible = false;
        break;

      case 'diff':
        showDiff(diff);
        visible = false;
        break;
    }
  }
}
