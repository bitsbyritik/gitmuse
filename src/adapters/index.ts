import type { Config } from '../types.js';
import type { BaseAdapter } from './base.js';
import { ConfigError } from '../errors.js';

/**
 * Instantiates and returns the correct adapter for config.provider.
 * Dynamic imports keep unused provider SDKs out of the startup bundle.
 */
export async function resolveAdapter(config: Config): Promise<BaseAdapter> {
  switch (config.provider) {
    case 'ollama': {
      const { OllamaAdapter } = await import('./ollama.js');
      return new OllamaAdapter(config.ollama);
    }
    case 'openai': {
      const { OpenAIAdapter } = await import('./openai.js');
      return new OpenAIAdapter(config.openai);
    }
    case 'groq': {
      const { GroqAdapter } = await import('./groq.js');
      return new GroqAdapter(config.groq);
    }
    case 'anthropic': {
      const { AnthropicAdapter } = await import('./anthropic.js');
      return new AnthropicAdapter(config.anthropic);
    }
    case 'gemini': {
      const { GeminiAdapter } = await import('./gemini.js');
      return new GeminiAdapter(config.gemini);
    }
    case 'custom': {
      const { CustomAdapter } = await import('./custom.js');
      return new CustomAdapter(config.custom);
    }
    default: {
      const _exhaustive: never = config.provider;
      throw new ConfigError(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}
