import {
  autocomplete,
  cancel,
  confirm,
  log,
  note,
  spinner,
  intro as clackIntro,
  isCancel,
  outro as clackOutro,
  select,
  text,
} from '@clack/prompts';
import type { Option } from '@clack/prompts';
import chalk from 'chalk';
import { wordmark } from './brand.js';

/**
 * clack's own spinner and log lines, re-exported for the ceremonial flows.
 *
 * They render against the `│` rail that `intro` opens, so mixing them with the
 * plain `logger` inside one flow would leave half the output hanging off it.
 * The commit path has no rail and keeps using ora and `logger`.
 */
export { log, note, spinner };
export { wordmark };

/** Opens a ceremonial flow with the branded header. */
export function intro(subtitle?: string): void {
  clackIntro(`${wordmark(' gitmuse ')}${subtitle ? chalk.dim(`  ${subtitle}`) : ''}`);
}

/** Closes a ceremonial flow. */
export function outro(message: string): void {
  clackOutro(message);
}

/**
 * Ctrl+C at any prompt.
 *
 * clack returns a cancel symbol rather than throwing, so every call site would
 * otherwise have to test for it; these wrappers make cancelling behave the same
 * everywhere — say so, exit 0, change nothing.
 */
function bail(): never {
  cancel('Cancelled — nothing was changed.');
  process.exit(0);
}

/** clack decides whether `label` is required from the value type; reuse its shape. */
export type Choice<T> = Option<T>;

export async function askSelect<T>(opts: {
  message: string;
  options: Choice<T>[];
  initialValue?: T;
  maxItems?: number;
}): Promise<T> {
  const answer = await select<T>(opts);
  if (isCancel(answer)) bail();
  return answer;
}

/** Type-to-filter picker, for lists too long to scroll (Cursor lists 200+ models). */
export async function askSearch<T>(opts: {
  message: string;
  options: Choice<T>[];
  placeholder?: string;
  maxItems?: number;
}): Promise<T> {
  const answer = await autocomplete<T>(opts);
  if (isCancel(answer)) bail();
  return answer;
}

export async function askText(opts: {
  message: string;
  placeholder?: string;
  initialValue?: string;
  defaultValue?: string;
  validate?: (value: string) => string | undefined;
}): Promise<string> {
  const { validate, ...rest } = opts;
  const answer = await text({
    ...rest,
    // clack hands the validator `undefined` for an untouched field; every caller
    // here only cares about the string.
    validate: validate ? (value): string | undefined => validate(value ?? '') : undefined,
  });
  if (isCancel(answer)) bail();
  return answer;
}

export async function askConfirm(opts: {
  message: string;
  initialValue?: boolean;
}): Promise<boolean> {
  const answer = await confirm(opts);
  if (isCancel(answer)) bail();
  return answer;
}
