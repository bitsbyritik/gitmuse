/**
 * Honest accessors for the terminal properties Node mistypes.
 *
 * `@types/node` declares `isTTY` as `boolean` and `columns` as `number` on the
 * standard streams. Both are actually `undefined` whenever the stream is a pipe,
 * a file or a git hook's inherited handle — which is precisely the case this
 * code exists to detect. Reading them through here keeps the optionality in the
 * types instead of relying on it accidentally at runtime.
 */

/** True only when the stream is attached to a real terminal. */
export function isTty(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

/** Terminal width, or `fallback` when the width is unknowable. */
export function terminalColumns(fallback = 0): number {
  const { columns } = process.stdout as { columns?: number };
  return columns ?? fallback;
}

/** True when there is a human on both ends of the pipe. */
export function isInteractive(): boolean {
  return isTty(process.stdin) && isTty(process.stdout);
}

/**
 * Whether a redrawing spinner is safe here.
 *
 * ora erases its previous frame by counting the rows it wrapped to, which means
 * dividing by the terminal width. A terminal that reports zero columns — `script`
 * does, and so do some CI ptys — turns that into an unbounded clear loop that
 * pegs a core and never returns. A missing spinner is a far better outcome.
 */
export function canAnimate(): boolean {
  return !isTty(process.stdout) || terminalColumns() > 0;
}
