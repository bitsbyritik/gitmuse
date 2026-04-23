import { BaseAdapter } from '../../src/adapters/base.js';

/** Emits a fixed sequence of tokens — use in tests instead of hitting real APIs. */
export class MockAdapter extends BaseAdapter {
  private readonly tokens: string[];

  constructor(tokens: string[] = ['feat(auth): add login endpoint']) {
    super();
    this.tokens = tokens;
  }

  async *stream(_prompt: string): AsyncIterable<string> {
    for (const token of this.tokens) {
      yield token;
    }
  }
}

/** Returns a MockAdapter that throws on the first iteration. */
export class FailingAdapter extends BaseAdapter {
  private readonly error: Error;

  constructor(error: Error = new Error('provider failed')) {
    super();
    this.error = error;
  }

  async *stream(_prompt: string): AsyncIterable<string> {
    throw this.error;
    // unreachable — satisfies TS generator return type
    yield '';
  }
}
