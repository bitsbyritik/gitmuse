import { describe, it, expect } from 'vitest';
import { claudeCode } from '../src/agents/claude-code.js';
import { codexCli } from '../src/agents/codex.js';
import { cursorCli } from '../src/agents/cursor.js';
import {
  CLI_AGENTS,
  findAgent,
  isAgentProvider,
  listModels,
  resolveCommand,
  resolveModel,
} from '../src/agents/index.js';
import { locateBinary, runCli } from '../src/agents/detect.js';
import { CliAgentAdapter } from '../src/adapters/cli-agent.js';
import type {
  AgentEvent,
  AgentInvocation,
  AgentModel,
  AgentParseState,
  ArgTier,
  CliAgent,
} from '../src/agents/types.js';
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

/** parseEvent with a throwaway per-run state, for one-off assertions. */
function parse(agent: CliAgent, line: string, state: AgentParseState = {}): AgentEvent | undefined {
  return agent.parseEvent(line, state);
}

describe('agent registry', () => {
  it('registers claude-code, codex and cursor — and nothing else', () => {
    expect(findAgent('claude-code')).toBe(claudeCode);
    expect(findAgent('codex')).toBe(codexCli);
    expect(findAgent('cursor')).toBe(cursorCli);
    expect(CLI_AGENTS).toEqual([claudeCode, codexCli, cursorCli]);
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
    expect(isAgentProvider('cursor')).toBe(true);
  });

  it('prefers configured command and model over the defaults', () => {
    expect(resolveCommand(claudeCode)).toBe('claude');
    expect(resolveCommand(claudeCode, { command: '/opt/claude' })).toBe('/opt/claude');
    expect(resolveModel(claudeCode)).toBe('sonnet');
    expect(resolveModel(claudeCode, { model: 'opus' })).toBe('opus');

    expect(resolveCommand(codexCli)).toBe('codex');
    expect(resolveModel(codexCli)).toBe('default');
    expect(resolveModel(codexCli, { model: 'gpt-5.5' })).toBe('gpt-5.5');

    expect(resolveCommand(cursorCli)).toBe('cursor-agent');
    expect(resolveModel(cursorCli)).toBe('auto');
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
      parse(codexCli, 
        ndjson({ type: 'item.completed', item: { type: 'agent_message', text: 'fix: x' } }),
      ),
    ).toEqual({ type: 'text', text: 'fix: x' });

    expect(
      parse(codexCli, 
        ndjson({ type: 'item.completed', item: { type: 'reasoning', text: 'hmm' } }),
      ),
    ).toBeUndefined();
    expect(
      parse(codexCli, 
        ndjson({ type: 'item.completed', item: { type: 'command_execution', text: 'ls' } }),
      ),
    ).toBeUndefined();
    expect(parse(codexCli, ndjson({ type: 'thread.started', thread_id: 'x' }))).toBeUndefined();
    expect(parse(codexCli, 'Shell cwd was reset to /tmp')).toBeUndefined();
  });

  it('ends on a completed turn, and reports usage when Codex sends any', () => {
    // An empty usage object is not usage — "0 in · 0 out" is worse than silence.
    expect(parse(codexCli, ndjson({ type: 'turn.completed', usage: {} }))).toEqual({
      type: 'end',
    });

    // Codex's input_tokens already includes the cached part, so it is not summed.
    expect(
      parse(
        codexCli,
        ndjson({
          type: 'turn.completed',
          usage: {
            input_tokens: 17885,
            cached_input_tokens: 16768,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        }),
      ),
    ).toEqual({
      type: 'usage',
      usage: {
        inputTokens: 17885,
        outputTokens: 5,
        cachedInputTokens: 16768,
        reasoningTokens: 2,
      },
    });
  });

  it('unwraps the API error Codex nests inside a JSON string', () => {
    const nested = JSON.stringify({
      type: 'error',
      status: 400,
      error: { type: 'invalid_request_error', message: 'model is not supported' },
    });

    expect(parse(codexCli, ndjson({ type: 'error', message: nested }))).toEqual({
      type: 'error',
      message: 'model is not supported',
    });
    expect(
      parse(codexCli, ndjson({ type: 'turn.failed', error: { message: nested } })),
    ).toEqual({ type: 'error', message: 'model is not supported' });
  });

  it('falls back to the raw message when it is not nested JSON', () => {
    expect(parse(codexCli, ndjson({ type: 'error', message: 'stream disconnected' }))).toEqual({
      type: 'error',
      message: 'stream disconnected',
    });
    expect(parse(codexCli, ndjson({ type: 'turn.failed' }))).toEqual({
      type: 'error',
      message: 'the agent reported an error',
    });
  });
});

