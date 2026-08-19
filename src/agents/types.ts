import type { AgentProviderName } from '../types.js';
import type { TokenUsage } from '../usage.js';

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

/**
 * A meaningful event parsed out of one line of an agent's stdout.
 *
 * The line that ends a run yields `usage` when the CLI reported token counts
 * and `end` when it did not — both mean "the run finished cleanly".
 */
export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'error'; message: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'end' };

/**
 * Scratch space `parseEvent` may write to, created fresh by the adapter for
 * each run and never shared between runs. Agents whose stream repeats itself —
 * Cursor emits every delta and then the assembled message again — need to
 * remember what they have already yielded, and a module-level variable would
 * leak that memory across runs.
 */
export type AgentParseState = Record<string, unknown>;

/** One model the signed-in account may ask an agent for. */
export interface AgentModel {
  /** Value passed to the agent's `--model` flag. */
  id: string;
  /** Human name the CLI printed, when it printed one. */
  label?: string;
  /** The account's currently selected model, when the CLI says which. */
  current?: boolean;
  /** The CLI's own fallback when nothing is chosen. */
  isDefault?: boolean;
}

/**
 * How to ask a CLI which models the signed-in account may actually use.
 * Declarative on purpose — the agent file says what to run and how to read it,
 * and `src/agents/detect.ts` owns every subprocess.
 */
export interface ModelQuery {
  args: readonly string[];
  parse(stdout: string): AgentModel[];
}

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
  /** Resolved executable actually probed — a config override, a name on PATH,
   *  or an absolute path found in a well-known install directory. */
  command: string;
  installed: boolean;
  version?: string;
  auth?: AgentAuth;
  /** Set when the binary only turned up outside PATH, at this absolute path. */
  offPath?: string;
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
  /**
   * Models offered when the CLI cannot be asked for a live list — also the
   * fallback when `listModels` fails. First entry is the default.
   */
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

  /**
   * How to ask this CLI what the signed-in account may run. Omit it when the
   * CLI has no such command, and `models` is used instead.
   */
  listModels?: ModelQuery;

  /** Builds one non-interactive invocation for the given model. */
  buildInvocation(model: string, tier: ArgTier): AgentInvocation;
  /**
   * Parses one line of `stream-json` stdout. Return undefined to ignore it.
   * `state` persists across the lines of a single run only.
   */
  parseEvent(line: string, state: AgentParseState): AgentEvent | undefined;
}
