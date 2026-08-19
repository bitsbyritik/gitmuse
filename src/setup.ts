import type { Config, ProviderName } from './types.js';
import { saveConfig } from './config.js';
import { logger } from './logger.js';
import { askSelect, askText, askConfirm, intro, outro } from './ui.js';

interface ProviderChoice {
  label: string;
  hint: string;
}

const PROVIDERS: Record<ProviderName, ProviderChoice> = {
  'claude-code': { label: 'Claude Code', hint: 'runs on your Claude subscription — no API key' },
  codex: { label: 'Codex CLI', hint: 'runs on your ChatGPT plan — no API key' },
  cursor: { label: 'Cursor CLI', hint: 'runs on your Cursor subscription — no API key' },
  ollama: { label: 'Ollama', hint: 'local, free, offline — requires: ollama serve' },
  groq: { label: 'Groq', hint: 'cloud, free tier, very fast' },
  gemini: { label: 'Gemini', hint: 'cloud, free tier — no credit card' },
  openai: { label: 'OpenAI', hint: 'gpt-4o-mini, paid' },
  anthropic: { label: 'Anthropic', hint: 'claude-haiku, paid' },
  custom: { label: 'Custom', hint: 'any OpenAI-compatible endpoint' },
};

const required =
  (what: string) =>
  (value: string): string | undefined =>
    value.trim().length > 0 ? undefined : `${what} cannot be empty`;

/** Interactive first-run wizard. Persists provider + credentials on completion. */
export async function setup(): Promise<void> {
  intro('setup');

  const provider = await askSelect<ProviderName>({
    message: 'Which AI provider would you like to use?',
    options: (Object.entries(PROVIDERS) as [ProviderName, ProviderChoice][]).map(
      ([value, { label, hint }]) => ({ value, label, hint }),
    ),
  });

  const partial: Partial<Config> = { provider };

  switch (provider) {
    case 'claude-code':
    case 'codex':
    case 'cursor': {
      // Agents are connected, not keyed — hand off to the connect flow, which
      // finds the CLI, checks the sign-in, and saves the provider itself.
      const { findAgent } = await import('./agents/index.js');
      const { connectAgent } = await import('./connect.js');
      const agent = findAgent(provider);
      const connected = agent ? await connectAgent(agent, { nested: true }) : false;

      if (!connected) {
        logger.warn('Setup stopped — provider unchanged. Run `gitmuse connect` to retry.');
        return;
      }
      break;
    }

    case 'groq': {
      const apiKey = await askText({
        message: 'Groq API key',
        placeholder: 'free at console.groq.com',
        validate: required('API key'),
      });
      partial.groq = { apiKey: apiKey.trim(), model: 'openai/gpt-oss-120b' };
      break;
    }

    case 'openai': {
      const apiKey = await askText({
        message: 'OpenAI API key',
        validate: required('API key'),
      });
      partial.openai = { apiKey: apiKey.trim(), model: 'gpt-4o-mini' };
      break;
    }

    case 'anthropic': {
      const apiKey = await askText({
        message: 'Anthropic API key',
        validate: required('API key'),
      });
      partial.anthropic = { apiKey: apiKey.trim(), model: 'claude-haiku-4-5' };
      break;
    }

    case 'gemini': {
      const apiKey = await askText({
        message: 'Gemini API key',
        placeholder: 'free at aistudio.google.com',
        validate: required('API key'),
      });
      partial.gemini = { apiKey: apiKey.trim(), model: 'gemini-2.5-flash' };
      break;
    }

    case 'custom': {
      const baseURL = await askText({
        message: 'Base URL',
        placeholder: 'http://localhost:1234/v1',
        validate: (value) =>
          value.trim().startsWith('http') ? undefined : 'Must be a valid http/https URL',
      });
      const model = await askText({
        message: 'Model name',
        validate: required('Model name'),
      });
      const apiKey = await askText({
        message: 'API key',
        placeholder: 'leave blank if not required',
        defaultValue: '',
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
      logger.dim('  Change model anytime: gitmuse config set ollama.model <name>');
      break;
  }

  const useEmoji = await askConfirm({
    message: 'Include emoji in commit messages?',
    initialValue: false,
  });
  partial.emoji = useEmoji;

  // Persist everything atomically at the end
  saveConfig(partial);

  outro(`Ready — provider: ${provider}. Run \`gitmuse\` in any git repo.`);
}
