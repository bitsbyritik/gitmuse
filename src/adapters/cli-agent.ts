import { execa } from 'execa';
import { tmpdir } from 'os';
import { BaseAdapter } from './base.js';
import type { AgentSettings } from '../types.js';
import type { AgentInvocation, AgentParseState, CliAgent } from '../agents/types.js';
import { resolveCommand, resolveModel } from '../agents/index.js';
import { AgentNotInstalledError, ProviderError } from '../errors.js';
import { addUsage } from '../usage.js';

const DEFAULT_TIMEOUT_MS = 120_000;

/** Thrown internally when the installed CLI rejects one of our newer flags. */
class UnsupportedFlagError extends Error {}

const UNSUPPORTED_FLAG =
  /unknown (option|argument)|unrecognized option|unexpected argument|error: unknown|invalid (option|argument)/i;

const NOT_SIGNED_IN = /log ?in|sign ?in|not authenticated|unauthorized|401/i;

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
    this.usage = undefined;

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
    const timeout = this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Run outside the user's repo: agents pick up instructions, hooks and MCP
    // servers from the working directory, and none of that belongs in a commit
    // message request.
    //
    // `reject: false` turns every failure into data on the result object, and
    // buffering only stderr lets stdout stream line by line while still leaving
    // an error message to report if the run dies.
    const subprocess = execa(command, invocation.args, {
      cwd: tmpdir(),
      input: prompt,
      timeout,
      reject: false,
      buffer: { stdout: false },
      stripFinalNewline: true,
    });

    // Killed here rather than in a `finally`, so an abandoned stream (the caller
    // threw, or broke out of the loop) does not leave the agent running.
    let finished = false;
    try {
      if (invocation.format === 'text') {
        // Rejoined rather than appended to, so the text tier yields exactly what
        // the CLI printed and gains no trailing newline of ours.
        const lines: string[] = [];
        for await (const line of subprocess.iterable({ from: 'stdout' })) lines.push(line);
        finished = true;
        this.assertClean(await subprocess);
        const out = lines.join('\n');
        if (out.trim()) yield out;
        return;
      }

      const state: AgentParseState = {};
      let reportedError: string | undefined;

      for await (const line of subprocess.iterable({ from: 'stdout' })) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = this.agent.parseEvent(trimmed, state);
        if (!event) continue;
        if (event.type === 'error') reportedError = event.message;
        // Added, not replaced: the basic-tier retry runs the CLI a second time.
        if (event.type === 'usage') this.usage = addUsage(this.usage, event.usage);
        if (event.type === 'text' && event.text) yield event.text;
      }

      finished = true;
      const result = await subprocess;
      // The agent's own error message beats a bare exit code.
      if (reportedError) throw new ProviderError(this.agent.id, reportedError);
      this.assertClean(result);
    } finally {
      if (!finished) subprocess.kill('SIGKILL');
    }
  }

  /** Turns a failed run into the most useful error we can offer. */
  private assertClean(result: {
    failed: boolean;
    exitCode?: number;
    stderr: string;
    timedOut: boolean;
    code?: string;
  }): void {
    if (!result.failed) return;

    if (result.code === 'ENOENT') {
      throw new AgentNotInstalledError(
        this.agent.name,
        resolveCommand(this.agent, this.settings),
        this.agent.install,
      );
    }

    if (result.timedOut) {
      const seconds = Math.round((this.settings.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
      throw new ProviderError(
        this.agent.id,
        `${this.agent.name} did not respond within ${String(seconds)}s`,
      );
    }

    const detail = (result.stderr || '').trim();
    if (UNSUPPORTED_FLAG.test(detail)) throw new UnsupportedFlagError(detail);

    if (NOT_SIGNED_IN.test(detail)) {
      throw new ProviderError(
        this.agent.id,
        `${this.agent.name} is not signed in. Run: ${this.agent.loginCommand}`,
      );
    }

    throw new ProviderError(
      this.agent.id,
      detail || `${this.agent.name} exited with code ${String(result.exitCode ?? -1)}`,
    );
  }
}
