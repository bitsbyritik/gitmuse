import ora from 'ora';
import type { Config, DiffResult, RunOptions } from './types.js';
import { getConfig, isFirstRun } from './config.js';
import { getStagedDiff, getWorktreeState, stageAll, commitWithMessage } from './git.js';
import { buildPrompt, parseCommitMessage, normalizeCommitMessage } from './prompt.js';
import { resolveAdapter } from './adapters/index.js';
import { streamToTerminal, showTui, showMessage, eraseStreamed } from './tui.js';
import { askConfirm } from './ui.js';
import { writeMessageFile } from './hooks.js';
import { handleFatalError, NoStagedChangesError } from './errors.js';
import { logger, setSilent } from './logger.js';
import { canAnimate, isInteractive } from './tty.js';
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

/**
 * True when there is a real user on the other end.
 *
 * The git hook and CI both run gitmuse with no one watching, and a prompt there
 * hangs the commit instead of helping anyone.
 */
function canPrompt(options: RunOptions): boolean {
  return !options.write && !options.silent && isInteractive();
}

function fileList(paths: string[], limit = 5): string {
  const shown = paths.slice(0, limit).join(', ');
  return paths.length > limit ? `${shown}, +${String(paths.length - limit)} more` : shown;
}

/**
 * Reads the staged diff, offering to stage everything when nothing is staged
 * but the tree is dirty — the common "forgot to `git add`" case, which used to
 * be a dead end.
 */
async function readDiff(config: Config, options: RunOptions): Promise<DiffResult> {
  try {
    return getStagedDiff(config.maxDiffLines);
  } catch (err) {
    if (!(err instanceof NoStagedChangesError) || !canPrompt(options)) throw err;

    const { unstaged, untracked } = getWorktreeState();
    const dirty = [...unstaged, ...untracked];
    if (dirty.length === 0) throw err;

    logger.warn(`Nothing is staged, but ${String(dirty.length)} file(s) have changes.`);
    logger.dim(`    ${fileList(dirty)}`);

    const stage = await askConfirm({
      message: `Stage all ${String(dirty.length)} and continue?`,
      initialValue: true,
    });
    if (!stage) throw err;

    stageAll();
    return getStagedDiff(config.maxDiffLines);
  }
}

/** Says what this commit will leave behind, so a half-staged commit is deliberate. */
function warnUnstaged(options: RunOptions): void {
  if (options.write || options.silent) return;

  const { unstaged, untracked } = getWorktreeState();
  const left = [...unstaged, ...untracked];
  if (left.length === 0) return;

  logger.warn(`${String(left.length)} file(s) not staged — this commit won't include them.`);
  logger.dim(`    ${fileList(left)}`);
}

/** Main orchestrator: git → prompt → provider → TUI → commit. */
export async function run(options: RunOptions): Promise<void> {
  try {
    setSilent(options.silent ?? false);

    // The git hook runs unattended — an interactive wizard there would hang the
    // commit, so say what is missing and let git carry on with its own editor.
    if (options.write && isFirstRun()) {
      logger.warn('gitmuse is not configured yet — run `gitmuse setup` or `gitmuse connect`.');
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
    const diff = await readDiff(config, options);
    logger.dim(
      `  Staged: ${diff.files
        .map((f) => `${f.status === 'modified' ? '' : `${f.status} `}${f.path}`)
        .join(', ')}`,
    );
    if (diff.trimmed) logger.dim('  (large diff — noisy files trimmed for the model)');
    warnUnstaged(options);

    // Resolve adapter once — reused on retry
    const adapter = await resolveAdapter(config);

    /** One generation: spinner → live stream → framed final message → usage badge. */
    const generate = async (label: string, hint?: string): Promise<string> => {
      // `!canAnimate()` must be ORed in, not defaulted: --silent=false is a real
      // value and would otherwise swallow the guard.
      const spinner = ora({
        text: label,
        isSilent: options.silent === true || !canAnimate(),
      }).start();
      const stream = withSpinnerStop(adapter.stream(buildPrompt(diff, config, hint)), spinner);
      const raw = await streamToTerminal(stream);
      const message = normalizeCommitMessage(raw, config.emoji).raw;

      // --silent promises the commit message and nothing else, so the streamed
      // text is left exactly as it landed.
      //
      // Reframing is only safe once the draft has actually been cleared: when
      // stdout is a pipe there is nothing to erase, and printing the message
      // again would simply emit it twice.
      if (!options.silent) {
        if (eraseStreamed(raw)) showMessage(message);
        if (config.showUsage) reportUsage(adapter.usage, usageContext(config));
      }

      return message;
    };

    let currentMessage = await generate(`Asking ${config.provider}…`);

    // Hook mode: hand the message to git and let git do the committing.
    if (options.write) {
      writeMessageFile(options.write, currentMessage);
      return;
    }

    const finish = (message: string): void => {
      // The message is already on screen — streamed, framed, or both — so this
      // only has to say what did not happen.
      if (options.dryRun) {
        logger.info('[dry-run] nothing was committed.');
        return;
      }
      commitWithMessage(message);
      logger.success(`Committed: ${parseCommitMessage(message).subject}`);
    };

    // --yes / autoConfirm: skip TUI
    if (config.autoConfirm) {
      finish(currentMessage);
      return;
    }

    // Interactive TUI loop
    for (;;) {
      const result = await showTui(currentMessage, diff, true);

      if (result.action === 'abort') {
        logger.warn('Aborted.');
        process.exit(0);
      }

      if (result.action === 'retry') {
        currentMessage = await generate(
          result.hint ? 'Regenerating with your hint…' : 'Regenerating…',
          result.hint,
        );
        continue;
      }

      finish(result.message.trim() || currentMessage);
      break;
    }
  } catch (err) {
    handleFatalError(err);
  }
}
