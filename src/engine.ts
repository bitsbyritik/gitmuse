import ora from 'ora';
import type { Config, RunOptions } from './types.js';
import { getConfig, isFirstRun } from './config.js';
import { getStagedDiff, commitWithMessage } from './git.js';
import { buildPrompt, parseCommitMessage, normalizeCommitMessage } from './prompt.js';
import { resolveAdapter } from './adapters/index.js';
import { streamToTerminal, showTui } from './tui.js';
import { writeMessageFile } from './hooks.js';
import { handleFatalError } from './errors.js';
import { logger, setSilent } from './logger.js';
import { reportUsage } from './usage.js';
import type { UsageContext } from './usage.js';
import { findAgent, isAgentProvider, resolveModel } from './agents/index.js';

/** The model actually asked for, however this provider stores that. */
function modelInUse(config: Config): string {
  if (isAgentProvider(config.provider)) {
    const agent = findAgent(config.provider);
    return agent ? resolveModel(agent, config.agents[config.provider] ?? {}) : '';
  }

  // Deliberately not `config.model`: no HTTP adapter reads the top-level model
  // setting, so reporting it would price the request against a model that was
  // never asked for.
  const providerConfig: { model?: string } = config[config.provider];
  return providerConfig.model ?? '';
}

function usageContext(config: Config): UsageContext {
  return {
    provider: config.provider,
    model: modelInUse(config),
    isAgent: isAgentProvider(config.provider),
  };
}

/** Wraps a token stream so the spinner stops on the first token. */
async function* withSpinnerStop(
  source: AsyncIterable<string>,
  spinner: ReturnType<typeof ora>,
): AsyncIterable<string> {
  let first = true;
  for await (const token of source) {
    if (first) {
      spinner.stop();
      first = false;
    }
    yield token;
  }
  if (first) spinner.stop(); // provider returned no tokens
}

/** Main orchestrator: git → prompt → provider → TUI → commit. */
export async function run(options: RunOptions): Promise<void> {
  try {
    setSilent(options.silent ?? false);

    // The git hook runs unattended — an interactive wizard there would hang the
    // commit, so say what is missing and let git carry on with its own editor.
    if (options.write && isFirstRun()) {
      logger.warn('gitmuse is not configured yet — run `gm setup` or `gm connect`.');
      return;
    }

    // Trigger setup wizard automatically on first run
    if (isFirstRun()) {
      logger.info("Welcome to gitmuse! Let's configure your AI provider first.\n");
      const { setup } = await import('./setup.js');
      await setup();
    }

    // Resolve config with any CLI overrides
    const overrides: Partial<Config> = {};
    if (options.provider) overrides.provider = options.provider as Config['provider'];
    if (options.yes) overrides.autoConfirm = true;
    const config = getConfig(overrides);

    // Read staged diff
    const diff = getStagedDiff(config.maxDiffLines);
    logger.dim(
      `  Staged: ${diff.files
        .map((f) => `${f.status === 'modified' ? '' : `${f.status} `}${f.path}`)
        .join(', ')}`,
    );
    if (diff.trimmed) logger.dim('  (large diff — noisy files trimmed for the model)');

    // Build prompt once — reused on retry
    const prompt = buildPrompt(diff, config);

    // Resolve adapter once — reused on retry
    const adapter = await resolveAdapter(config);

    // First generation
    const spinner = ora({
      text: `Asking ${config.provider}…`,
      isSilent: options.silent,
    }).start();

    const firstStream = withSpinnerStop(adapter.stream(prompt), spinner);
    let currentMessage = normalizeCommitMessage(
      await streamToTerminal(firstStream),
      config.emoji,
    ).raw;

    if (config.showUsage && !options.silent) {
      reportUsage(adapter.usage, usageContext(config));
    }

    // Hook mode: hand the message to git and let git do the committing.
    if (options.write) {
      writeMessageFile(options.write, currentMessage);
      return;
    }

    // --yes / autoConfirm: skip TUI
    if (config.autoConfirm) {
      if (options.dryRun) {
        logger.info(`[dry-run] Would commit:\n\n${currentMessage}\n`);
      } else {
        commitWithMessage(currentMessage);
        logger.success(`Committed: ${parseCommitMessage(currentMessage).subject}`);
      }
      return;
    }

    // Interactive TUI loop
    for (;;) {
      const result = await showTui(currentMessage);

      if (result.action === 'abort') {
        logger.warn('Aborted.');
        process.exit(0);
      }

      if (result.action === 'retry') {
        const retrySpinner = ora({
          text: `Regenerating…`,
          isSilent: options.silent,
        }).start();
        const retryStream = withSpinnerStop(adapter.stream(prompt), retrySpinner);
        currentMessage = normalizeCommitMessage(
          await streamToTerminal(retryStream),
          config.emoji,
        ).raw;
        if (config.showUsage && !options.silent) {
          reportUsage(adapter.usage, usageContext(config));
        }
        continue;
      }

      // 'commit' (including post-edit)
      const finalMessage = result.message.trim() || currentMessage;
      if (options.dryRun) {
        logger.info(`[dry-run] Would commit:\n\n${finalMessage}\n`);
      } else {
        commitWithMessage(finalMessage);
        logger.success(`Committed: ${parseCommitMessage(finalMessage).subject}`);
      }
      break;
    }
  } catch (err) {
    handleFatalError(err);
  }
}
