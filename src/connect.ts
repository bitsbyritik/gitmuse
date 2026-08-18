import { select, confirm } from '@inquirer/prompts';
import { spawnSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import type { AgentSettings, Config } from './types.js';
import type { AgentStatus, CliAgent } from './agents/types.js';
import {
  CLI_AGENTS,
  PLANNED_AGENTS,
  findAgent,
  handshakeAgent,
  probeAgent,
  resolveCommand,
} from './agents/index.js';
import { getConfig, saveConfig } from './config.js';
import { ConfigError } from './errors.js';
import { logger } from './logger.js';

const noColor = Boolean(process.env['NO_COLOR']);
const paint = (text: string, fn: (s: string) => string): string =>
  noColor ? text : fn(text);

export interface ConnectOptions {
  /** Model to use — skips the model prompt. */
  model?: string;
  /** Skip the live test request. */
  noTest?: boolean;
  /** Never prompt; fail instead of asking. For scripts and CI. */
  yes?: boolean;
}

/** ● connected · ○ signed out · ✗ missing */
function statusDot(status: AgentStatus, active: boolean): string {
  if (!status.installed) return paint('✗', chalk.red);
  if (!status.auth?.connected) return paint('○', chalk.yellow);
  return paint(active ? '◉' : '●', chalk.green);
}

function statusLine(status: AgentStatus): string {
  if (!status.installed) return paint('not installed', chalk.red);
  if (!status.auth?.connected) return paint('signed out', chalk.yellow);

  const who = [status.auth.account, status.auth.plan].filter(Boolean).join(' · ');
  return paint(who || 'signed in', chalk.green);
}

/** Prints every agent and whether it is ready to use. */
export function listAgents(config: Config = getConfig()): void {
  console.log(`\n  ${paint('Agents', chalk.bold)}\n`);

  for (const agent of CLI_AGENTS) {
    const status = probeAgent(agent, config.agents[agent.id] ?? {});
    const active = config.provider === agent.id;
    const version = status.version ? paint(` · v${status.version}`, chalk.dim) : '';

    console.log(
      `  ${statusDot(status, active)}  ${agent.name.padEnd(14)}${statusLine(status)}${version}` +
        (active ? paint('  ← in use', chalk.cyan) : ''),
    );
  }

  for (const planned of PLANNED_AGENTS) {
    console.log(
      `  ${paint('·', chalk.dim)}  ${paint(planned.name.padEnd(14) + planned.note, chalk.dim)}`,
    );
  }

  console.log(`\n  ${paint('Connect one with: gm connect', chalk.dim)}\n`);
}

/** Runs the agent's own login command, inheriting the terminal. */
function runLogin(agent: CliAgent, command: string): void {
  const [, ...loginArgs] = agent.loginCommand.split(' ');
  console.log('');
  const result = spawnSync(command, loginArgs, { stdio: 'inherit' });
  console.log('');
  if (result.error) {
    logger.warn(`Could not start the login flow: ${result.error.message}`);
  }
}

/**
 * Walks the user through connecting one agent: find it, sign in, pick a model,
 * prove it works, save it. Returns true when the agent is connected and saved.
 */
export async function connectAgent(
  agent: CliAgent,
  options: ConnectOptions = {},
): Promise<boolean> {
  const stored: AgentSettings = getConfig().agents[agent.id] ?? {};
  let status = probeAgent(agent, stored);

  console.log(
    `\n  ${paint(agent.name, chalk.bold)} ${paint(`— ${agent.tagline}`, chalk.dim)}\n`,
  );

  // 1. Is the binary there?
  if (!status.installed) {
    logger.error(`"${resolveCommand(agent, stored)}" was not found on your PATH.`);
    logger.dim(`\n    Install it:  ${agent.install}`);
    logger.dim(`    Docs:        ${agent.docsUrl}\n`);

    if (options.yes) return false;
    const recheck = await confirm({ message: 'Check again?', default: true });
    if (!recheck) return false;

    status = probeAgent(agent, stored);
    if (!status.installed) {
      logger.error(`Still not finding ${agent.name}. Run \`gm connect\` again once installed.`);
      return false;
    }
  }

  logger.success(
    `Found ${agent.name}${status.version ? ` v${status.version}` : ''} at "${status.command}"`,
  );

  // 2. Is it signed in? The agent's own CLI answers this — gitmuse never sees
  //    the credential.
  if (status.auth && !status.auth.connected) {
    logger.warn(`${agent.name} is installed but not signed in.`);

    if (!options.yes) {
      const signIn = await confirm({
        message: `Sign in to ${agent.name} now?`,
        default: true,
      });
      if (signIn) {
        runLogin(agent, status.command);
        status = probeAgent(agent, stored);
      }
    }

    if (!status.auth?.connected) {
      logger.dim(`\n    Sign in with:  ${agent.loginCommand}`);
      logger.dim(`    Then run:      gm connect ${agent.id}\n`);
      return false;
    }
  }

  if (status.auth?.connected) {
    const who = [status.auth.account, status.auth.plan && `${status.auth.plan} plan`]
      .filter(Boolean)
      .join(' · ');
    logger.success(`Signed in${who ? `: ${who}` : ''}`);
    if (status.auth.method && status.auth.method !== 'claude.ai') {
      logger.dim(`    Auth method: ${status.auth.method}`);
    }
  }

  // 3. Which model?
  const firstModel = agent.models[0] ?? '';
  let model = options.model?.trim() || stored.model || '';
  if (!model) {
    model =
      options.yes || agent.models.length <= 1
        ? firstModel
        : await select({
            message: 'Which model should gitmuse ask for?',
            choices: agent.models.map((m, i) => ({
              value: m,
              name: i === 0 ? `${m}  (recommended)` : m,
            })),
          });
  }

  const settings: AgentSettings = { ...stored, model };

  // 4. Prove the whole path works before saving it.
  if (!options.noTest) {
    const spinner = ora({ text: `Testing ${agent.name}…` }).start();
    const result = await handshakeAgent(agent, settings);
    spinner.stop();

    if (!result.ok) {
      logger.error(`Test request failed: ${result.error ?? 'unknown error'}`);
      logger.dim(`\n    Try:  ${agent.loginCommand}\n`);
      return false;
    }
    logger.success(`Test request succeeded (${model})`);
  }

  saveConfig({ provider: agent.id, agents: { ...getConfig().agents, [agent.id]: settings } });

  console.log('');
  logger.success(`Connected — gitmuse is now using ${agent.name} (${model})`);
  logger.dim(`    No API key stored. ${agent.name} handles the credential.`);
  logger.dim(`    Change model:  gm config set agents.${agent.id}.model <name>`);
  console.log(`\n  ${paint('Run `gm` in any git repo to generate a commit message.', chalk.dim)}\n`);

  return true;
}

/** Handler for `gm connect [agent]`. */
export async function connect(
  agentId?: string,
  options: ConnectOptions = {},
): Promise<void> {
  if (agentId) {
    const agent = findAgent(agentId);
    if (!agent) {
      throw new ConfigError(
        `Unknown agent: "${agentId}". Available: ${CLI_AGENTS.map((a) => a.id).join(', ')}`,
      );
    }
    await connectAgent(agent, options);
    return;
  }

  if (CLI_AGENTS.length === 1) {
    await connectAgent(CLI_AGENTS[0] as CliAgent, options);
    return;
  }

  const config = getConfig();
  console.log(`\n  ${paint('Connect an agent you are already signed in to', chalk.bold)}\n`);

  const choice = await select<string>({
    message: 'Which agent?',
    choices: [
      ...CLI_AGENTS.map((agent) => {
        const status = probeAgent(agent, config.agents[agent.id] ?? {});
        return {
          value: agent.id,
          name: `${statusDot(status, config.provider === agent.id)}  ${agent.name} — ${agent.vendor} · ${statusLine(status)}`,
          description: agent.tagline,
        };
      }),
      ...PLANNED_AGENTS.map((planned) => ({
        value: `planned:${planned.name}`,
        name: `·  ${planned.name} — ${planned.vendor} · ${planned.note}`,
        disabled: true,
      })),
    ],
  });

  const agent = findAgent(choice);
  if (agent) await connectAgent(agent, options);
}
