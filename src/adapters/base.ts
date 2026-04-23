export abstract class BaseAdapter {
  abstract stream(prompt: string): AsyncIterable<string>;
}
