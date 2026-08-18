import { execSync, spawnSync } from 'child_process';
import type { DiffResult, FileStatus, StagedFile } from './types.js';
import { categorize, inferEvidence, isNoise } from './classify.js';
import { GitError, NotAGitRepoError, NoStagedChangesError } from './errors.js';

/** Body lines kept for a lockfile / generated / binary file — they say nothing. */
const NOISE_BODY_LINES = 0;
/** Never give an interesting file less than this, even in a wide commit. */
const MIN_FILE_LINES = 6;

/** Runs a git command and returns stdout. `core.quotePath=false` keeps UTF-8 paths readable. */
function git(args: string): string {
  try {
    return execSync(`git -c core.quotePath=false ${args}`, {
      encoding: 'utf8',
      // 10 MB ceiling — diffs larger than this are always trimmed anyway
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    throw new GitError(err instanceof Error ? err.message : String(err));
  }
}

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

const STATUS_LETTERS: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
};

/**
 * Parses `--name-status -M`:
 *   A\tpath   M\tpath   D\tpath   R075\told\tnew
 */
function parseNameStatus(out: string): StagedFile[] {
  const files: StagedFile[] = [];

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0]?.[0] ?? '';
    const status = STATUS_LETTERS[code] ?? 'unknown';

    const isMove = status === 'renamed' || status === 'copied';
    const path = (isMove ? parts[2] : parts[1])?.trim();
    if (!path) continue;

    files.push({
      path,
      oldPath: isMove ? parts[1]?.trim() : undefined,
      status,
      insertions: 0,
      deletions: 0,
      binary: false,
      category: categorize(path),
    });
  }

  return files;
}

/**
 * Rewrites numstat's compressed rename paths into the real new path:
 *   `src/{old.ts => new.ts}` → `src/new.ts`
 *   `old.ts => new.ts`       → `new.ts`
 */
function resolveNumstatPath(raw: string): string {
  const braced = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(raw);
  if (braced) {
    const [, before = '', , after = '', tail = ''] = braced;
    return `${before}${after}${tail}`.replace(/\/{2,}/g, '/');
  }
  const arrow = raw.split(' => ');
  return (arrow.length > 1 ? arrow[arrow.length - 1] : raw)?.trim() ?? raw;
}

/** Fills in insertions/deletions/binary from `--numstat -M`. */
function applyNumstat(files: StagedFile[], out: string): void {
  const byPath = new Map(files.map((f) => [f.path, f]));

  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [ins = '', del = '', ...rest] = line.split('\t');
    const path = resolveNumstatPath(rest.join('\t').trim());
    const file = byPath.get(path);
    if (!file) continue;

    if (ins === '-' || del === '-') {
      file.binary = true;
      continue;
    }
    file.insertions = Number(ins) || 0;
    file.deletions = Number(del) || 0;
  }
}

interface DiffSection {
  path: string;
  lines: string[];
}

/** Splits a full diff into one section per file. */
function splitSections(raw: string): DiffSection[] {
  const sections: DiffSection[] = [];
  let current: string[] = [];

  const push = (): void => {
    if (current.length === 0) return;
    sections.push({ path: sectionPath(current), lines: current });
    current = [];
  };

  for (const line of raw.split('\n')) {
    if (line.startsWith('diff --git ')) push();
    current.push(line);
  }
  push();

  return sections;
}

/** Best-effort path for a diff section — `+++ b/x`, then `--- a/x`, then the header. */
function sectionPath(lines: string[]): string {
  for (const line of lines) {
    if (line.startsWith('+++ b/')) return line.slice(6).trim();
    if (line.startsWith('+++ ') && !line.includes('/dev/null')) return line.slice(4).trim();
  }
  for (const line of lines) {
    if (line.startsWith('--- a/')) return line.slice(6).trim();
  }
  const header = /^diff --git a\/(.+) b\/\1$/.exec(lines[0] ?? '');
  return header?.[1] ?? '';
}

/**
 * Assembles the diff the model sees, spending the line budget where it matters.
 *
 * A 4,000-line lockfile used to swallow the whole budget and push the actual
 * source change out of the prompt — which is exactly how a `fix` ends up
 * described as a `chore`. Noise files are reduced to a one-line placeholder and
 * the rest of the budget is shared fairly between the files worth reading.
 */
function assembleDiff(
  raw: string,
  files: StagedFile[],
  maxLines: number,
): { diff: string; trimmed: boolean } {
  const sections = splitSections(raw);
  if (sections.length === 0) return { diff: raw.trim(), trimmed: false };

  const byPath = new Map(files.map((f) => [f.path, f]));
  const interesting: DiffSection[] = [];
  const out = new Map<DiffSection, string[]>();
  let trimmed = false;

  for (const section of sections) {
    const file = byPath.get(section.path);
    if (file && isNoise(file)) {
      const why = file.binary ? 'binary file' : `${file.category} file`;
      out.set(section, [
        section.lines[0] ?? `diff --git a/${section.path} b/${section.path}`,
        `[diff omitted — ${why}, see the change summary above]`,
      ]);
      file.trimmed = section.lines.length > NOISE_BODY_LINES + 2;
      trimmed = trimmed || file.trimmed;
      continue;
    }
    interesting.push(section);
  }

  // Fair share: smallest files first, so their leftovers grow everyone else's.
  const ordered = [...interesting].sort((a, b) => a.lines.length - b.lines.length);
  let remaining = Math.max(maxLines, MIN_FILE_LINES * ordered.length);
  let left = ordered.length;

  for (const section of ordered) {
    const share = Math.max(MIN_FILE_LINES, Math.floor(remaining / left));
    const take = Math.min(section.lines.length, share);

    if (take < section.lines.length) {
      const hidden = section.lines.length - take;
      out.set(section, [
        ...section.lines.slice(0, take),
        `[… ${String(hidden)} more diff lines trimmed …]`,
      ]);
      const file = byPath.get(section.path);
      if (file) file.trimmed = true;
      trimmed = true;
    } else {
      out.set(section, section.lines);
    }

    remaining -= take;
    left -= 1;
  }

  // Emit in the original file order, not the allocation order.
  const diff = sections
    .map((section) => (out.get(section) ?? section.lines).join('\n'))
    .join('\n')
    .trim();

  return { diff, trimmed };
}

/**
 * Reads everything staged: which files changed and how, how much churn each
 * carries, what that already proves about the commit type, and a diff trimmed
 * to fit `maxLines` without losing the interesting files.
 *
 * Throws NoStagedChangesError when nothing is staged, NotAGitRepoError outside
 * a repository.
 */
export function getStagedDiff(maxLines: number): DiffResult {
  if (!isGitRepo()) throw new NotAGitRepoError();

  const nameStatus = git('diff --cached -M --name-status');
  if (!nameStatus.trim()) throw new NoStagedChangesError();

  const files = parseNameStatus(nameStatus);
  applyNumstat(files, git('diff --cached -M --numstat'));

  const raw = git('diff --cached -M --no-color');
  const { diff, trimmed } = assembleDiff(raw, files, maxLines);

  return {
    diff,
    branch: getCurrentBranch(),
    staged: true,
    lineCount: raw.split('\n').length,
    files,
    insertions: files.reduce((sum, f) => sum + f.insertions, 0),
    deletions: files.reduce((sum, f) => sum + f.deletions, 0),
    trimmed,
    evidence: inferEvidence(files),
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
