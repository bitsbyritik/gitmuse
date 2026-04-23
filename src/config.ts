import Conf from 'conf';
import type { Config, ProviderName } from './types.js';
import { ConfigError } from './errors.js';
import { logger } from './logger.js';

export const DEFAULTS: Config = {
  provider: 'ollama',
  maxDiffLines: 200,
  emoji: false,
  autoConfirm: false,
  language: 'en',
  ollama: { baseURL: 'http://localhost:11434', model: 'llama3' },
  openai: { apiKey: undefined, model: 'gpt-4o-mini' },
  groq: { apiKey: undefined, model: 'llama-3.3-70b-versatile' },
  anthropic: { apiKey: undefined, model: 'claude-haiku-4-5' },
  gemini: { apiKey: undefined, model: 'gemini-2.5-flash' },
  custom: { baseURL: undefined, apiKey: undefined, model: undefined },
};

// No defaults passed — so store.has() reliably detects first run.
const store = new Conf<Partial<Config>>({ projectName: 'gitmuse' });

/**
 * Returns the resolved config.
 * Priority: overrides (CLI flags) > env vars > stored file > code defaults.
 */
export function getConfig(overrides: Partial<Config> = {}): Config {
  const stored = store.store as Partial<Config>;

  const envProvider = process.env['GITMUSE_PROVIDER'] as ProviderName | undefined;
  const envModel = process.env['GITMUSE_MODEL'];

  return {
    ...DEFAULTS,
    ...stored,
    provider: overrides.provider ?? envProvider ?? stored.provider ?? DEFAULTS.provider,
    model: overrides.model ?? envModel ?? stored.model,
    maxDiffLines: overrides.maxDiffLines ?? stored.maxDiffLines ?? DEFAULTS.maxDiffLines,
    emoji: overrides.emoji ?? stored.emoji ?? DEFAULTS.emoji,
    autoConfirm: overrides.autoConfirm ?? stored.autoConfirm ?? DEFAULTS.autoConfirm,
    language: overrides.language ?? stored.language ?? DEFAULTS.language,
    ollama: { ...DEFAULTS.ollama, ...stored.ollama, ...overrides.ollama },
    openai: {
      ...DEFAULTS.openai,
      ...stored.openai,
      ...overrides.openai,
      apiKey:
        overrides.openai?.apiKey ??
        process.env['OPENAI_API_KEY'] ??
        stored.openai?.apiKey,
    },
    groq: {
      ...DEFAULTS.groq,
      ...stored.groq,
      ...overrides.groq,
      apiKey:
        overrides.groq?.apiKey ??
        process.env['GROQ_API_KEY'] ??
        stored.groq?.apiKey,
    },
    anthropic: {
      ...DEFAULTS.anthropic,
      ...stored.anthropic,
      ...overrides.anthropic,
      apiKey:
        overrides.anthropic?.apiKey ??
        process.env['ANTHROPIC_API_KEY'] ??
        stored.anthropic?.apiKey,
    },
    gemini: {
      ...DEFAULTS.gemini,
      ...stored.gemini,
      ...overrides.gemini,
      apiKey:
        overrides.gemini?.apiKey ??
        process.env['GEMINI_API_KEY'] ??
        stored.gemini?.apiKey,
    },
    custom: { ...DEFAULTS.custom, ...stored.custom, ...overrides.custom },
  };
}

/** Returns true if the user has never run `gm setup` or manually set config. */
export function isFirstRun(): boolean {
  return !store.has('provider');
}

/**
 * Persists a partial config update.
 * Conf's dot-notation support means nested keys like "groq.apiKey" work automatically.
 */
export function saveConfig(partial: Partial<Config>): void {
  for (const [key, value] of Object.entries(partial)) {
    store.set(key, value);
  }
}

/** Handler for `gm config <action> [key] [value]`. */
export async function manageConfig(
  action: string,
  key?: string,
  value?: string,
): Promise<void> {
  switch (action) {
    case 'list': {
      const cfg = getConfig();
      console.log(JSON.stringify(cfg, null, 2));
      break;
    }

    case 'get': {
      if (!key) throw new ConfigError('`config get` requires a key');
      // Support dot-notation (e.g. groq.apiKey) via conf
      const val = store.get(key as keyof Partial<Config>) ?? (getConfig() as unknown as Record<string, unknown>)[key];
      if (val === undefined) throw new ConfigError(`Unknown key: ${key}`);
      console.log(typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val));
      break;
    }

    case 'set': {
      if (!key || value === undefined) {
        throw new ConfigError('`config set` requires a key and a value');
      }
      // Coerce booleans and numbers
      const parsed: unknown =
        value === 'true'
          ? true
          : value === 'false'
            ? false
            : !isNaN(Number(value)) && value.trim() !== ''
              ? Number(value)
              : value;
      store.set(key, parsed);
      logger.success(`${key} = ${String(parsed)}`);
      break;
    }

    case 'reset': {
      store.clear();
      logger.success('Config reset to defaults');
      break;
    }

    default:
      throw new ConfigError(
        `Unknown config action: "${action}". Valid actions: get, set, list, reset`,
      );
  }
}
