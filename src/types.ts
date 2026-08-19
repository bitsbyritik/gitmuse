/** Providers gitmuse talks to over HTTP with its own credentials. */
export type HttpProviderName =
  | 'ollama'
  | 'openai'
  | 'groq'
  | 'anthropic'
  | 'gemini'
  | 'custom';

/**
 * Local coding agents gitmuse borrows instead of holding a key — you connect
 * them with `gm connect`. Add a new agent's id here and register it in
 * `src/agents/index.ts`.
 */
export type AgentProviderName = 'claude-code' | 'codex' | 'cursor';

export type ProviderName = HttpProviderName | AgentProviderName;

/** Per-agent settings, stored under `agents.<id>` in the config file. */
export interface AgentSettings {
  /** Override the executable — an absolute path, or another name on PATH. */
  command?: string;
  /** Model to ask the agent for, e.g. "sonnet". */
  model?: string;
  /** How long to wait for a reply before giving up. Default 120000. */
  timeoutMs?: number;
}

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
  agents: Partial<Record<AgentProviderName, AgentSettings>>;
}

/** What kind of file this is — drives type inference and diff budgeting. */
export type FileCategory =
  | 'source'
  | 'test'
  | 'docs'
  | 'config'
  | 'deps'
  | 'ci'
  | 'generated'
  | 'asset';

/** How git says the file changed. */
export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unknown';

export interface StagedFile {
  path: string;
  /** Previous path, for renames and copies. */
  oldPath?: string;
  status: FileStatus;
  insertions: number;
  deletions: number;
  binary: boolean;
  category: FileCategory;
  /** True when this file's diff body was trimmed to fit the budget. */
  trimmed?: boolean;
}

/** What the set of changed files implies, before the model reads any code. */
export interface ChangeEvidence {
  /** Commit type the file mix points to — only set when it is unambiguous. */
  suggestedType?: string;
  /** Why that type, in the model's words. */
  reason?: string;
  /** Scope guessed from the changed paths. */
  suggestedScope?: string;
  /** Other facts worth telling the model (deletions, renames, trimming). */
  notes: string[];
}

export interface DiffResult {
  diff: string;
  branch: string;
  staged: boolean;
  lineCount: number;
  /** Every staged file, with status and churn. */
  files: StagedFile[];
  insertions: number;
  deletions: number;
  /** True when any file's diff body was trimmed. */
  trimmed: boolean;
  evidence: ChangeEvidence;
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
  /** Write the message to this file instead of committing. Used by the git hook. */
  write?: string;
}

export type TuiAction = 'commit' | 'edit' | 'retry' | 'abort';

export interface TuiResult {
  action: TuiAction;
  message: string;
}
