import { execSync, spawnSync } from 'child_process';
import type { DiffResult } from './types.js';
import { GitError, NotAGitRepoError, NoStagedChangesError } from './errors.js';

/** Returns true if cwd is inside a git repository. */
export function isGitRepo(): boolean {
  const result = spawnSync('git', ['rev-parse', '--git-dir'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0;
}

/** Returns the current branch name, or 'HEAD' when detached. */
export function getCurrentBranch(): string {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'HEAD';
  }
}

/**
 * Returns the staged diff, truncated to maxLines if needed.
 * Throws NoStagedChangesError when nothing is staged.
 * Throws NotAGitRepoError when not inside a git repo.
 */
export function getStagedDiff(maxLines: number): DiffResult {
  if (!isGitRepo()) throw new NotAGitRepoError();

  let raw: string;
  try {
    raw = execSync('git diff --cached --no-color', {
      encoding: 'utf8',
      // 10 MB ceiling — diffs larger than this are always truncated anyway
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new GitError(err instanceof Error ? err.message : String(err));
  }

  if (!raw.trim()) throw new NoStagedChangesError();

  const lines = raw.split('\n');
  const truncated = lines.length > maxLines;
  const diff = truncated
    ? `${lines.slice(0, maxLines).join('\n')}\n\n[...diff truncated at ${String(maxLines)} lines...]`
    : raw;

  return {
    diff,
    branch: getCurrentBranch(),
    staged: true,
    lineCount: lines.length,
  };
}

/**
 * Commits with the given message.
 * Uses spawnSync with an argument array — never interpolates message into a shell string.
 */
export function commitWithMessage(message: string): void {
  const result = spawnSync('git', ['commit', '-m', message], {
    encoding: 'utf8',
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new GitError('git commit failed. Check the output above for details.');
  }
}

/** Returns the list of staged filenames (for display only). */
export function getStagedFiles(): string[] {
  try {
    const out = execSync('git diff --cached --name-only', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
