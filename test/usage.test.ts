import { describe, it, expect } from 'vitest';
import { addUsage, formatCost, formatTokens, formatUsage, nonEmptyUsage } from '../src/usage.js';
import { costOf, priceFor } from '../src/pricing.js';
import { DEFAULTS } from '../src/config.js';

const agent = (model: string): Parameters<typeof formatUsage>[1] => ({
  provider: 'claude-code',
  model,
  isAgent: true,
});
const api = (
  provider: Parameters<typeof formatUsage>[1]['provider'],
  model: string,
): Parameters<typeof formatUsage>[1] => ({ provider, model, isAgent: false });

describe('formatTokens', () => {
  it('stays exact below a thousand and abbreviates above it', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(938)).toBe('938');
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(1000)).toBe('1.0k');
    expect(formatTokens(1240)).toBe('1.2k');
    expect(formatTokens(17244)).toBe('17k');
  });
});

describe('formatCost', () => {
  it('keeps enough precision for a fraction of a cent', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.00042)).toBe('$0.0004');
    expect(formatCost(0.0123)).toBe('$0.012');
    expect(formatCost(2.5)).toBe('$2.50');
  });
});

describe('priceFor', () => {
  it('prices every provider default gitmuse ships', () => {
    // A default nobody can price would make the badge useless out of the box.
    expect(priceFor('openai', DEFAULTS.openai.model)).toBeDefined();
    expect(priceFor('groq', DEFAULTS.groq.model)).toBeDefined();
    expect(priceFor('anthropic', DEFAULTS.anthropic.model)).toBeDefined();
    expect(priceFor('gemini', DEFAULTS.gemini.model)).toBeDefined();
  });

  it('treats Ollama as free wherever it runs', () => {
    expect(priceFor('ollama', 'llama3')).toEqual({ input: 0, output: 0 });
    expect(priceFor('ollama', 'anything-at-all')).toEqual({ input: 0, output: 0 });
  });

  it('matches dated snapshots and -latest aliases', () => {
    expect(priceFor('anthropic', 'claude-haiku-4-5-20251001')).toEqual({ input: 1, output: 5 });
    expect(priceFor('anthropic', 'CLAUDE-HAIKU-4-5')).toEqual({ input: 1, output: 5 });
    expect(priceFor('gemini', 'gemini-2.5-flash-latest')).toEqual({ input: 0.3, output: 2.5 });
  });

  it('knows nothing about agents or unlisted models', () => {
    expect(priceFor('claude-code', 'sonnet')).toBeUndefined();
    expect(priceFor('cursor', 'composer-2.5')).toBeUndefined();
    expect(priceFor('custom', 'whatever')).toBeUndefined();
    expect(priceFor('openai', 'gpt-9-imaginary')).toBeUndefined();
  });
});

describe('costOf', () => {
  it('bills input and output at their own rates', () => {
    const cost = costOf(
      { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      { input: 0.15, output: 0.6 },
    );
    expect(cost).toBeCloseTo(0.75, 10);
  });

  it('scales down to a realistic commit message', () => {
    // gpt-4o-mini, ~1200 in / 40 out
    const cost = costOf({ inputTokens: 1200, outputTokens: 40 }, { input: 0.15, output: 0.6 });
    expect(formatCost(cost)).toBe('$0.0002');
  });
});

describe('formatUsage', () => {
  it('shows tokens only for a connected agent, never a price', () => {
    const line = formatUsage({ inputTokens: 10420, outputTokens: 38 }, agent('sonnet'));
    expect(line).toBe('↑ 10k in · ↓ 38 out');
    expect(line).not.toContain('$');
    expect(line).not.toContain('Cost');
  });

  it('adds the cached share when the agent reports one', () => {
    const line = formatUsage(
      { inputTokens: 17244, outputTokens: 33, cachedInputTokens: 10227 },
      agent('composer-2.5'),
    );
    expect(line).toBe('↑ 17k in · ↓ 33 out · 10k cached');
  });

  it('prices an API provider it knows', () => {
    const line = formatUsage({ inputTokens: 1200, outputTokens: 40 }, api('openai', 'gpt-4o-mini'));
    expect(line).toBe('↑ 1.2k in · ↓ 40 out · Cost: $0.0002');
  });

  it('says nothing about money for a model it cannot price', () => {
    const line = formatUsage(
      { inputTokens: 1200, outputTokens: 40 },
      api('custom', 'my-local-model'),
    );
    expect(line).toBe('↑ 1.2k in · ↓ 40 out');
  });

  it('calls Ollama free rather than $0', () => {
    const line = formatUsage({ inputTokens: 1200, outputTokens: 40 }, api('ollama', 'llama3'));
    expect(line).toBe('↑ 1.2k in · ↓ 40 out · local · free');
  });
});

describe('nonEmptyUsage', () => {
  it('rejects an all-zero report', () => {
    expect(nonEmptyUsage({ inputTokens: 0, outputTokens: 0 })).toBeUndefined();
    expect(nonEmptyUsage({ inputTokens: 0, outputTokens: 5 })).toBeDefined();
    expect(nonEmptyUsage({ inputTokens: 9, outputTokens: 0 })).toBeDefined();
  });
});

describe('addUsage', () => {
  it('accumulates across a retried run', () => {
    expect(
      addUsage({ inputTokens: 100, outputTokens: 10, cachedInputTokens: 20 }, {
        inputTokens: 50,
        outputTokens: 5,
      }),
    ).toEqual({
      inputTokens: 150,
      outputTokens: 15,
      cachedInputTokens: 20,
      reasoningTokens: undefined,
    });
  });

  it('takes the first report as-is', () => {
    expect(addUsage(undefined, { inputTokens: 7, outputTokens: 3 })).toEqual({
      inputTokens: 7,
      outputTokens: 3,
    });
  });
});
