import { describe, it, expect } from 'vitest';
import { claudeCode } from '../src/agents/claude-code.js';
import { codexCli } from '../src/agents/codex.js';
import {
  CLI_AGENTS,
  findAgent,
  isAgentProvider,
  resolveCommand,
  resolveModel,
} from '../src/agents/index.js';
import { CliAgentAdapter } from '../src/adapters/cli-agent.js';
import type { AgentInvocation, ArgTier, CliAgent } from '../src/agents/types.js';
import { AgentNotInstalledError, ProviderError } from '../src/errors.js';

/** Collects every token an adapter yields. */
async function collect(adapter: CliAgentAdapter, prompt = 'go'): Promise<string> {
  let out = '';
  for await (const token of adapter.stream(prompt)) out += token;
  return out;
}

/** A fake agent backed by `node -e`, so the adapter runs a real subprocess. */
function fakeAgent(scripts: Record<ArgTier, string>, format: 'stream-json' | 'text'): CliAgent {
  return {
    ...claudeCode,
    id: 'claude-code',
    name: 'Fake Agent',
    command: process.execPath,
    models: ['test-model'],
    buildInvocation(_model: string, tier: ArgTier): AgentInvocation {
      return {
        args: ['-e', scripts[tier]],
        format: tier === 'basic' ? 'text' : format,
      };
    },
  };
}

const ndjson = (obj: unknown): string => JSON.stringify(obj);

describe('agent registry', () => {
  it('registers claude-code and codex', () => {
    expect(findAgent('claude-code')).toBe(claudeCode);
    expect(findAgent('codex')).toBe(codexCli);
    expect(CLI_AGENTS).toContain(claudeCode);
    expect(CLI_AGENTS).toContain(codexCli);
  });

  it('gives every agent a unique id', () => {
    const ids = CLI_AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not treat HTTP providers as agents', () => {
    expect(findAgent('openai')).toBeUndefined();
    expect(isAgentProvider('openai')).toBe(false);
    expect(isAgentProvider('claude-code')).toBe(true);
    expect(isAgentProvider('codex')).toBe(true);
  });

  it('prefers configured command and model over the defaults', () => {
    expect(resolveCommand(claudeCode)).toBe('claude');
    expect(resolveCommand(claudeCode, { command: '/opt/claude' })).toBe('/opt/claude');
    expect(resolveModel(claudeCode)).toBe('sonnet');
    expect(resolveModel(claudeCode, { model: 'opus' })).toBe('opus');

    expect(resolveCommand(codexCli)).toBe('codex');
    expect(resolveModel(codexCli)).toBe('default');
    expect(resolveModel(codexCli, { model: 'gpt-5.5' })).toBe('gpt-5.5');
  });
});

