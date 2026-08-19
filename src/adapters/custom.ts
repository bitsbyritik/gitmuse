import OpenAI from 'openai';
import { BaseAdapter } from './base.js';
import type { CustomConfig } from '../types.js';
import { ConfigError, ProviderError } from '../errors.js';

export class CustomAdapter extends BaseAdapter {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(config: CustomConfig) {
    super();
    if (!config.baseURL) {
      throw new ConfigError(
        'Custom provider requires a baseURL. Run `gm setup` or: gm config set custom.baseURL <url>',
      );
    }
    if (!config.model) {
      throw new ConfigError(
        'Custom provider requires a model name. Run: gm config set custom.model <name>',
      );
    }
    // Many local servers accept any non-empty API key string
    this.client = new OpenAI({
      apiKey: config.apiKey ?? 'placeholder',
      baseURL: config.baseURL,
    });
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
      throw new ProviderError('custom', err instanceof Error ? err.message : String(err));
    }

    try {
      for await (const chunk of response) {
        // `stream_options` is deliberately not requested here — plenty of
        // OpenAI-compatible servers reject unknown parameters outright. Usage is
        // reported only if the server volunteers it.
        if (chunk.usage) {
          this.usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
        const token = chunk.choices[0]?.delta.content;
        if (token) yield token;
      }
    } catch (err) {
      throw new ProviderError('custom', err instanceof Error ? err.message : String(err));
    }
  }
}