describe('cursor definition', () => {
  it('runs print mode with NDJSON and read-only ask mode', () => {
    const { args, format } = cursorCli.buildInvocation('composer-2.5', 'full');
    expect(args).toContain('-p');
    expect(args[args.indexOf('--output-format') + 1]).toBe('stream-json');
    expect(args[args.indexOf('--model') + 1]).toBe('composer-2.5');
    expect(args[args.indexOf('--mode') + 1]).toBe('ask');
    expect(args).toContain('--trust');
    expect(args).toContain('--stream-partial-output');
    expect(format).toBe('stream-json');
  });

  it('drops the newer flags on the basic tier', () => {
    const { args } = cursorCli.buildInvocation('auto', 'basic');
    expect(args).toEqual(['-p', '--output-format', 'stream-json', '--model', 'auto']);
  });

  it('reads status JSON, and the human line from older builds', () => {
    expect(
      cursorCli.parseAuth?.(
        '{"status":"authenticated","isAuthenticated":true,"userInfo":{"email":"a@b.c"}}',
      ),
    ).toEqual({ connected: true, account: 'a@b.c' });

    expect(cursorCli.parseAuth?.('{"isAuthenticated":false}').connected).toBe(false);
    expect(cursorCli.parseAuth?.('✓ Logged in as a@b.c')).toEqual({
      connected: true,
      account: 'a@b.c',
    });
    expect(cursorCli.parseAuth?.('Not logged in').connected).toBe(false);
  });

  it('separates the CLI default from the model the account is set to', () => {
    const models = cursorCli.listModels?.parse(
      [
        'Available models',
        '',
        'auto - Auto (default)',
        'composer-2.5 - Composer 2.5 (current)',
        'gpt-5.2 - GPT-5.2 (current, default)',
        'not a model line',
      ].join('\n'),
    );

    expect(models).toEqual([
      { id: 'auto', label: 'Auto', current: false, isDefault: true },
      { id: 'composer-2.5', label: 'Composer 2.5', current: true, isDefault: false },
      { id: 'gpt-5.2', label: 'GPT-5.2', current: true, isDefault: true },
    ]);
  });

  it('keeps a parenthetical that is part of the model name', () => {
    const models = cursorCli.listModels?.parse(
      'claude-fable-5-high - Claude Fable 5 1M (NO ZDR)\nx-1 - X One (current)',
    );

    expect(models?.[0]).toEqual({
      id: 'claude-fable-5-high',
      label: 'Claude Fable 5 1M (NO ZDR)',
      current: false,
      isDefault: false,
    });
    expect(models?.[1]?.label).toBe('X One');
  });

  it('streams deltas and drops the assembled repeat that follows them', () => {
    const state: AgentParseState = {};
    const delta = (text: string, ts?: number): string =>
      ndjson({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
        ...(ts === undefined ? {} : { timestamp_ms: ts }),
      });

    expect(parse(cursorCli, delta('fix', 1), state)).toEqual({ type: 'text', text: 'fix' });
    expect(parse(cursorCli, delta(': x', 2), state)).toEqual({ type: 'text', text: ': x' });
    // Cursor repeats the whole message once the deltas are done.
    expect(parse(cursorCli, delta('fix: x'), state)).toBeUndefined();
  });

  it('uses the assembled message when no deltas arrived', () => {
    const whole = ndjson({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'chore: bump' }] },
    });
    expect(parse(cursorCli, whole)).toEqual({ type: 'text', text: 'chore: bump' });
  });

  it('ignores thinking, init and user echo events', () => {
    expect(
      parse(cursorCli, ndjson({ type: 'thinking', subtype: 'delta', text: 'hmm' })),
    ).toBeUndefined();
    expect(parse(cursorCli, ndjson({ type: 'system', subtype: 'init' }))).toBeUndefined();
    expect(parse(cursorCli, ndjson({ type: 'user', message: {} }))).toBeUndefined();
    expect(parse(cursorCli, 'not json')).toBeUndefined();
  });

  it('sums the cache tokens Cursor reports separately from input', () => {
    // Verified live: the same prompt twice gave 7017+10227 and 11243+6001 —
    // both exactly 17244, so the parts sum to the real prompt size.
    expect(
      parse(
        cursorCli,
        ndjson({
          type: 'result',
          usage: {
            inputTokens: 7017,
            outputTokens: 33,
            cacheReadTokens: 10227,
            cacheWriteTokens: 0,
          },
        }),
      ),
    ).toEqual({
      type: 'usage',
      usage: { inputTokens: 17244, outputTokens: 33, cachedInputTokens: 10227 },
    });
  });

  it('surfaces result errors and ends on success', () => {
    expect(
      parse(cursorCli, ndjson({ type: 'result', is_error: true, result: 'usage limit' })),
    ).toEqual({ type: 'error', message: 'usage limit' });
    expect(parse(cursorCli, ndjson({ type: 'result', subtype: 'success' }))).toEqual({
      type: 'end',
    });
  });
});

