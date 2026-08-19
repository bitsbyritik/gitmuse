import type { AgentProviderName, AgentSettings } from '../types.js';
import type { AgentAuth, AgentModel, AgentStatus, CliAgent } from './types.js';
import { locateBinary, runCli, timeouts } from './detect.js';
import { claudeCode } from './claude-code.js';
import { codexCli } from './codex.js';
import { cursorCli } from './cursor.js';

/**
 * Every agent gitmuse can connect to.
 *
 * To add one: write `src/agents/<name>.ts` exporting a CliAgent, add its id to
 * `AgentProviderName` in `src/types.ts`, and push it here. The connect flow,
 * config, adapter and error handling all pick it up automatically.
 */
export const CLI_AGENTS: readonly CliAgent[] = [claudeCode, codexCli, cursorCli];

export const AGENT_IDS: readonly AgentProviderName[] = CLI_AGENTS.map((a) => a.id);

/** Returns the agent with this id, or undefined for HTTP providers. */
export function findAgent(id: string): CliAgent | undefined {
  return CLI_AGENTS.find((a) => a.id === id);
}

/** Narrows a provider name to an agent id. */
export function isAgentProvider(provider: string): provider is AgentProviderName {
  return AGENT_IDS.includes(provider as AgentProviderName);
}

/** The executable to run: the user's override, else the agent's default. */
export function resolveCommand(agent: CliAgent, settings: AgentSettings = {}): string {
  return settings.command?.trim() || agent.command;
}

/** The model to request: the user's choice, else the agent's first listed model. */
export function resolveModel(agent: CliAgent, settings: AgentSettings = {}): string {
  return settings.model?.trim() || agent.models[0] || '';
}

/** Asks the CLI who is signed in. Never throws — an unusable CLI is "not connected". */
async function readAuth(agent: CliAgent, command: string): Promise<AgentAuth | undefined> {
  if (!agent.authArgs || !agent.parseAuth) return undefined;

  const result = await runCli(command, agent.authArgs, timeouts.auth);

  // A non-zero exit is how most of these CLIs say "signed out".
  if (!result.ok) return { connected: false, detail: result.output.trim() || undefined };

  try {
    return agent.parseAuth(result.output);
  } catch {
    return { connected: false };
  }
}

/**
 * Looks for the agent's binary and asks it who is signed in.
 * Fast and free — no inference request is made.
 */
export async function probeAgent(
  agent: CliAgent,
  settings: AgentSettings = {},
): Promise<AgentStatus> {
  const configured = resolveCommand(agent, settings);
  const { path, offPath } = await locateBinary(configured);

  if (!path) return { agent, command: configured, installed: false };

  // Version and sign-in are independent questions. Some of these CLIs take
  // seconds just to boot — Cursor's is ~6s — and asking them one after the other
  // doubles that wait for nothing.
  const [probe, auth] = await Promise.all([
    runCli(path, agent.versionArgs, timeouts.version),
    readAuth(agent, path),
  ]);

  if (!probe.ok) return { agent, command: path, installed: false, offPath };

  const version = /\d+\.\d+\.\d+/.exec(probe.output)?.[0];

  return { agent, command: path, installed: true, version, offPath, auth };
}

/** Probes every registered agent at once — detection is I/O, not CPU. */
export async function probeAllAgents(
  settingsFor: (id: AgentProviderName) => AgentSettings = () => ({}),
): Promise<AgentStatus[]> {
  return Promise.all(CLI_AGENTS.map((agent) => probeAgent(agent, settingsFor(agent.id))));
}

/**
 * Asks the CLI which models the signed-in account may actually use.
 *
 * Falls back to the agent's static list whenever the CLI cannot answer — an
 * older build without the command, no network, a signed-out account — so the
 * connect flow always has something to offer.
 */
export async function listModels(
  agent: CliAgent,
  command: string,
): Promise<{ models: AgentModel[]; live: boolean }> {
  const fallback = { models: agent.models.map((id) => ({ id })), live: false };
  if (!agent.listModels) return fallback;

  const result = await runCli(command, agent.listModels.args, timeouts.models);
  if (!result.ok) return fallback;

  try {
    const models = agent.listModels.parse(result.stdout || result.stderr);
    return models.length > 0 ? { models, live: true } : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Sends one tiny real prompt through the agent to prove the whole path works.
 * Costs a single request against the user's plan.
 */
export async function handshakeAgent(
  agent: CliAgent,
  settings: AgentSettings = {},
): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const { CliAgentAdapter } = await import('../adapters/cli-agent.js');
  const adapter = new CliAgentAdapter(agent, settings);

  try {
    let reply = '';
    for await (const token of adapter.stream(
      'Reply with exactly: OK — nothing else.',
    )) {
      reply += token;
    }
    const trimmed = reply.trim();
    return trimmed
      ? { ok: true, reply: trimmed }
      : { ok: false, error: 'the agent returned an empty response' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type { AgentAuth, AgentModel, AgentStatus, CliAgent } from './types.js';
