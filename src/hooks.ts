import { existsSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { execaSync } from 'execa';
import { logger } from './logger.js';
import { HookError } from './errors.js';

const HOOK_MARKER = '# gitmuse-managed-hook';

/**
 * Bumped whenever HOOK_SCRIPT changes, so `gm install` can replace a stale hook
 * instead of reporting "already installed" and leaving the old one in place.
 */
const HOOK_VERSION = 2;
const VERSION_TAG = `# gitmuse-hook-version: ${String(HOOK_VERSION)}`;

/**
 * A prepare-commit-msg hook writes the message into the file git hands it. It
 * must not commit anything itself: git already holds the index and the ref, so
 * a nested `git commit` either fails to lock HEAD or lands a second commit and
 * leaves the outer one with an empty message.
 */
const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
${VERSION_TAG}
# Installed by gitmuse. Remove with: gm uninstall
#
# $1 is the file git will take the commit message from.
# $2 says where that message came from — and anything with a source already has
# one (-m, --amend, merge, squash, a template), so only a plain \`git commit\`
# gets a generated message.
if [ -n "$2" ]; then
  exit 0
fi

if ! command -v gm >/dev/null 2>&1; then
  echo "gitmuse: 'gm' is not on PATH — leaving the commit message to you." >&2
  exit 0
fi

# Never block a commit. If generation fails you still get your editor, with
# whatever git had already put in the file.
if ! gm --write "$1"; then
  echo "gitmuse: no message generated — write one yourself." >&2
  echo "gitmuse: if that said 'unknown option --write', upgrade: npm i -g gitmuse" >&2
fi
exit 0
`;

/** Husky owns `.husky/_`; the real hooks live one level up, in `.husky/`. */
function isHuskyShimDir(dir: string): boolean {
  return (
    basename(dir) === '_' && (existsSync(join(dir, 'husky.sh')) || existsSync(join(dir, 'h')))
  );
}

/**
 * Where git will actually look for hooks in this repo.
 *
 * `--git-path hooks` honours `core.hooksPath`, which `.git/hooks` does not —
 * any repo using husky, lefthook or a shared hooks directory sends git
 * somewhere else entirely, and a hook written to `.git/hooks` never runs.
 */
function getHooksDir(cwd: string): { dir: string; husky: boolean } {
  let relative: string;
  try {
    relative = execaSync('git', ['rev-parse', '--git-path', 'hooks'], {
      cwd,
      stripFinalNewline: true,
    }).stdout.trim();
  } catch {
    throw new HookError('Not a git repository.');
  }

  if (!relative) {
    throw new HookError("Could not work out where git keeps this repo's hooks.");
  }

  // git answers relative to the directory it ran in.
  const dir = resolve(cwd, relative);

  // Husky's `_` directory is regenerated on install and its files only delegate
  // to the parent directory — writing there would be overwritten and ignored.
  if (isHuskyShimDir(dir)) return { dir: dirname(dir), husky: true };

  return { dir, husky: false };
}

function hookPathFor(dir: string): string {
  return join(dir, 'prepare-commit-msg');
}

/**
 * Installs a prepare-commit-msg hook that fills in the message for you.
 * `cwd` is the repo to install into; it defaults to where you are standing.
 */
export function installHook(cwd: string = process.cwd()): void {
  const { dir, husky } = getHooksDir(cwd);
  const hookPath = hookPathFor(dir);

  if (!existsSync(dir)) {
    throw new HookError(
      `Hooks directory does not exist:\n  ${dir}\n\nCreate it, then run \`gm install\` again.`,
    );
  }

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');

    if (!existing.includes(HOOK_MARKER)) {
      throw new HookError(
        `A prepare-commit-msg hook already exists at:\n  ${hookPath}\n\n` +
          'Remove it manually first, or add `gm --write "$1"` to it yourself.',
      );
    }

    if (existing.includes(VERSION_TAG)) {
      logger.warn('gitmuse hook is already installed and up to date.');
      return;
    }

    writeHook(hookPath);
    logger.success(`Hook updated: ${hookPath}`);
    return;
  }

  writeHook(hookPath);

  logger.success(`Hook installed: ${hookPath}`);
  if (husky) logger.dim('  (husky detected — installed alongside your other husky hooks)');
  logger.dim('  `git commit` will now open your editor with a generated message.');
}

function writeHook(hookPath: string): void {
  writeFileSync(hookPath, HOOK_SCRIPT, 'utf8');
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows doesn't support Unix permissions — ignore
  }
}

/** Removes the gitmuse-managed prepare-commit-msg hook. */
export function uninstallHook(cwd: string = process.cwd()): void {
  const { dir } = getHooksDir(cwd);
  const hookPath = hookPathFor(dir);

  if (!existsSync(hookPath)) {
    logger.warn('No prepare-commit-msg hook found.');
    return;
  }

  const content = readFileSync(hookPath, 'utf8');
  if (!content.includes(HOOK_MARKER)) {
    throw new HookError(
      `The hook at ${hookPath} was not installed by gitmuse.\n` +
        'Remove it manually to avoid accidentally deleting custom logic.',
    );
  }

  unlinkSync(hookPath);
  logger.success('gitmuse hook removed.');
}

/**
 * Writes a generated message into the file git handed the hook.
 *
 * Git's own content — the template, and the status comment block — is kept
 * below it, so the editor still shows what is being committed. Git strips those
 * comment lines when it cleans the message up.
 */
export function writeMessageFile(path: string, message: string): void {
  let existing = '';
  try {
    existing = readFileSync(path, 'utf8');
  } catch {
    // Git always creates this file before calling the hook, but do not depend on it.
  }

  const body = existing.trim() ? `${message}\n\n${existing}` : `${message}\n`;
  writeFileSync(path, body, 'utf8');
}
