import Groq from 'groq-sdk';
import { BaseAdapter } from './base.js';
import type { GroqConfig } from '../types.js';
import { MissingApiKeyError, ProviderError } from '../errors.js';

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
        const token = chunk.choices[0]?.delta.content;
        if (token) yield token;
      }
    } catch (err) {
      throw new ProviderError('groq', err instanceof Error ? err.message : String(err));
    }
  }
}
