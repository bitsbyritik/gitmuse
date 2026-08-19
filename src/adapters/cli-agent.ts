import { spawn } from 'child_process';
import { tmpdir } from 'os';
import { BaseAdapter } from './base.js';
import type { AgentSettings } from '../types.js';
import type { AgentInvocation, CliAgent } from '../agents/types.js';
import { resolveCommand, resolveModel } from '../agents/index.js';
import { AgentNotInstalledError, ProviderError } from '../errors.js';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Thrown internally when the installed CLI rejects one of our newer flags. */
class UnsupportedFlagError extends Error {}

const UNSUPPORTED_FLAG =
  /unknown (option|argument)|unrecognized option|unexpected argument|error: unknown/i;

/**
 * Runs a local coding agent's CLI in non-interactive mode and streams the text
 * it prints back. The agent owns its own credentials — gitmuse only spawns it.
 *
 * Works for any agent that implements CliAgent, so a new agent needs no changes
 * here.
 */
export class CliAgentAdapter extends BaseAdapter {
  private readonly agent: CliAgent;
  private readonly settings: AgentSettings;

  constructor(agent: CliAgent, settings: AgentSettings = {}) {
    super();
    this.agent = agent;
    this.settings = settings;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const model = resolveModel(this.agent, this.settings);
    let yielded = false;

    try {
      for await (const token of this.runOnce(
        prompt,
        this.agent.buildInvocation(model, 'full'),
      )) {
        yielded = true;
        yield token;
      }
    } catch (err) {
      // An older CLI that does not know a flag we passed fails instantly, before
      // producing output — safe to retry once with only long-standing flags.
      if (!(err instanceof UnsupportedFlagError) || yielded) throw err;
      yield* this.runOnce(prompt, this.agent.buildInvocation(model, 'basic'));
    }
  }

  private async *runOnce(
    prompt: string,
    invocation: AgentInvocation,
  ): AsyncIterable<string> {
    const command = resolveCommand(this.agent, this.settings);
    const timeoutMs = this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Run outside the user's repo: agents pick up instructions, hooks and MCP
    // servers from the working directory, and none of that belongs in a commit
    // message request.
    const child = spawn(command, invocation.args, {
      cwd: tmpdir(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let spawnError: NodeJS.ErrnoException | undefined;
    child.once('error', (err: NodeJS.ErrnoException) => {
      spawnError = err;
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8_000); // keep the tail only
    });

    const closed = new Promise<number | null>((resolve) => {
      child.once('close', (code) => {
        resolve(code);
      });
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    // The child may exit before reading stdin (bad flag, not signed in).
    child.stdin.on('error', () => undefined);
    child.stdin.end(prompt, 'utf8');

    try {
      child.stdout.setEncoding('utf8');

      if (invocation.format === 'text') {
        let out = '';
        for await (const chunk of child.stdout) out += chunk as string;
        this.assertClean(await closed, stderr, timedOut, spawnError);
        if (out.trim()) yield out;
        return;
      }

      let buffer = '';
      let reportedError: string | undefined;

      const drain = (line: string): string | undefined => {
        const trimmed = line.trim();
        if (!trimmed) return undefined;
        const event = this.agent.parseEvent(trimmed);
        if (!event) return undefined;
        if (event.type === 'error') reportedError = event.message;
        return event.type === 'text' ? event.text : undefined;
      };

      for await (const chunk of child.stdout) {
        buffer += chunk as string;
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // last line may be incomplete
        for (const line of lines) {
          const text = drain(line);
          if (text) yield text;
        }
      }

      const tail = drain(buffer);
      if (tail) yield tail;

      const code = await closed;
      // The agent's own error message beats a bare exit code.
      if (reportedError) throw new ProviderError(this.agent.id, reportedError);
      this.assertClean(code, stderr, timedOut, spawnError);
    } finally {
      clearTimeout(timer);
      // Abandoned stream (caller threw or broke out) — don't leak the process.
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }

  /** Turns a non-zero exit into the most useful error we can offer. */
  private assertClean(
    code: number | null,
    stderr: string,
    timedOut: boolean,
    spawnError?: NodeJS.ErrnoException,
  ): void {
    if (spawnError?.code === 'ENOENT') {
      throw new AgentNotInstalledError(
        this.agent.name,
        resolveCommand(this.agent, this.settings),
        this.agent.install,
      );
    }
    if (spawnError) throw new ProviderError(this.agent.id, spawnError.message);

    if (timedOut) {
      throw new ProviderError(
        this.agent.id,
        `${this.agent.name} did not respond within ${String(
          Math.round((this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000),
        )}s`,
      );
    }

    if (code === 0) return;

    const detail = stderr.trim();
    if (UNSUPPORTED_FLAG.test(detail)) throw new UnsupportedFlagError(detail);

    if (/log ?in|sign ?in|not authenticated|unauthorized|401/i.test(detail)) {
      throw new ProviderError(
        this.agent.id,
        `${this.agent.name} is not signed in. Run: ${this.agent.loginCommand}`,
      );
    }

    throw new ProviderError(
      this.agent.id,
      detail || `${this.agent.name} exited with code ${String(code)}`,
    );
  }
}
