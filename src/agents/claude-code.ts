import type {
  AgentAuth,
  AgentEvent,
  AgentInvocation,
  AgentParseState,
  ArgTier,
  CliAgent,
} from './types.js';

/**
 * Replaces Claude Code's own coding-agent system prompt. gitmuse sends a
 * self-contained prompt, so the harness persona only makes the model reach for
 * tools it does not need here.
 */
const SYSTEM_PROMPT =
  'You generate git commit messages. Follow the user message exactly and reply ' +
  'with the commit message alone — no tools, no preamble, no explanation.';

interface AuthStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  subscriptionType?: string;
  email?: string;
}

interface StreamJsonLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  event?: {
    type?: string;
    delta?: { type?: string; text?: string };
  };
}

/**
 * Claude Code — https://code.claude.com
 *
 * Runs on whatever the local `claude` CLI is signed in to: a Claude Pro/Max
 * subscription, or an API key if that is how the user set it up. gitmuse never
 * reads or stores the credential; the CLI owns it.
 */
export const claudeCode: CliAgent = {
  id: 'claude-code',
  name: 'Claude Code',
  vendor: 'Anthropic',
  tagline: 'runs on your Claude subscription, no API key',
  command: 'claude',
  models: ['sonnet', 'haiku', 'opus'],
  install: 'npm install -g @anthropic-ai/claude-code',
  loginCommand: 'claude auth login',
  docsUrl: 'https://code.claude.com/docs',

  versionArgs: ['--version'],
  authArgs: ['auth', 'status', '--json'],

  parseAuth(stdout: string): AgentAuth {
    let json: AuthStatusJson;
    try {
      json = JSON.parse(stdout.trim()) as AuthStatusJson;
    } catch {
      // Older CLIs print human-readable text — fall back to a loose match.
      return { connected: /logged\s*in|signed\s*in/i.test(stdout) };
    }

    return {
      connected: json.loggedIn === true,
      account: json.email,
      plan: json.subscriptionType,
      method: json.authMethod,
    };
  },

  buildInvocation(model: string, tier: ArgTier): AgentInvocation {
    // Flags every supported CLI version understands.
    const base = [
      '-p',
      '--model',
      model,
      '--output-format',
      'stream-json',
      '--include-partial-messages',
      '--verbose',
    ];

    if (tier === 'basic') {
      // Widest possible compatibility: no streaming, no newer flags.
      return { args: ['-p', '--model', model, '--output-format', 'text'], format: 'text' };
    }

    return {
      args: [
        ...base,
        '--system-prompt',
        SYSTEM_PROMPT,
        // A commit message needs no deep reasoning — keep it fast and cheap.
        '--effort',
        'low',
        // Ignore the user's settings, skills, MCP servers and session history:
        // gitmuse wants a plain completion, not their whole environment.
        '--setting-sources',
        '',
        '--disable-slash-commands',
        '--strict-mcp-config',
        '--no-session-persistence',
      ],
      format: 'stream-json',
    };
  },

  // Claude Code's stream never repeats itself, so the per-run state is unused.
  parseEvent(line: string, _state: AgentParseState): AgentEvent | undefined {
    let json: StreamJsonLine;
    try {
      json = JSON.parse(line) as StreamJsonLine;
    } catch {
      return undefined; // not NDJSON — ignore
    }

    if (json.type === 'stream_event') {
      const delta = json.event?.delta;
      // text_delta only — thinking_delta and tool input are not the message.
      if (json.event?.type === 'content_block_delta' && delta?.type === 'text_delta') {
        return delta.text ? { type: 'text', text: delta.text } : undefined;
      }
      return undefined;
    }

    if (json.type === 'result') {
      if (json.is_error) {
        return {
          type: 'error',
          message: json.result?.trim() || json.subtype || 'the agent reported an error',
        };
      }
      return { type: 'end' };
    }

    return undefined;
  },
};
