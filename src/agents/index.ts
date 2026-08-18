import { spawnSync } from 'child_process';
import type { AgentProviderName, AgentSettings } from '../types.js';
import type { AgentAuth, AgentStatus, CliAgent } from './types.js';
import { claudeCode } from './claude-code.js';

/**
 * Every agent gitmuse can connect to.
 *
 * To add one: write `src/agents/<name>.ts` exporting a CliAgent, add its id to
 * `AgentProviderName` in `src/types.ts`, and push it here. The connect flow,
 * config, adapter and error handling all pick it up automatically.
 */
export const CLI_AGENTS: readonly CliAgent[] = [claudeCode];

/** Agents we intend to support — shown as "coming soon" in `gm connect`. */
export const PLANNED_AGENTS: readonly { name: string; vendor: string; note: string }[] = [
  { name: 'Codex CLI', vendor: 'OpenAI', note: 'coming soon — contributions welcome' },
];

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

/** Runs the agent's auth command. Never throws — an unusable CLI is "not connected". */
function readAuth(agent: CliAgent, command: string): AgentAuth | undefined {
  if (!agent.authArgs || !agent.parseAuth) return undefined;

  const result = spawnSync(command, [...agent.authArgs], {
    encoding: 'utf8',
    timeout: 15_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error || result.status !== 0) {
    return {
      connected: false,
      detail: (result.stderr || '').trim() || undefined,
    };
  }

  try {
    return agent.parseAuth(result.stdout);
  } catch {
    return { connected: false };
  }
}

/**
 * Looks for the agent's binary and asks it who is signed in.
 * Fast and free — no inference request is made.
 */
export function probeAgent(agent: CliAgent, settings: AgentSettings = {}): AgentStatus {
  const command = resolveCommand(agent, settings);

  const probe = spawnSync(command, [...agent.versionArgs], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (probe.error || probe.status !== 0) {
    return { agent, command, installed: false };
  }

  const version = /\d+\.\d+\.\d+/.exec(probe.stdout)?.[0];

  return { agent, command, installed: true, version, auth: readAuth(agent, command) };
}

/** Probes every registered agent. */
export function probeAllAgents(
  settingsFor: (id: AgentProviderName) => AgentSettings = () => ({}),
): AgentStatus[] {
  return CLI_AGENTS.map((agent) => probeAgent(agent, settingsFor(agent.id)));
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

export type { AgentAuth, AgentStatus, CliAgent } from './types.js';
