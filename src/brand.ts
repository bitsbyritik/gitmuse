import gradient from 'gradient-string';
import { isTty } from './tty.js';

/**
 * Magenta → violet → cyan. The gradient is reserved for `gitmuse setup`,
 * `gitmuse connect` and `--version` — commands you run a handful of times. The
 * commit path runs dozens of times a day and stays quiet.
 */
const MUSE = ['#d946ef', '#8b5cf6', '#06b6d4'];

/** Colour is pointless when piped to a file, a pager or a CI log. */
function canPaint(): boolean {
  return !process.env['NO_COLOR'] && isTty(process.stdout);
}

/** The gitmuse wordmark, gradient-painted when the terminal can show it. */
export function wordmark(label = 'gitmuse'): string {
  return canPaint() ? gradient(MUSE)(label) : label;
}
