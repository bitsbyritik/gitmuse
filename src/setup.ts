import { select, input, confirm } from '@inquirer/prompts';
import type { Config, ProviderName } from './types.js';
import { saveConfig } from './config.js';
import { logger } from './logger.js';

const PROVIDER_LABELS: Record<ProviderName, string> = {
  ollama: 'Ollama    — local, free, offline (requires: ollama serve)',
  groq: 'Groq      — cloud, free tier, very fast',
  gemini: 'Gemini    — cloud, free tier (aistudio.google.com — no credit card)',
  openai: 'OpenAI    — gpt-4o-mini, paid',
  anthropic: 'Anthropic — claude-haiku, paid',
  custom: 'Custom    — any OpenAI-compatible endpoint',
};

/** Interactive first-run wizard. Persists provider + credentials on completion. */
export async function setup(): Promise<void> {
  console.log('\n  gitmuse setup\n');

  const provider = await select<ProviderName>({
    message: 'Which AI provider would you like to use?',
    choices: (Object.entries(PROVIDER_LABELS) as [ProviderName, string][]).map(
      ([value, name]) => ({ value, name }),
    ),
  });

  const partial: Partial<Config> = { provider };

  switch (provider) {
    case 'groq': {
      const apiKey = await input({
        message: 'Groq API key (free at console.groq.com):',
        validate: (v) => v.trim().length > 0 || 'API key cannot be empty',
      });
      partial.groq = { apiKey: apiKey.trim(), model: 'llama-3.3-70b-versatile' };
      break;
    }

    case 'openai': {
      const apiKey = await input({
        message: 'OpenAI API key:',
        validate: (v) => v.trim().length > 0 || 'API key cannot be empty',
      });
      partial.openai = { apiKey: apiKey.trim(), model: 'gpt-4o-mini' };
      break;
    }

    case 'anthropic': {
      const apiKey = await input({
        message: 'Anthropic API key:',
        validate: (v) => v.trim().length > 0 || 'API key cannot be empty',
      });
      partial.anthropic = { apiKey: apiKey.trim(), model: 'claude-haiku-4-5' };
      break;
    }

    case 'gemini': {
      const apiKey = await input({
        message: 'Gemini API key (free at aistudio.google.com):',
        validate: (v) => v.trim().length > 0 || 'API key cannot be empty',
      });
      partial.gemini = { apiKey: apiKey.trim(), model: 'gemini-2.5-flash' };
      break;
    }

    case 'custom': {
      const baseURL = await input({
        message: 'Base URL (e.g. http://localhost:1234/v1):',
        validate: (v) =>
          v.trim().startsWith('http') || 'Must be a valid http/https URL',
      });
      const model = await input({
        message: 'Model name:',
        validate: (v) => v.trim().length > 0 || 'Model name cannot be empty',
      });
      const apiKey = await input({
        message: 'API key (leave blank if not required):',
      });
      partial.custom = {
        baseURL: baseURL.trim(),
        model: model.trim(),
        apiKey: apiKey.trim() || undefined,
      };
      break;
    }

    case 'ollama':
      logger.dim('  Using http://localhost:11434 with model llama3');
      logger.dim('  Change model anytime: gm config set ollama.model <name>');
      break;
  }

  const useEmoji = await confirm({
    message: 'Include emoji in commit messages?',
    default: false,
  });
  partial.emoji = useEmoji;

  // Persist everything atomically at the end
  saveConfig(partial);

  logger.success(`Setup complete — provider: ${provider}`);
  console.log('\n  Run `gm` inside any git repo to generate your first commit message.\n');
}
