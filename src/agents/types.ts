import type { AgentProviderName } from '../types.js';

/** How a spawned agent's stdout should be read. */
export type AgentFormat = 'stream-json' | 'text';

/** One invocation of an agent's CLI: argv plus how to read its stdout. */
export interface AgentInvocation {
  args: string[];
  format: AgentFormat;
}

/**
 * Argument tier. `full` uses every flag that makes the agent leaner and
 * quieter; `basic` uses only long-standing flags, and is retried automatically
 * when `full` fails because the installed CLI is older than a flag we passed.
 */
export type ArgTier = 'full' | 'basic';

/** A meaningful event parsed out of one line of an agent's stdout. */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'end' };

/** Who you are signed in as, as reported by the agent's own CLI. */
export interface AgentAuth {
  connected: boolean;
  /** Account label — usually an email. */
  account?: string;
  /** Plan or subscription tier, e.g. "pro", "max". */
  plan?: string;
  /** How the CLI is authenticated, e.g. "claude.ai", "api-key". */
  method?: string;
  /** Why it is not connected, when the CLI says. */
  detail?: string;
}

/** Result of looking for an agent's binary on this machine. */
export interface AgentStatus {
  agent: CliAgent;
  /** Resolved command actually probed (config override or the default). */
  command: string;
  installed: boolean;
  version?: string;
  auth?: AgentAuth;
}

/**
 * A local coding agent gitmuse can borrow for inference — you sign in to the
 * agent with your own account, and gitmuse shells out to it. No API key, no
 * tokens stored by gitmuse.
 *
 * Adding an agent is one file: implement this interface and register it in
 * `src/agents/index.ts`. Nothing else in the codebase needs to change.
 */
export interface CliAgent {
  /** Stable id — also the `provider` value users set in config. */
  id: AgentProviderName;
  /** Display name, e.g. "Claude Code". */
  name: string;
  /** Who makes it, e.g. "Anthropic". */
  vendor: string;
  /** One short line on what connecting gets you. */
  tagline: string;
  /** Default executable name; users can override it per agent in config. */
  command: string;
  /** Model names offered when connecting. First entry is the default. */
  models: readonly string[];
  /** Shell command that installs the agent. */
  install: string;
  /** Shell command that signs the user in. */
  loginCommand: string;
  /** Docs link shown when something goes wrong. */
  docsUrl: string;

  /** Args that print a version — used to detect the binary. */
  versionArgs: readonly string[];
  /** Args that report auth status, when the CLI can do that offline. */
  authArgs?: readonly string[];
  /**
   * Parses the output of `authArgs` into an AgentAuth. Receives stdout when the
   * CLI wrote anything there, otherwise stderr — CLIs disagree about which
   * stream status belongs on.
   */
  parseAuth?(output: string): AgentAuth;

  /** Builds one non-interactive invocation for the given model. */
  buildInvocation(model: string, tier: ArgTier): AgentInvocation;
  /** Parses one line of `stream-json` stdout. Return undefined to ignore it. */
  parseEvent(line: string): AgentEvent | undefined;
}
