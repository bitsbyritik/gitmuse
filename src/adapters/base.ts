/**
 * All provider adapters extend this class and implement stream().
 * Tokens must be yielded as they arrive — callers render them in real time.
 */
export abstract class BaseAdapter {
  abstract stream(prompt: string): AsyncIterable<string>;
}
