import { execa } from 'execa';
import ora from 'ora';
import chalk from 'chalk';
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
import {
  askConfirm,
  askSearch,
  askSelect,
  intro,
  log,
  outro,
  spinner,
  wordmark,
} from './ui.js';
import { canAnimate } from './tty.js';

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
  /** Called from another flow that already opened the branded header. */
  nested?: boolean;
}

/**
 * Readiness glyph for the agent picker.
 *
 * Deliberately not a dot: clack draws its own ●/○ radio in the column to the
 * left, and a second dot beside it reads as one control, not two facts.
 */
function readyGlyph(status: AgentStatus): string {
  if (!status.installed) return paint('✗', chalk.red);
  if (!status.auth?.connected) return paint('⚠', chalk.yellow);
  return paint('✓', chalk.green);
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

/**
 * Prints every agent and whether it is ready to use.
 *
 * A report, not a flow: ora rather than clack's spinner, because clack's would
 * open a `│` rail that nothing here ever closes.
 */
export async function listAgents(config: Config = getConfig()): Promise<void> {
  const finding = ora({ text: 'Looking for installed agents…', isSilent: !canAnimate() }).start();
  const statuses = await probeAllAgents((id) => config.agents[id] ?? {});
  finding.stop();

  console.log(`\n  ${wordmark('gitmuse')} ${paint('agents', chalk.bold)}\n`);

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

  console.log(`\n  ${paint('Connect one with: gitmuse connect', chalk.dim)}\n`);
}

/** How one model reads in the picker. */
function modelChoice(model: AgentModel): { value: string; label: string; hint?: string } {
  const notes = [
    model.label,
    model.current && 'your current model',
    model.isDefault && !model.current && 'agent default',
  ]
    .filter(Boolean)
    .join(' · ');

  return { value: model.id, label: model.id, hint: notes || undefined };
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
  const asking = spinner();
  asking.start(`Asking ${agent.name} which models you can use`);
  const { models, live } = await listModels(agent, command);

  if (models.length === 0) {
    asking.stop(`${agent.name} did not report a model list`);
    return '';
  }

  asking.stop(
    live
      ? `${String(models.length)} models available on your account`
      : `${agent.name} has no model list command — showing gitmuse's defaults`,
  );

  // What the account is actually set to beats the CLI's fallback, which beats
  // whatever happens to be listed first.
  const preferred =
    models.find((m) => m.current) ?? models.find((m) => m.isDefault) ?? models[0];
  const preferredId = preferred?.id ?? '';

  if (options.yes || models.length === 1) return preferredId;

  // Preferred first: in a list this long the top entry is the only one the user
  // is guaranteed to see.
  const ordered = preferred ? [preferred, ...models.filter((m) => m !== preferred)] : models;
  const choices = ordered.map(modelChoice);
  const message = 'Which model should gitmuse ask for?';

  if (models.length <= SEARCH_THRESHOLD) {
    return askSelect({ message, options: choices, initialValue: preferredId });
  }

  return askSearch({
    message,
    options: choices,
    placeholder: 'type to filter',
    maxItems: 12,
  });
}

/** Runs the agent's own login command, inheriting the terminal. */
async function runLogin(agent: CliAgent, command: string): Promise<void> {
  const [, ...loginArgs] = agent.loginCommand.split(' ');
  console.log('');
  const result = await execa(command, loginArgs, { stdio: 'inherit', reject: false });
  console.log('');
  if (result.failed && result.code === 'ENOENT') {
    log.warn(`Could not start the login flow: ${command} is not runnable.`);
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

  if (!options.nested) intro(`connect ${agent.name}`);
  log.message(paint(agent.tagline, chalk.dim));

  const finding = spinner();
  finding.start(`Looking for ${agent.name}`);
  let status = await probeAgent(agent, stored);
  finding.stop(status.installed ? `Found ${agent.name}` : `${agent.name} not found`);

  // 1. Is the binary there?
  if (!status.installed) {
    log.error(`"${resolveCommand(agent, stored)}" was not found on your PATH.`);
    log.message(
      `${paint('Install it:', chalk.dim)}  ${agent.install}\n${paint('Docs:', chalk.dim)}        ${agent.docsUrl}`,
    );

    if (options.yes) return false;
    const recheck = await askConfirm({ message: 'Check again?', initialValue: true });
    if (!recheck) return false;

    status = await probeAgent(agent, stored);
    if (!status.installed) {
      log.error(
        `Still not finding ${agent.name}. Run \`gitmuse connect\` again once installed.`,
      );
      return false;
    }
  }

  log.success(
    `${agent.name}${status.version ? ` v${status.version}` : ''} at "${status.command}"`,
  );

  // Detection reaches past PATH; remember the absolute path so every later run
  // finds it too, including git hooks with a thinner environment.
  const settings: AgentSettings = { ...stored };
  if (status.offPath) {
    log.info('Not on your PATH — pinning this path in gitmuse\'s config.');
    settings.command = status.offPath;
  }

  // 2. Is it signed in? The agent's own CLI answers this — gitmuse never sees
  //    the credential.
  if (status.auth && !status.auth.connected) {
    log.warn(`${agent.name} is installed but not signed in.`);

    if (!options.yes) {
      const signIn = await askConfirm({
        message: `Sign in to ${agent.name} now?`,
        initialValue: true,
      });
      if (signIn) {
        await runLogin(agent, status.command);
        status = await probeAgent(agent, settings);
      }
    }

    if (!status.auth?.connected) {
      log.message(
        `${paint('Sign in with:', chalk.dim)}  ${agent.loginCommand}\n${paint('Then run:', chalk.dim)}      gitmuse connect ${agent.id}`,
      );
      return false;
    }
  }

  if (status.auth?.connected) {
    const who = [status.auth.account, status.auth.plan && `${status.auth.plan} plan`]
      .filter(Boolean)
      .join(' · ');
    log.success(`Signed in${who ? `: ${who}` : ''}`);
    if (status.auth.method && status.auth.method !== 'claude.ai') {
      log.info(`Auth method: ${status.auth.method}`);
    }
  }

  // 3. Which model? Asked of the CLI, so the list matches the account.
  const model = options.model?.trim() || (await pickModel(agent, status.command, options));
  settings.model = model;

  // 4. Prove the whole path works before saving it.
  if (!options.noTest) {
    const testing = spinner();
    testing.start(`Testing ${agent.name}`);
    const result = await handshakeAgent(agent, settings);

    if (!result.ok) {
      testing.error('Test request failed');
      log.error(result.error ?? 'unknown error');
      log.message(`${paint('Try:', chalk.dim)}  ${agent.loginCommand}`);
      return false;
    }
    testing.stop(`Test request succeeded (${model})`);
  }

  saveConfig({ provider: agent.id, agents: { ...getConfig().agents, [agent.id]: settings } });

  log.success(`gitmuse is now using ${agent.name} (${model})`);
  log.info(
    `No API key stored — ${agent.name} handles the credential.\nChange model:  gitmuse config set agents.${agent.id}.model <name>`,
  );

  if (!options.nested) outro('Run `gitmuse` in any git repo to generate a commit message.');

  return true;
}

/** Handler for `gitmuse connect [agent]`. */
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
  intro('connect an agent you are already signed in to');

  const finding = spinner();
  finding.start('Looking for installed agents');
  const statuses = await probeAllAgents((id) => config.agents[id] ?? {});
  finding.stop(`Checked ${String(statuses.length)} agents`);

  const choice = await askSelect<string>({
    message: 'Which agent?',
    options: statuses.map((status) => ({
      value: status.agent.id,
      label:
        `${readyGlyph(status)}  ${status.agent.name}` +
        (config.provider === status.agent.id ? paint(' · in use', chalk.cyan) : ''),
      hint: `${status.agent.vendor} · ${statusLine(status)}`,
    })),
  });

  const agent = findAgent(choice);
  if (agent) await connectAgent(agent, { ...options, nested: true });

  outro('Done.');
}
