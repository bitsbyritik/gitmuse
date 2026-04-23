import { select } from '@inquirer/prompts';
import { writeFileSync, readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import type { TuiResult } from './types.js';

const noColor = Boolean(process.env['NO_COLOR']);

/**
 * Pipes an async token stream to stdout in real time.
 * Returns the full accumulated message string.
 */
export async function streamToTerminal(tokenStream: AsyncIterable<string>): Promise<string> {
  process.stdout.write('\n');
  let full = '';

  for await (const token of tokenStream) {
    full += token;
    process.stdout.write(token);
  }

  process.stdout.write('\n');
  return full;
}

/** Opens $EDITOR with the current message. Returns the saved content, or the original on failure. */
function openInEditor(initial: string): string {
  const editor =
    process.env['EDITOR'] ??
    process.env['VISUAL'] ??
    (process.platform === 'win32' ? 'notepad' : 'nano');

  const tmpFile = join(tmpdir(), `gitmuse-${randomUUID()}.txt`);
  writeFileSync(tmpFile, initial, 'utf8');

  const result = spawnSync(editor, [tmpFile], { stdio: 'inherit' });

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

  if (result.status !== 0) return initial;
  return edited;
}

/**
 * Displays the generated message and an interactive action menu.
 * Handles Ctrl+C (ExitPromptError) by exiting cleanly.
 */
export async function showTui(message: string): Promise<TuiResult> {
  // Re-display the message so it's visible above the menu (useful after retry)
  const border = noColor ? '---' : chalk.dim('───────────────────────────────────');
  console.log(border);
  console.log(noColor ? message : chalk.cyan(message));
  console.log(border + '\n');

  let action: TuiResult['action'];

  try {
    action = await select<TuiResult['action']>({
      message: 'What do you want to do?',
      choices: [
        { name: `${noColor ? '' : '✓  '}Commit`, value: 'commit' },
        { name: `${noColor ? '' : '✎  '}Edit in $EDITOR`, value: 'edit' },
        { name: `${noColor ? '' : '↺  '}Retry (regenerate)`, value: 'retry' },
        { name: `${noColor ? '' : '✗  '}Abort`, value: 'abort' },
      ],
    });
  } catch (err) {
    // @inquirer/prompts throws ExitPromptError on Ctrl+C
    if (err instanceof Error && err.name === 'ExitPromptError') {
      process.stdout.write('\n');
      process.exit(0);
    }
    throw err;
  }

  if (action === 'edit') {
    const edited = openInEditor(message);
    return { action: 'commit', message: edited };
  }

  return { action, message };
}
