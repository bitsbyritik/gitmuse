import { existsSync, writeFileSync, readFileSync, unlinkSync, chmodSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { logger } from './logger.js';
import { HookError } from './errors.js';

const HOOK_MARKER = '# gitmuse-managed-hook';

const HOOK_SCRIPT = `#!/bin/sh
${HOOK_MARKER}
# Installed by gitmuse. Remove with: gm uninstall
# Only runs on a plain "git commit" (not -m, --amend, merge, etc.)
if [ -z "$2" ]; then
  gm --yes
fi
`;

function getHooksDir(): string {
  try {
    const gitDir = execSync('git rev-parse --git-dir', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return join(gitDir, 'hooks');
  } catch {
    throw new HookError('Not a git repository.');
  }
}

/** Installs a prepare-commit-msg hook that runs `gm --yes` on plain commits. */
export function installHook(): void {
  const hooksDir = getHooksDir();
  const hookPath = join(hooksDir, 'prepare-commit-msg');

  if (existsSync(hookPath)) {
    const existing = readFileSync(hookPath, 'utf8');
    if (existing.includes(HOOK_MARKER)) {
      logger.warn('gitmuse hook is already installed.');
      return;
    }
    throw new HookError(
      `A prepare-commit-msg hook already exists at:\n  ${hookPath}\n\n` +
        'Remove it manually first, or append `gm --yes` to it yourself.',
    );
  }

  writeFileSync(hookPath, HOOK_SCRIPT, 'utf8');
  // chmod +x — no-op on Windows but harmless
  try {
    chmodSync(hookPath, 0o755);
  } catch {
    // Windows doesn't support Unix permissions — ignore
  }

  logger.success(`Hook installed: ${hookPath}`);
  logger.dim('  gitmuse will now auto-generate messages when you run `git commit`.');
}

/** Removes the gitmuse-managed prepare-commit-msg hook. */
export function uninstallHook(): void {
  const hooksDir = getHooksDir();
  const hookPath = join(hooksDir, 'prepare-commit-msg');

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
