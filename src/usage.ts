import chalk from 'chalk';

import { costOf, priceFor } from './pricing.js';
import type { ProviderName } from './types.js';

/**
 * What one generation actually consumed.
 *
 * Providers disagree about whether cached input is counted inside their input
 * figure, so adapters normalise before constructing this: `inputTokens` is
 * always the full billable input, and `cachedInputTokens` is the part of it
 * that was served from cache.
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Portion of `inputTokens` served from cache, when the provider says. */
  cachedInputTokens?: number;
  /** Reasoning tokens, already counted inside `outputTokens`. */
  reasoningTokens?: number;
}

/**
 * Drops an all-zero report. Some CLIs emit the usage field on every run,
 * populated or not, and "0 in · 0 out" is worse than saying nothing.
 */
export function nonEmptyUsage(usage: TokenUsage): TokenUsage | undefined {
  return usage.inputTokens || usage.outputTokens ? usage : undefined;
}

/** 938 · 1.2k · 17.2k — a commit message never needs more precision. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  const thousands = count / 1000;
  return `${thousands < 10 ? thousands.toFixed(1) : Math.round(thousands).toString()}k`;
}

/**
 * Dollars, at the precision the number deserves: a commit message usually costs
 * a fraction of a cent, and "$0.00" tells the reader nothing.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Adds two usage reports — used when a run is retried mid-stream. */
export function addUsage(a: TokenUsage | undefined, b: TokenUsage): TokenUsage {
  if (!a) return b;
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0) || undefined,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0) || undefined,
  };
}

/** Everything the badge needs to know about where the message came from. */
export interface UsageContext {
  provider: ProviderName;
  model: string;
  /**
   * Connected agents bill a subscription, not this request. Passed in rather
   * than derived here so this module stays free of imports from the agent
   * registry — which imports this one.
   */
  isAgent: boolean;
}

/**
 * The one-line badge printed after a message is generated.
 *
 * Connected agents get token counts only. They run on a subscription you have
 * already paid for, so a per-request dollar figure would be fiction — the same
 * reason Claude Code and Codex report tokens rather than money.
 *
 * API providers get a cost too, but only when gitmuse actually knows the
 * model's price. An unknown model shows tokens alone rather than a made-up
 * number.
 */
export function formatUsage(usage: TokenUsage, ctx: UsageContext): string {
  const parts = [
    `↑ ${formatTokens(usage.inputTokens)} in`,
    `↓ ${formatTokens(usage.outputTokens)} out`,
  ];

  if (usage.cachedInputTokens) {
    parts.push(`${formatTokens(usage.cachedInputTokens)} cached`);
  }

  if (!ctx.isAgent) {
    if (ctx.provider === 'ollama') {
      parts.push('local · free');
    } else {
      const price = priceFor(ctx.provider, ctx.model);
      if (price) parts.push(`Cost: ${formatCost(costOf(usage, price))}`);
    }
  }

  return parts.join(' · ');
}

const noColor = Boolean(process.env['NO_COLOR']);

/** Prints the badge. A provider that reported nothing prints nothing. */
export function reportUsage(usage: TokenUsage | undefined, ctx: UsageContext): void {
  if (!usage) return;
  const line = `  ${formatUsage(usage, ctx)}`;
  console.log(noColor ? line : chalk.dim(line));
}
