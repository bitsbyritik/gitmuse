export interface Config {
  provider: "ollama" | "openai" | "groq" | "anthropic" | "custom";
  model?: string;
  maxDiffLines: number;
  emoji: boolean;
  autoConfirm: boolean;
  language: string;
  ollama: { baseURL: string; model: string };
  openai: { apiKey?: string; model: string };
  groq: { apiKey?: string; model: string };
  anthropic: { apiKey?: string; model: string };
  custom: { baseURL?: string; apiKey?: string; model?: string };
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
