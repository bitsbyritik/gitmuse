export type ProviderName = 'ollama' | 'openai' | 'groq' | 'anthropic' | 'gemini' | 'custom';

export interface OllamaConfig {
  baseURL: string;
  model: string;
}

export interface OpenAIConfig {
  apiKey?: string;
  model: string;
}

export interface GroqConfig {
  apiKey?: string;
  model: string;
}

export interface AnthropicConfig {
  apiKey?: string;
  model: string;
}

export interface GeminiConfig {
  apiKey?: string;
  model: string;
}

export interface CustomConfig {
  baseURL?: string;
  apiKey?: string;
  model?: string;
}

export interface Config {
  provider: ProviderName;
  model?: string;
  maxDiffLines: number;
  emoji: boolean;
  autoConfirm: boolean;
  language: string;
  ollama: OllamaConfig;
  openai: OpenAIConfig;
  groq: GroqConfig;
  anthropic: AnthropicConfig;
  gemini: GeminiConfig;
  custom: CustomConfig;
}

export interface DiffResult {
  diff: string;
  branch: string;
  staged: boolean;
  lineCount: number;
}

export interface CommitMessage {
  subject: string;
  body?: string;
  raw: string;
}

export interface RunOptions {
  yes?: boolean;
  dryRun?: boolean;
  retry?: boolean;
  provider?: string;
  silent?: boolean;
}

export type TuiAction = 'commit' | 'edit' | 'retry' | 'abort';

export interface TuiResult {
  action: TuiAction;
  message: string;
}
