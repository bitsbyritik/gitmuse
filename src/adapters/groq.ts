import Groq from 'groq-sdk';
import { BaseAdapter } from './base.js';
import type { GroqConfig } from '../types.js';
import { MissingApiKeyError, ProviderError } from '../errors.js';
import type { TokenUsage } from '../usage.js';

/** The token counts Groq reports, wherever this version happens to put them. */
interface UsageCarrier {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
}

/**
 * Groq sends counts on its own final chunk without `stream_options`, historically
 * nested under `x_groq`. Newer builds also mirror OpenAI's top-level `usage`, and
 * the pinned SDK types only know about the former — so read both rather than bet
 * on one.
 */
function readUsage(chunk: unknown): TokenUsage | undefined {
  const { usage, x_groq } = chunk as UsageCarrier;
  const counts = x_groq?.usage ?? usage;
  if (!counts) return undefined;

  return {
    inputTokens: counts.prompt_tokens ?? 0,
    outputTokens: counts.completion_tokens ?? 0,
  };
}

export class GroqAdapter extends BaseAdapter {
  private readonly client: Groq;
  private readonly model: string;

  constructor(config: GroqConfig) {
    super();
    if (!config.apiKey) throw new MissingApiKeyError('Groq', 'GROQ_API_KEY');
    this.client = new Groq({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    this.usage = undefined;
    let response: Awaited<ReturnType<typeof this.client.chat.completions.create>>;

    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        max_tokens: 512,
        temperature: 0.3,
      });
    } catch (err) {
      throw new ProviderError('groq', err instanceof Error ? err.message : String(err));
    }

    try {
      for await (const chunk of response) {
        const usage = readUsage(chunk);
        if (usage) this.usage = usage;
        const token = chunk.choices[0]?.delta.content;
        if (token) yield token;
      }
    } catch (err) {
      throw new ProviderError('groq', err instanceof Error ? err.message : String(err));
    }
  }
}
