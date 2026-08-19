import type { AgentAuth, AgentEvent, AgentInvocation, ArgTier, CliAgent } from './types.js';

/**
 * Sentinel model meaning "whatever Codex is already configured to use".
 *
 * Which slugs an account may request depends on the plan and the CLI version —
 * asking for one the account cannot use fails the whole run with a 400 — so the
 * safe default is to name no model at all.
 */
const DEFAULT_MODEL = 'default';

interface CodexEventLine {
  type?: string;
  message?: string;
  item?: { type?: string; text?: string };
  error?: { message?: string };
}

/** Codex wraps API failures as a JSON string; dig out the human sentence. */
function readable(message: string | undefined): string | undefined {
  const trimmed = message?.trim();
  if (!trimmed) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as { error?: { message?: string }; message?: string };
    return parsed.error?.message?.trim() || parsed.message?.trim() || trimmed;
  } catch {
    return trimmed;
  }
}

/**
 * Codex CLI — https://developers.openai.com/codex/cli
 *
 * Runs on whatever the local `codex` CLI is signed in to: a ChatGPT
 * Plus/Pro/Business plan, or an API key if that is how the user set it up.
 * gitmuse never reads or stores the credential; the CLI owns it.
 */
export const codexCli: CliAgent = {
  id: 'codex',
  name: 'Codex CLI',
  vendor: 'OpenAI',
  tagline: 'runs on your ChatGPT plan, no API key',
  command: 'codex',
  models: [DEFAULT_MODEL, 'gpt-5.5', 'gpt-5.4-mini'],
  install: 'npm install -g @openai/codex',
  loginCommand: 'codex login',
  docsUrl: 'https://developers.openai.com/codex/cli',

  versionArgs: ['--version'],
  authArgs: ['login', 'status'],

  parseAuth(stdout: string): AgentAuth {
    // `codex login status` prints one line and exits 1 when signed out. It
    // reports the method only — no email, no plan — and the API-key line ends
    // with a fragment of the key itself, which gitmuse deliberately drops.
    const line = stdout.trim();
    if (!/logged\s*in/i.test(line) || /not\s+logged\s*in/i.test(line)) {
      return { connected: false };
    }

    const method = /api key/i.test(line)
      ? 'api-key'
      : /chatgpt/i.test(line)
        ? 'chatgpt'
        : /token/i.test(line)
          ? 'token'
          : undefined;

    return { connected: true, method };
  },

  buildInvocation(model: string, tier: ArgTier): AgentInvocation {
    // Flags every supported CLI version understands.
    const base = [
      'exec',
      // NDJSON on stdout. Without it Codex prints a decorated transcript that
      // no parser should have to reverse-engineer.
      '--json',
      // gitmuse runs the agent from a temp dir, not the user's repo.
      '--skip-git-repo-check',
      // A commit message needs no write access to anything.
      '--sandbox',
      'read-only',
      ...(model && model !== DEFAULT_MODEL ? ['--model', model] : []),
    ];

    if (tier === 'basic') return { args: base, format: 'stream-json' };

    return {
      args: [
        ...base,
        '--color',
        'never',
        // Leave no session file behind for a one-shot commit message.
        '--ephemeral',
        // A commit message needs no deep reasoning — keep it fast and cheap.
        '-c',
        'model_reasoning_effort="low"',
      ],
      format: 'stream-json',
    };
  },

  parseEvent(line: string): AgentEvent | undefined {
    let json: CodexEventLine;
    try {
      json = JSON.parse(line) as CodexEventLine;
    } catch {
      return undefined; // not NDJSON — ignore
    }

    switch (json.type) {
      case 'item.completed': {
        // reasoning, command_execution and todo items are not the message.
        if (json.item?.type !== 'agent_message') return undefined;
        return json.item.text ? { type: 'text', text: json.item.text } : undefined;
      }

      case 'error':
        return { type: 'error', message: readable(json.message) ?? 'the agent reported an error' };

      case 'turn.failed':
        return {
          type: 'error',
          message: readable(json.error?.message) ?? 'the agent reported an error',
        };

      case 'turn.completed':
        return { type: 'end' };

      default:
        return undefined;
    }
  },
};
