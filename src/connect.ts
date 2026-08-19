import { select, search, confirm } from '@inquirer/prompts';
import { execa } from 'execa';
import chalk from 'chalk';
import ora from 'ora';
import type { AgentSettings, Config } from './types.js';
import type { AgentModel, AgentStatus, CliAgent } from './agents/types.js';
import {
  CLI_AGENTS,
  findAgent,
  handshakeAgent,
  listModels,
  probeAgent,
  probeAllAgents,
  resolveCommand,
} from './agents/index.js';
import { getConfig, saveConfig } from './config.js';
import { ConfigError } from './errors.js';
import { logger } from './logger.js';

/** Above this many models a plain list stops being browsable — offer search. */
const SEARCH_THRESHOLD = 12;

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
export async function listAgents(config: Config = getConfig()): Promise<void> {
  const spinner = ora({ text: 'Looking for installed agents…' }).start();
  const statuses = await probeAllAgents((id) => config.agents[id] ?? {});
  spinner.stop();

  console.log(`\n  ${paint('Agents', chalk.bold)}\n`);

  for (const status of statuses) {
    const active = config.provider === status.agent.id;
    const version = status.version ? paint(` · v${status.version}`, chalk.dim) : '';

    console.log(
      `  ${statusDot(status, active)}  ${status.agent.name.padEnd(14)}${statusLine(status)}${version}` +
        (active ? paint('  ← in use', chalk.cyan) : ''),
    );
    if (status.offPath) {
      console.log(paint(`       found off PATH at ${status.offPath}`, chalk.dim));
    }
  }

  console.log(`\n  ${paint('Connect one with: gm connect', chalk.dim)}\n`);
}

/** How one model reads in the picker. */
function modelChoice(model: AgentModel): { value: string; name: string } {
  const notes = [
    model.label,
    model.current && 'your current model',
    model.isDefault && !model.current && 'agent default',
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    value: model.id,
    name: notes ? `${model.id}  ${paint(`(${notes})`, chalk.dim)}` : model.id,
  };
}

/**
 * Asks the agent what the signed-in account may run, then lets the user pick.
 * Large catalogues (Cursor lists 200+) get a type-to-filter prompt instead of a
 * list nobody can scroll through.
 */
async function pickModel(
  agent: CliAgent,
  command: string,
  options: ConnectOptions,
): Promise<string> {
  const spinner = ora({ text: `Asking ${agent.name} which models you can use…` }).start();
  const { models, live } = await listModels(agent, command);
  spinner.stop();

  if (models.length === 0) return '';

  // What the account is actually set to beats the CLI's fallback, which beats
  // whatever happens to be listed first.
  const preferred =
    models.find((m) => m.current) ?? models.find((m) => m.isDefault) ?? models[0];
  const preferredId = preferred?.id ?? '';

  if (options.yes || models.length === 1) return preferredId;

  logger.dim(
    live
      ? `    ${String(models.length)} models available on your account`
      : `    ${agent.name} has no model list command — showing gitmuse's defaults`,
  );

  // Preferred first: `search` has no notion of a default, and in a list this
  // long the top entry is the only one the user is guaranteed to see.
  const ordered = preferred ? [preferred, ...models.filter((m) => m !== preferred)] : models;
  const choices = ordered.map(modelChoice);
  const message = 'Which model should gitmuse ask for?';

  if (models.length <= SEARCH_THRESHOLD) {
    return select({ message, choices, default: preferredId });
  }

  return search<string>({
    message: `${message} (type to filter)`,
    source: (term) => {
      const needle = (term ?? '').trim().toLowerCase();
      if (!needle) return choices;
      return choices.filter((c) => c.value.toLowerCase().includes(needle));
    },
    pageSize: 12,
  });
}

/** Runs the agent's own login command, inheriting the terminal. */
async function runLogin(agent: CliAgent, command: string): Promise<void> {
  const [, ...loginArgs] = agent.loginCommand.split(' ');
  console.log('');
  const result = await execa(command, loginArgs, { stdio: 'inherit', reject: false });
  console.log('');
  if (result.failed && result.code === 'ENOENT') {
    logger.warn(`Could not start the login flow: ${command} is not runnable.`);
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

  console.log(
    `\n  ${paint(agent.name, chalk.bold)} ${paint(`— ${agent.tagline}`, chalk.dim)}\n`,
  );

  const spinner = ora({ text: `Looking for ${agent.name}…` }).start();
  let status = await probeAgent(agent, stored);
  spinner.stop();

  // 1. Is the binary there?
  if (!status.installed) {
    logger.error(`"${resolveCommand(agent, stored)}" was not found on your PATH.`);
    logger.dim(`\n    Install it:  ${agent.install}`);
    logger.dim(`    Docs:        ${agent.docsUrl}\n`);

    if (options.yes) return false;
    const recheck = await confirm({ message: 'Check again?', default: true });
    if (!recheck) return false;

    status = await probeAgent(agent, stored);
    if (!status.installed) {
      logger.error(`Still not finding ${agent.name}. Run \`gm connect\` again once installed.`);
      return false;
    }
  }

  logger.success(
    `Found ${agent.name}${status.version ? ` v${status.version}` : ''} at "${status.command}"`,
  );

  // Detection reaches past PATH; remember the absolute path so every later run
  // finds it too, including git hooks with a thinner environment.
  const settings: AgentSettings = { ...stored };
  if (status.offPath) {
    logger.dim(`    Not on your PATH — pinning this path in gitmuse's config.`);
    settings.command = status.offPath;
  }

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
        await runLogin(agent, status.command);
        status = await probeAgent(agent, settings);
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

  // 3. Which model? Asked of the CLI, so the list matches the account.
  const model =
    options.model?.trim() || (await pickModel(agent, status.command, options));
  settings.model = model;

  // 4. Prove the whole path works before saving it.
  if (!options.noTest) {
    const testing = ora({ text: `Testing ${agent.name}…` }).start();
    const result = await handshakeAgent(agent, settings);
    testing.stop();

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

  const config = getConfig();
  console.log(`\n  ${paint('Connect an agent you are already signed in to', chalk.bold)}\n`);

  const spinner = ora({ text: 'Looking for installed agents…' }).start();
  const statuses = await probeAllAgents((id) => config.agents[id] ?? {});
  spinner.stop();

  const choice = await select<string>({
    message: 'Which agent?',
    choices: statuses.map((status) => ({
      value: status.agent.id,
      name: `${statusDot(status, config.provider === status.agent.id)}  ${status.agent.name} — ${status.agent.vendor} · ${statusLine(status)}`,
      description: status.agent.tagline,
    })),
  });

  const agent = findAgent(choice);
  if (agent) await connectAgent(agent, options);
}
