import { BaseAdapter } from './base.js';
import type { OllamaConfig } from '../types.js';
import { ProviderError } from '../errors.js';

interface OllamaChunk {
  response?: string;
  done?: boolean;
  error?: string;
}

export class OllamaAdapter extends BaseAdapter {
  private readonly config: OllamaConfig;

  constructor(config: OllamaConfig) {
    super();
    this.config = config;
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const url = `${this.config.baseURL}/api/generate`;
    let response: Response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.config.model, prompt, stream: true }),
      });
    } catch {
      throw new ProviderError(
        'ollama',
        `Could not connect to Ollama at ${this.config.baseURL}. ` +
          'Is it running? Start it with: ollama serve',
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new ProviderError('ollama', `HTTP ${String(response.status)}: ${text}`);
    }

    if (!response.body) throw new ProviderError('ollama', 'Empty response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // Keep the last (possibly incomplete) line in the buffer
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let chunk: OllamaChunk;
          try {
            chunk = JSON.parse(line) as OllamaChunk;
          } catch {
            continue; // skip malformed lines
          }
          if (chunk.error) throw new ProviderError('ollama', chunk.error);
          if (chunk.response) yield chunk.response;
          if (chunk.done) return;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
