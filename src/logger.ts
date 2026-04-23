import chalk from 'chalk';

let _silent = false;
const noColor = Boolean(process.env['NO_COLOR']);

/** Call once at startup with the value of the --silent flag. */
export function setSilent(silent: boolean): void {
  _silent = silent;
}

function c(text: string, colorFn: (s: string) => string): string {
  return noColor ? text : colorFn(text);
}

export const logger = {
  info(msg: string): void {
    if (_silent) return;
    console.log(c(`  ${msg}`, chalk.cyan));
  },

  success(msg: string): void {
    if (_silent) return;
    console.log(c(`  ✓ ${msg}`, chalk.green));
  },

  warn(msg: string): void {
    if (_silent) return;
    console.warn(c(`  ⚠ ${msg}`, chalk.yellow));
  },

  /** Always prints regardless of --silent. */
  error(msg: string): void {
    console.error(c(`  ✗ ${msg}`, chalk.red));
  },

  /** Raw output — no prefix, no colour transform. Respects --silent. */
  raw(msg: string): void {
    if (_silent) return;
    console.log(msg);
  },

  dim(msg: string): void {
    if (_silent) return;
    console.log(c(msg, chalk.dim));
  },
};
