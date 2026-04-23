import Anthropic from '@anthropic-ai/sdk';
import { BaseAdapter } from './base.js';
import type { AnthropicConfig } from '../types.js';
import { MissingApiKeyError, ProviderError } from '../errors.js';

export class AnthropicAdapter extends BaseAdapter {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: AnthropicConfig) {
    super();
    if (!config.apiKey) throw new MissingApiKeyError('Anthropic', 'ANTHROPIC_API_KEY');
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.model = config.model;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    try {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      for await (const event of stream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
    } catch (err) {
      throw new ProviderError('anthropic', err instanceof Error ? err.message : String(err));
    }
  }
}