describe('codex definition', () => {
  it('runs `exec` non-interactively with NDJSON output', () => {
    const { args, format } = codexCli.buildInvocation('gpt-5.5', 'full');
    expect(args[0]).toBe('exec');
    expect(args).toContain('--json');
    expect(args).toContain('--skip-git-repo-check');
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
    expect(args[args.indexOf('--model') + 1]).toBe('gpt-5.5');
    expect(format).toBe('stream-json');
  });

  it('names no model on the "default" pick, so any plan can run it', () => {
    expect(codexCli.buildInvocation('default', 'full').args).not.toContain('--model');
    expect(codexCli.buildInvocation('', 'full').args).not.toContain('--model');
  });

  it('drops the newer flags on the basic tier but keeps NDJSON', () => {
    const { args, format } = codexCli.buildInvocation('gpt-5.5', 'basic');
    expect(format).toBe('stream-json');
    expect(args).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--model',
      'gpt-5.5',
    ]);
    expect(args).not.toContain('--ephemeral');
    expect(args).not.toContain('-c');
  });

  it('reads the one-line login status', () => {
    expect(codexCli.parseAuth?.('Logged in using ChatGPT')).toEqual({
      connected: true,
      method: 'chatgpt',
    });
    expect(codexCli.parseAuth?.('Logged in using an API key - sk-abc')).toEqual({
      connected: true,
      method: 'api-key',
    });
    expect(codexCli.parseAuth?.('Not logged in').connected).toBe(false);
    expect(codexCli.parseAuth?.('').connected).toBe(false);
  });

  it('never echoes back the API key fragment the CLI prints', () => {
    const auth = codexCli.parseAuth?.('Logged in using an API key - sk-proj-secret');
    expect(JSON.stringify(auth)).not.toContain('sk-proj-secret');
  });

  it('yields the agent message and ignores reasoning and tool items', () => {
    expect(
      codexCli.parseEvent(
        ndjson({ type: 'item.completed', item: { type: 'agent_message', text: 'fix: x' } }),
      ),
    ).toEqual({ type: 'text', text: 'fix: x' });

    expect(
      codexCli.parseEvent(
        ndjson({ type: 'item.completed', item: { type: 'reasoning', text: 'hmm' } }),
      ),
    ).toBeUndefined();
    expect(
      codexCli.parseEvent(
        ndjson({ type: 'item.completed', item: { type: 'command_execution', text: 'ls' } }),
      ),
    ).toBeUndefined();
    expect(codexCli.parseEvent(ndjson({ type: 'thread.started', thread_id: 'x' }))).toBeUndefined();
    expect(codexCli.parseEvent('Shell cwd was reset to /tmp')).toBeUndefined();
  });

  it('ends on a completed turn', () => {
    expect(codexCli.parseEvent(ndjson({ type: 'turn.completed', usage: {} }))).toEqual({
      type: 'end',
    });
  });

  it('unwraps the API error Codex nests inside a JSON string', () => {
    const nested = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: 'model is not supported' },
    });

    expect(codexCli.parseEvent(ndjson({ type: 'error', message: nested }))).toEqual({
      type: 'error',
      message: 'model is not supported',
    });
    expect(
      codexCli.parseEvent(ndjson({ type: 'turn.failed', error: { message: nested } })),
    ).toEqual({ type: 'error', message: 'model is not supported' });
  });

  it('falls back to the raw message when it is not nested JSON', () => {
    expect(codexCli.parseEvent(ndjson({ type: 'error', message: 'stream disconnected' }))).toEqual({
      type: 'error',
      message: 'stream disconnected',
    });
    expect(codexCli.parseEvent(ndjson({ type: 'turn.failed' }))).toEqual({
      type: 'error',
      message: 'the agent reported an error',
    });
  });
});

describe('claude-code definition', () => {
  it('asks for the chosen model in non-interactive mode', () => {
    const { args, format } = claudeCode.buildInvocation('haiku', 'full');
    expect(args).toContain('-p');
    expect(args).toContain('--model');
    expect(args[args.indexOf('--model') + 1]).toBe('haiku');
    expect(format).toBe('stream-json');
  });

  it('falls back to only long-standing flags on the basic tier', () => {
    const { args, format } = claudeCode.buildInvocation('sonnet', 'basic');
    expect(format).toBe('text');
    expect(args).toEqual(['-p', '--model', 'sonnet', '--output-format', 'text']);
  });

  it('reads auth status JSON', () => {
    const auth = claudeCode.parseAuth?.(
      '{"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"pro","email":"a@b.c"}',
    );
    expect(auth).toEqual({
      connected: true,
      account: 'a@b.c',
      plan: 'pro',
      method: 'claude.ai',
    });
  });

  it('reports signed out and survives non-JSON output', () => {
    expect(claudeCode.parseAuth?.('{"loggedIn":false}').connected).toBe(false);
    expect(claudeCode.parseAuth?.('You are logged in as a@b.c').connected).toBe(true);
    expect(claudeCode.parseAuth?.('garbage').connected).toBe(false);
  });

  it('yields text deltas and ignores thinking', () => {
    const text = claudeCode.parseEvent(
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fix: ' } },
      }),
    );
    expect(text).toEqual({ type: 'text', text: 'fix: ' });

    const thinking = claudeCode.parseEvent(
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
      }),
    );
    expect(thinking).toBeUndefined();
  });

  it('surfaces result errors and ignores noise', () => {
    expect(
      claudeCode.parseEvent(ndjson({ type: 'result', is_error: true, result: 'rate limit' })),
    ).toEqual({ type: 'error', message: 'rate limit' });
    expect(claudeCode.parseEvent(ndjson({ type: 'result', result: 'ok' }))).toEqual({
      type: 'end',
    });
    expect(claudeCode.parseEvent('not json at all')).toBeUndefined();
    expect(claudeCode.parseEvent(ndjson({ type: 'rate_limit_event' }))).toBeUndefined();
  });
});

