import type { HttpProviderName, ProviderName } from './types.js';
import type { TokenUsage } from './usage.js';

/** USD per million tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * When these numbers were last checked against each vendor's own pricing page.
 * A stale price is worse than no price, so anything not listed here shows token
 * counts and no cost at all — gitmuse never guesses a dollar figure.
 */
export const PRICES_CHECKED = '2026-08-19';

/**
 * First-party list prices, USD per million tokens.
 *
 * Sources: platform.openai.com/docs/pricing, ai.google.dev/gemini-api/docs/pricing,
 * console.groq.com/docs/models, and Anthropic's published API rates. Groq model
 * ids are namespaced — `openai/gpt-oss-120b`, not `gpt-oss-120b`.
 *
 * Deliberately excluded: batch and cache discounts (gitmuse uses neither), and
 * Gemini 2.5 Pro's >200K-token tier (a commit prompt never reaches it).
 */
const PRICES: Partial<Record<HttpProviderName, Record<string, ModelPrice>>> = {
  openai: {
    'gpt-4o-mini': { input: 0.15, output: 0.6 },
    'gpt-4o': { input: 2.5, output: 10 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    'gpt-5-nano': { input: 0.05, output: 0.4 },
  },
  anthropic: {
    'claude-haiku-4-5': { input: 1, output: 5 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-sonnet-5': { input: 3, output: 15 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-opus-5': { input: 5, output: 25 },
    'claude-fable-5': { input: 10, output: 50 },
  },
  gemini: {
    'gemini-2.5-flash': { input: 0.3, output: 2.5 },
    'gemini-2.5-flash-lite': { input: 0.1, output: 0.4 },
    'gemini-2.5-pro': { input: 1.25, output: 10 },
  },
  groq: {
    'openai/gpt-oss-120b': { input: 0.15, output: 0.6 },
    'openai/gpt-oss-20b': { input: 0.075, output: 0.3 },
    'qwen/qwen3.6-27b': { input: 0.6, output: 3 },
  },
};

/** Strips the decorations vendors append to an otherwise-known model id. */
function normalize(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/-latest$/, '')
    .replace(/-preview$/, '')
    .replace(/-\d{8}$/, ''); // dated snapshot, e.g. claude-haiku-4-5-20251001
}

/**
 * The price for this model, or undefined when gitmuse does not know it —
 * which includes every connected agent, since those bill a subscription
 * rather than this request. Ollama is free: it runs on the user's machine.
 */
export function priceFor(provider: ProviderName, model: string): ModelPrice | undefined {
  if (provider === 'ollama') return { input: 0, output: 0 };

  const table = PRICES[provider as HttpProviderName];
  if (!table) return undefined;

  return table[normalize(model)];
}

/** What this generation cost, in dollars. */
export function costOf(usage: TokenUsage, price: ModelPrice): number {
  return (
    (usage.inputTokens / 1_000_000) * price.input +
    (usage.outputTokens / 1_000_000) * price.output
  );
}
