import ora from 'ora';
import type { Config, RunOptions } from './types.js';
import { getConfig, isFirstRun } from './config.js';
import { getStagedDiff, getStagedFiles, commitWithMessage } from './git.js';
import { buildPrompt, parseCommitMessage } from './prompt.js';
import { resolveAdapter } from './adapters/index.js';
import { streamToTerminal, showTui } from './tui.js';
import { handleFatalError } from './errors.js';
import { logger, setSilent } from './logger.js';

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
    const files = getStagedFiles();
    logger.dim(`  Staged: ${files.join(', ')}`);

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
    let currentMessage = parseCommitMessage(await streamToTerminal(firstStream)).raw;

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
    while (true) {
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
        currentMessage = parseCommitMessage(await streamToTerminal(retryStream)).raw;
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
