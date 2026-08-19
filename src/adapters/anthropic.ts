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
    this.usage = undefined;

    try {
      const msgStream = this.client.messages.stream({
        model: this.model,
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      });

      // Input arrives up front on message_start; the running output count is
      // repeated on message_delta, with the last one being final. No cache
      // accounting here — gitmuse sends no cache_control, so every input token
      // is charged at the full rate.
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of msgStream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
          outputTokens = event.message.usage.output_tokens;
        }
        if (event.type === 'message_delta') outputTokens = event.usage.output_tokens;
        if (event.type === 'content_block_delta') {
          yield event.delta.text;
        }
      }

      if (inputTokens || outputTokens) this.usage = { inputTokens, outputTokens };
    } catch (err) {
      throw new ProviderError('anthropic', err instanceof Error ? err.message : String(err));
    }
  }
}
