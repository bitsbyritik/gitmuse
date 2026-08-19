import type {
  AgentAuth,
  AgentEvent,
  AgentInvocation,
  AgentModel,
  AgentParseState,
  ArgTier,
  CliAgent,
} from './types.js';
import { nonEmptyUsage } from '../usage.js';
import type { TokenUsage } from '../usage.js';

interface StatusJson {
  isAuthenticated?: boolean;
  status?: string;
  userInfo?: { email?: string };
}

interface CursorUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

interface StreamJsonLine {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  message?: { content?: { type?: string; text?: string }[] };
  usage?: CursorUsage;
  /** Present on incremental deltas, absent on the assembled final message. */
  timestamp_ms?: number;
}

/**
 * Cursor reports `inputTokens` exclusive of cache, like Claude does — verified
 * by running one prompt twice: 7017+10227 and 11243+6001 both total exactly
 * 17244, so the parts sum to the prompt and the cache split moves between them.
 */
function readUsage(usage: CursorUsage): TokenUsage {
  const cached = usage.cacheReadTokens ?? 0;
  const written = usage.cacheWriteTokens ?? 0;

  return {
    inputTokens: (usage.inputTokens ?? 0) + cached + written,
    outputTokens: usage.outputTokens ?? 0,
    cachedInputTokens: cached || undefined,
  };
}

/** `<id> - <label>`. */
const MODEL_LINE = /^([\w.:@/-]+)\s+-\s+(.+)$/;

/**
 * Trailing "(current)" / "(default)" / "(current, default)" — Cursor's own
 * annotations, which are not part of the model's name. Deliberately narrow:
 * plenty of real labels end in a parenthetical ("Claude Fable 5 1M (NO ZDR)")
 * and those must survive untouched.
 */
const MARKER = /\s*\((current|default)(?:\s*,\s*(current|default))*\)\s*$/i;

/**
 * Cursor CLI — https://cursor.com/docs/cli
 *
 * Runs on whatever the local `cursor-agent` CLI is signed in to: a Cursor
 * subscription, or an API key if that is how the user set it up. gitmuse never
 * reads or stores the credential; the CLI owns it.
 */
export const cursorCli: CliAgent = {
  id: 'cursor',
  name: 'Cursor CLI',
  vendor: 'Cursor',
  tagline: 'runs on your Cursor subscription, no API key',
  command: 'cursor-agent',
  // Only the fallback: `listModels` asks the account what it may actually run,
  // and Cursor's catalogue is both large and account-specific.
  models: ['auto', 'composer-2.5', 'gpt-5.2'],
  install: 'curl https://cursor.com/install -fsS | bash',
  loginCommand: 'cursor-agent login',
  docsUrl: 'https://cursor.com/docs/cli',

  versionArgs: ['--version'],
  authArgs: ['status', '--format', 'json'],

  parseAuth(output: string): AgentAuth {
    let json: StatusJson;
    try {
      json = JSON.parse(output.trim()) as StatusJson;
    } catch {
      // `--format json` is newer than the command itself — fall back to the
      // human line ("✓ Logged in as you@example.com").
      const signedIn =
        /logged\s*in|authenticated/i.test(output) && !/\bnot\s+(logged|authenticated)/i.test(output);
      const email = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/.exec(output)?.[0];
      return { connected: signedIn, account: signedIn ? email : undefined };
    }

    return {
      connected: json.isAuthenticated === true || json.status === 'authenticated',
      account: json.userInfo?.email,
    };
  },

  listModels: {
    args: ['--list-models'],
    parse(stdout: string): AgentModel[] {
      const models: AgentModel[] = [];

      for (const line of stdout.split('\n')) {
        const match = MODEL_LINE.exec(line.trim());
        if (!match) continue; // "Available models" heading, blank lines

        const [, id, label] = match;
        if (!id || !label) continue;

        const marker = MARKER.exec(label);
        const notes = (marker?.[0] ?? '').toLowerCase();

        models.push({
          id,
          label: (marker ? label.slice(0, marker.index) : label).trim(),
          current: notes.includes('current'),
          isDefault: notes.includes('default'),
        });
      }

      return models;
    },
  },

  buildInvocation(model: string, tier: ArgTier): AgentInvocation {
    // Flags every supported CLI version understands.
    const base = ['-p', '--output-format', 'stream-json', ...(model ? ['--model', model] : [])];

    if (tier === 'basic') return { args: base, format: 'stream-json' };

    return {
      args: [
        ...base,
        // Token-by-token deltas instead of one final blob.
        '--stream-partial-output',
        // Q&A mode: read-only, no edits, no shell. Writing a commit message
        // needs none of the agent's tools.
        '--mode',
        'ask',
        // Headless runs otherwise stop on Cursor's workspace-trust prompt.
        // gitmuse runs the agent from a temp dir, never the user's repo.
        '--trust',
      ],
      format: 'stream-json',
    };
  },

  parseEvent(line: string, state: AgentParseState): AgentEvent | undefined {
    let json: StreamJsonLine;
    try {
      json = JSON.parse(line) as StreamJsonLine;
    } catch {
      return undefined; // not NDJSON — ignore
    }

    if (json.type === 'assistant') {
      const text = (json.message?.content ?? [])
        .filter((part) => part.type === 'text' || part.text)
        .map((part) => part.text ?? '')
        .join('');
      if (!text) return undefined;

      // Deltas carry a timestamp; the assembled message that follows them does
      // not. Yielding both would print the reply twice, so the final message is
      // only used when no deltas arrived (older CLI, or the basic tier).
      if (json.timestamp_ms !== undefined) {
        state['streamed'] = true;
        return { type: 'text', text };
      }
      return state['streamed'] ? undefined : { type: 'text', text };
    }

    // "thinking" deltas are reasoning, not the message.
    if (json.type === 'result') {
      if (json.is_error) {
        return {
          type: 'error',
          message: json.result?.trim() || json.subtype || 'the agent reported an error',
        };
      }
      const usage = json.usage && nonEmptyUsage(readUsage(json.usage));
      return usage ? { type: 'usage', usage } : { type: 'end' };
    }

    return undefined;
  },
};