describe('CLI detection', () => {
  it('finds a binary that is on PATH', async () => {
    const found = await locateBinary(process.platform === 'win32' ? 'node.exe' : 'node');
    expect(found.path).toBeTruthy();
    expect(found.offPath).toBeUndefined();
  });

  it('accepts an absolute path as given', async () => {
    const found = await locateBinary(process.execPath);
    expect(found.path).toBe(process.execPath);
  });

  it('reports nothing for a binary that does not exist', async () => {
    expect(await locateBinary('gitmuse-no-such-binary-xyz')).toEqual({});
    expect(await locateBinary('/nonexistent/gitmuse-xyz')).toEqual({});
  });

  it('never throws — a missing binary comes back as data', async () => {
    const result = await runCli('gitmuse-no-such-binary-xyz', ['--version'], 5_000);
    expect(result.ok).toBe(false);
    expect(result.missing).toBe(true);
  });

  it('reports stdout, stderr and the exit code of a real run', async () => {
    const ok = await runCli(process.execPath, ['-e', 'process.stdout.write("hi")'], 5_000);
    expect(ok).toMatchObject({ ok: true, stdout: 'hi', output: 'hi', missing: false });

    const bad = await runCli(
      process.execPath,
      ['-e', 'process.stderr.write("nope");process.exit(2)'],
      5_000,
    );
    expect(bad.ok).toBe(false);
    expect(bad.exitCode).toBe(2);
    // stdout was empty, so the status the CLI actually printed is on stderr.
    expect(bad.output).toBe('nope');
  });

  it('gives up on a hung CLI instead of blocking', async () => {
    const result = await runCli(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], 300);
    expect(result.timedOut).toBe(true);
    expect(result.ok).toBe(false);
  });
});

describe('listModels', () => {
  it('asks the CLI and marks the answer live', async () => {
    const agent: CliAgent = {
      ...cursorCli,
      command: process.execPath,
      listModels: {
        args: [
          '-e',
          'process.stdout.write("a - Model A (current, default)\\nb - Model B")',
        ],
        parse: (stdout: string): AgentModel[] => cursorCli.listModels?.parse(stdout) ?? [],
      },
    };

    await expect(listModels(agent, process.execPath)).resolves.toEqual({
      live: true,
      models: [
        { id: 'a', label: 'Model A', current: true, isDefault: true },
        { id: 'b', label: 'Model B', current: false, isDefault: false },
      ],
    });
  });

  it('falls back to the static list when the CLI cannot answer', async () => {
    const agent: CliAgent = {
      ...cursorCli,
      models: ['auto'],
      listModels: { args: ['-e', 'process.exit(1)'], parse: () => [] },
    };

    await expect(listModels(agent, process.execPath)).resolves.toEqual({
      live: false,
      models: [{ id: 'auto' }],
    });
  });

  it('falls back for agents with no model command at all', async () => {
    await expect(listModels(claudeCode, 'claude')).resolves.toEqual({
      live: false,
      models: [{ id: 'sonnet' }, { id: 'haiku' }, { id: 'opus' }],
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
    const text = parse(claudeCode, 
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'fix: ' } },
      }),
    );
    expect(text).toEqual({ type: 'text', text: 'fix: ' });

    const thinking = parse(claudeCode, 
      ndjson({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
      }),
    );
    expect(thinking).toBeUndefined();
  });

  it('sums the cache tokens Claude reports separately from input', () => {
    // Verified live: a ~10k-token prompt reported input_tokens: 9, with the
    // rest split across cache read and cache creation.
    expect(
      parse(
        claudeCode,
        ndjson({
          type: 'result',
          usage: {
            input_tokens: 9,
            cache_creation_input_tokens: 4368,
            cache_read_input_tokens: 6043,
            output_tokens: 38,
          },
        }),
      ),
    ).toEqual({
      type: 'usage',
      usage: { inputTokens: 10420, outputTokens: 38, cachedInputTokens: 6043 },
    });
  });

  it('surfaces result errors and ignores noise', () => {
    expect(
      parse(claudeCode, ndjson({ type: 'result', is_error: true, result: 'rate limit' })),
    ).toEqual({ type: 'error', message: 'rate limit' });
    expect(parse(claudeCode, ndjson({ type: 'result', result: 'ok' }))).toEqual({
      type: 'end',
    });
    expect(parse(claudeCode, 'not json at all')).toBeUndefined();
    expect(parse(claudeCode, ndjson({ type: 'rate_limit_event' }))).toBeUndefined();
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
