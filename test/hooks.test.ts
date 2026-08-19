import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execaSync } from 'execa';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  chmodSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { installHook, uninstallHook, writeMessageFile } from '../src/hooks.js';
import { HookError } from '../src/errors.js';

let repo: string;

/** A throwaway git repo, entered so hooks.ts resolves paths against it. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gitmuse-hooks-'));
  execaSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

/** Recreates husky's layout: real hooks in `.husky`, shims in `.husky/_`. */
function makeHusky(dir: string): void {
  mkdirSync(join(dir, '.husky', '_'), { recursive: true });
  writeFileSync(join(dir, '.husky', '_', 'h'), '#!/usr/bin/env sh\n', 'utf8');
  execaSync('git', ['config', 'core.hooksPath', '.husky/_'], { cwd: dir });
}

beforeEach(() => {
  repo = makeRepo();
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('installHook', () => {
  it('installs into .git/hooks in a plain repo', () => {
    installHook(repo);
    expect(existsSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(true);
  });

  it('follows core.hooksPath instead of assuming .git/hooks', () => {
    const shared = join(repo, 'githooks');
    mkdirSync(shared);
    execaSync('git', ['config', 'core.hooksPath', 'githooks'], { cwd: repo });

    installHook(repo);

    expect(existsSync(join(shared, 'prepare-commit-msg'))).toBe(true);
    expect(existsSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(false);
  });

  it('installs beside husky\'s own hooks, not inside the dir husky regenerates', () => {
    makeHusky(repo);

    installHook(repo);

    expect(existsSync(join(repo, '.husky', 'prepare-commit-msg'))).toBe(true);
    expect(existsSync(join(repo, '.husky', '_', 'prepare-commit-msg'))).toBe(false);
  });

  it('replaces a hook left by an older gitmuse', () => {
    const hookPath = join(repo, '.git', 'hooks', 'prepare-commit-msg');
    writeFileSync(
      hookPath,
      '#!/bin/sh\n# gitmuse-managed-hook\nif [ -z "$2" ]; then\n  gm --yes\nfi\n',
      'utf8',
    );

    installHook(repo);

    const updated = readFileSync(hookPath, 'utf8');
    expect(updated).toContain('"$muse" --write "$1"');
    expect(updated).not.toContain('gm --yes');
  });

  it('refuses to overwrite a hook it did not write', () => {
    writeFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), '#!/bin/sh\necho mine\n');
    expect(() => {
      installHook(repo);
    }).toThrow(HookError);
  });
});

describe('the installed hook script', () => {
  it('hands the message to git rather than committing itself', () => {
    installHook(repo);
    const script = readFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf8');

    // A nested `git commit` here cannot lock HEAD — that was the old bug.
    expect(script).not.toMatch(/gm\s+--yes/);
    expect(script).toContain('"$muse" --write "$1"');
  });

  it('skips every commit that already has a message', () => {
    installHook(repo);
    const script = readFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf8');
    expect(script).toContain('if [ -n "$2" ]; then\n  exit 0\nfi');
  });

  it('cannot block a commit', () => {
    installHook(repo);
    const script = readFileSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'), 'utf8');
    // Both the missing-binary path and a failed run must fall through to exit 0.
    expect(script).toContain('if ! "$muse" --write "$1"; then');
    expect(script).not.toMatch(/^\s*"\$muse" --write .*[^n]$/m); // never an unguarded call
    expect(script.trimEnd().endsWith('exit 0')).toBe(true);
  });
});

/**
 * Runs the installed hook the way git does — `sh <hook> <msgfile>` — against a
 * PATH containing only the stub binaries named here. Returns what the hook left
 * in the message file.
 */
function runHookWith(binaries: Record<string, string>): {
  message: string;
  stderr: string;
} {
  installHook(repo);
  const hook = join(repo, '.git', 'hooks', 'prepare-commit-msg');

  const bin = mkdtempSync(join(tmpdir(), 'gitmuse-bin-'));
  for (const [name, body] of Object.entries(binaries)) {
    const file = join(bin, name);
    writeFileSync(file, body, 'utf8');
    chmodSync(file, 0o755);
  }

  const messageFile = join(bin, 'COMMIT_EDITMSG');
  writeFileSync(messageFile, '', 'utf8');

  // Absolute shell on purpose: PATH holds only the stubs, so an `sh` lookup
  // through it would fail before the hook ever ran.
  const result = execaSync('/bin/sh', [hook, messageFile], {
    env: { PATH: bin },
    extendEnv: false,
    reject: false,
  });

  const message = readFileSync(messageFile, 'utf8').trim();
  rmSync(bin, { recursive: true, force: true });
  return { message, stderr: result.stderr };
}

/** A stub that records which binary git actually reached. `$2` is the message file. */
const stub = (name: string): string => `#!/bin/sh\necho "from ${name}" > "$2"\n`;

describe('which binary the hook calls', () => {
  it('prefers `gitmuse` over `gm` when both are on PATH', () => {
    // `gm` is also GraphicsMagick's binary, so the long name has to win.
    const { message } = runHookWith({ gitmuse: stub('gitmuse'), gm: stub('gm') });
    expect(message).toBe('from gitmuse');
  });

  it('falls back to `gm` when only the short name is installed', () => {
    const { message } = runHookWith({ gm: stub('gm') });
    expect(message).toBe('from gm');
  });

  it('leaves the message alone and still exits 0 when neither is on PATH', () => {
    // A shell alias lives in .zshrc, which this hook never reads — so an alias
    // looks exactly like this, and must not break the commit.
    const { message, stderr } = runHookWith({});
    expect(message).toBe('');
    expect(stderr).toContain('not found on PATH');
  });

  it('never runs a nested `git commit`', () => {
    const { message } = runHookWith({
      gitmuse: stub('gitmuse'),
      git: '#!/bin/sh\necho "NESTED COMMIT" > /dev/stderr\nexit 1\n',
    });
    expect(message).toBe('from gitmuse');
  });
});

describe('uninstallHook', () => {
  it('removes the hook it installed', () => {
    installHook(repo);
    uninstallHook(repo);
    expect(existsSync(join(repo, '.git', 'hooks', 'prepare-commit-msg'))).toBe(false);
  });

  it('leaves someone else\'s hook alone', () => {
    const hookPath = join(repo, '.git', 'hooks', 'prepare-commit-msg');
    writeFileSync(hookPath, '#!/bin/sh\necho mine\n');
    expect(() => {
      uninstallHook(repo);
    }).toThrow(HookError);
    expect(existsSync(hookPath)).toBe(true);
  });

  it('finds the husky hook it installed', () => {
    makeHusky(repo);
    installHook(repo);
    uninstallHook(repo);
    expect(existsSync(join(repo, '.husky', 'prepare-commit-msg'))).toBe(false);
  });
});

describe('writeMessageFile', () => {
  it('puts the message above the comment block git wrote', () => {
    const file = join(repo, 'COMMIT_EDITMSG');
    writeFileSync(file, '\n# Please enter the commit message.\n# On branch main\n', 'utf8');

    writeMessageFile(file, 'fix(auth): reject expired sessions');

    const written = readFileSync(file, 'utf8');
    expect(written.startsWith('fix(auth): reject expired sessions\n\n')).toBe(true);
    expect(written).toContain('# On branch main');
  });

  it('keeps a multi-line body intact', () => {
    const file = join(repo, 'COMMIT_EDITMSG');
    writeFileSync(file, '# comments\n', 'utf8');

    writeMessageFile(file, 'feat: add x\n\nWhy it matters.');

    expect(readFileSync(file, 'utf8')).toBe('feat: add x\n\nWhy it matters.\n\n# comments\n');
  });

  it('writes a bare message when git left the file empty', () => {
    const file = join(repo, 'COMMIT_EDITMSG');
    writeFileSync(file, '   \n', 'utf8');

    writeMessageFile(file, 'docs: tidy readme');

    expect(readFileSync(file, 'utf8')).toBe('docs: tidy readme\n');
  });
});
