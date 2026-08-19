import OpenAI from 'openai';
import { BaseAdapter } from './base.js';
import type { OpenAIConfig } from '../types.js';
import { MissingApiKeyError, ProviderError } from '../errors.js';

export class OpenAIAdapter extends BaseAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: OpenAIConfig) {
    super();
    if (!config.apiKey) throw new MissingApiKeyError('OpenAI', 'OPENAI_API_KEY');
    this.client = new OpenAI({ apiKey: config.apiKey });
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
        // Adds a final, choice-less chunk carrying the real token counts.
        stream_options: { include_usage: true },
        max_tokens: 512,
        temperature: 0.3,
      });
    } catch (err) {
      throw new ProviderError('openai', err instanceof Error ? err.message : String(err));
    }

    try {
      for await (const chunk of response) {
        if (chunk.usage) {
          this.usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            cachedInputTokens: chunk.usage.prompt_tokens_details?.cached_tokens || undefined,
          };
        }
        const token = chunk.choices[0]?.delta.content;
        if (token) yield token;
      }
    } catch (err) {
      throw new ProviderError('openai', err instanceof Error ? err.message : String(err));
    }
  }
}
