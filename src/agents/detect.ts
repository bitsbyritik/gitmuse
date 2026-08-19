import { execa } from 'execa';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { delimiter, isAbsolute, join, sep } from 'path';

/** Version probes are cheap; auth and model listings may hit the network. */
const VERSION_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 15_000;
const MODELS_TIMEOUT_MS = 30_000;

/** Outcome of running one short-lived CLI command. Never throws. */
export interface CliResult {
  ok: boolean;
  /** The CLI wrote status to stdout, or stderr, or both — this is whichever
   *  one it actually used, so callers do not have to guess. */
  output: string;
  stdout: string;
  stderr: string;
  exitCode?: number;
  /** True when the executable itself could not be found or started. */
  missing: boolean;
  timedOut: boolean;
}

/**
 * Install directories agent installers write to that a shell — especially one
 * launched from a GUI, an editor terminal, or a git hook — may not have on
 * PATH. Checking them is the difference between "not installed" and "installed,
 * we just could not see it".
 */
function fallbackBinDirs(): string[] {
  const home = homedir();
  const dirs = [
    join(home, '.local', 'bin'), // codex, cursor-agent
    join(home, '.claude', 'local'), // claude local install
    join(home, '.bun', 'bin'),
    join(home, '.deno', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, 'node_modules', '.bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];

  if (process.platform === 'win32') {
    const local = process.env['LOCALAPPDATA'];
    const appData = process.env['APPDATA'];
    if (local) dirs.push(join(local, 'Programs'), join(local, 'bin'));
    if (appData) dirs.push(join(appData, 'npm'));
  }

  return dirs;
}

/** Filenames a bare command could have on this platform. */
function candidateNames(command: string): string[] {
  if (process.platform !== 'win32') return [command];
  const exts = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return [command, ...exts.map((ext) => command + ext.toLowerCase())];
}

async function isExecutable(path: string): Promise<boolean> {
  // X_OK is not meaningful on Windows — existence is the best signal there.
  const mode = process.platform === 'win32' ? constants.F_OK : constants.X_OK;
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds the executable for `command`.
 *
 * A bare name is looked up across PATH first, then across the install
 * directories agent installers actually use. Anything that already looks like a
 * path is checked as-is, so a user's `agents.<id>.command` override always wins.
 *
 * Returns the path to run and whether it had to be found outside PATH — that
 * second bit is what lets `gm connect` offer to pin the absolute path.
 */
export async function locateBinary(
  command: string,
): Promise<{ path?: string; offPath?: string }> {
  if (isAbsolute(command) || command.includes(sep) || command.includes('/')) {
    return (await isExecutable(command)) ? { path: command } : {};
  }

  const names = candidateNames(command);
  const pathDirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);

  for (const dir of pathDirs) {
    for (const name of names) {
      if (await isExecutable(join(dir, name))) return { path: command };
    }
  }

  for (const dir of fallbackBinDirs()) {
    for (const name of names) {
      const full = join(dir, name);
      if (await isExecutable(full)) return { path: full, offPath: full };
    }
  }

  return {};
}

/**
 * Runs one short-lived CLI command and reports what happened.
 *
 * execa with `reject: false` turns every failure mode — missing binary,
 * non-zero exit, timeout — into a plain object, so detection code stays
 * branching-on-data instead of catching exceptions.
 */
export async function runCli(
  command: string,
  args: readonly string[],
  timeout: number,
): Promise<CliResult> {
  const result = await execa(command, [...args], {
    timeout,
    reject: false,
    stripFinalNewline: true,
    // Agents inspect the working directory; keep detection out of the repo.
    cwd: homedir(),
    stdin: 'ignore',
  });

  const stdout = result.stdout || '';
  const stderr = result.stderr || '';

  return {
    ok: !result.failed,
    output: stdout.trim() || stderr,
    stdout,
    stderr,
    exitCode: result.exitCode,
    missing: result.code === 'ENOENT' || result.code === 'EACCES',
    timedOut: result.timedOut,
  };
}

export const timeouts = {
  version: VERSION_TIMEOUT_MS,
  auth: AUTH_TIMEOUT_MS,
  models: MODELS_TIMEOUT_MS,
} as const;