describe('CliAgentAdapter', () => {
  it('streams text deltas out of NDJSON, across chunk boundaries', async () => {
    const lines = [
      ndjson({ type: 'system', subtype: 'init' }),
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fix(auth): ' } },
      }),
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'x' } },
      }),
      ndjson({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'reject expired tokens' },
        },
      }),
      ndjson({ type: 'result', is_error: false, result: 'fix(auth): reject expired tokens' }),
    ];
    // No trailing newline on the last line — the adapter must still parse it.
    const script = `process.stdout.write(${JSON.stringify(lines.join('\n'))})`;

    const adapter = new CliAgentAdapter(fakeAgent({ full: script, basic: '' }, 'stream-json'));
    await expect(collect(adapter)).resolves.toBe('fix(auth): reject expired tokens');
  });

  it('throws the agent error message when the run fails', async () => {
    const script = `process.stdout.write(${JSON.stringify(
      ndjson({ type: 'result', is_error: true, result: 'usage limit reached' }),
    )})`;
    const adapter = new CliAgentAdapter(fakeAgent({ full: script, basic: '' }, 'stream-json'));
    await expect(collect(adapter)).rejects.toThrow(/usage limit reached/);
  });

  it('retries with basic flags when the CLI rejects a newer flag', async () => {
    const adapter = new CliAgentAdapter(
      fakeAgent(
        {
          full: `process.stderr.write("error: unknown option '--effort'");process.exit(1)`,
          basic: `process.stdout.write("chore: bump deps")`,
        },
        'stream-json',
      ),
    );
    await expect(collect(adapter)).resolves.toBe('chore: bump deps');
  });

  it('retries when a clap-based CLI calls the flag an "unexpected argument"', async () => {
    const adapter = new CliAgentAdapter(
      fakeAgent(
        {
          full: `process.stderr.write("error: unexpected argument '--ephemeral' found");process.exit(2)`,
          basic: `process.stdout.write("chore: bump deps")`,
        },
        'stream-json',
      ),
    );
    await expect(collect(adapter)).resolves.toBe('chore: bump deps');
  });

  it('explains how to install a missing agent', async () => {
    const adapter = new CliAgentAdapter({
      ...fakeAgent({ full: '', basic: '' }, 'text'),
      command: 'gitmuse-no-such-binary-xyz',
    });
    await expect(collect(adapter)).rejects.toThrow(AgentNotInstalledError);
  });

  it('reports a non-zero exit with the agent stderr', async () => {
    const adapter = new CliAgentAdapter(
      fakeAgent(
        {
          full: `process.stderr.write("something broke");process.exit(2)`,
          basic: `process.stderr.write("something broke");process.exit(2)`,
        },
        'stream-json',
      ),
    );
    await expect(collect(adapter)).rejects.toThrow(ProviderError);
  });

  it('points at the login command when the agent is signed out', async () => {
    const adapter = new CliAgentAdapter(
      fakeAgent(
        {
          full: `process.stderr.write("Please log in to continue");process.exit(1)`,
          basic: `process.stderr.write("Please log in to continue");process.exit(1)`,
        },
        'stream-json',
      ),
    );
    await expect(collect(adapter)).rejects.toThrow(/not signed in/);
  });
});
