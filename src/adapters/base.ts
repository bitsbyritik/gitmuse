import type { TokenUsage } from '../usage.js';

/**
 * All provider adapters extend this class and implement stream().
 * Tokens must be yielded as they arrive — callers render them in real time.
 */
export abstract class BaseAdapter {
  /**
   * What the provider said the last completed stream consumed, when it says.
   * Set as the stream finishes, so read it only after iteration is done; it is
   * cleared at the start of every run, and stays undefined for providers that
   * report nothing.
   */
  usage?: TokenUsage;

  abstract stream(prompt: string): AsyncIterable<string>;
}
