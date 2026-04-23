import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from '@google/generative-ai';
import { BaseAdapter } from './base.js';
import type { GeminiConfig } from '../types.js';
import { MissingApiKeyError, ProviderError } from '../errors.js';

// Free-tier model reference (as of 2025):
// gemini-2.5-flash — default; best free option  (10 req/min, 250K tokens/min)
// gemini-1.5-flash — slightly older, still free  (15 req/min)
// gemini-1.5-pro   — higher quality, tighter limits (2 req/min)

/**
 * Adapter for Google Gemini via the @google/generative-ai SDK.
 * Get a free API key at aistudio.google.com — no credit card required.
 */
export class GeminiAdapter extends BaseAdapter {
  private readonly client: GoogleGenerativeAI;
  private readonly modelName: string;

  constructor(config: GeminiConfig) {
    super();
    if (!config.apiKey) {
      throw new MissingApiKeyError(
        'Gemini',
        'GEMINI_API_KEY (free key at aistudio.google.com — no credit card needed)',
      );
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.modelName = config.model;
  }

  /**
   * Streams commit message tokens from Gemini.
   * Tokens are yielded incrementally as they arrive — callers render in real time.
   */
  async *stream(prompt: string): AsyncIterable<string> {
    try {
      const model = this.client.getGenerativeModel({ model: this.modelName });
      const result = await model.generateContentStream(prompt);

      for await (const chunk of result.stream) {
        let text: string;
        try {
          text = chunk.text();
        } catch {
          // Safety filter or non-text chunk — skip without aborting the stream
          continue;
        }
        if (text) yield text;
      }
    } catch (err) {
      if (err instanceof GoogleGenerativeAIFetchError) {
        if (err.status === 400) {
          throw new ProviderError('gemini', 'Invalid request — check your model name.');
        }
        if (err.status === 401 || err.status === 403) {
          throw new ProviderError(
            'gemini',
            'Invalid or expired API key. Verify it at aistudio.google.com.',
          );
        }
        if (err.status === 429) {
          throw new ProviderError(
            'gemini',
            'Rate limit reached. Wait a moment and try again (free tier: 15 req/min).',
          );
        }
        throw new ProviderError('gemini', `HTTP ${String(err.status)}: ${err.message}`);
      }
      throw new ProviderError('gemini', err instanceof Error ? err.message : String(err));
    }
  }
}
