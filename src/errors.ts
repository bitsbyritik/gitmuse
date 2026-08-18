export class GitMuseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'GitMuseError';
  }
}

export class NoStagedChangesError extends GitMuseError {
  constructor() {
    super(
      'No staged changes found. Use `git add` to stage files before running gitmuse.',
      'NO_STAGED_CHANGES',
    );
    this.name = 'NoStagedChangesError';
  }
}

export class NotAGitRepoError extends GitMuseError {
  constructor() {
    super(
      'Not a git repository. Run this command from inside a git repository.',
      'NOT_A_GIT_REPO',
    );
    this.name = 'NotAGitRepoError';
  }
}

export class ProviderError extends GitMuseError {
  constructor(provider: string, detail: string) {
    super(`Provider "${provider}" failed: ${detail}`, 'PROVIDER_ERROR');
    this.name = 'ProviderError';
  }
}

export class ConfigError extends GitMuseError {
  constructor(detail: string) {
    super(`Configuration error: ${detail}`, 'CONFIG_ERROR');
    this.name = 'ConfigError';
  }
}

export class GitError extends GitMuseError {
  constructor(detail: string) {
    super(`Git command failed: ${detail}`, 'GIT_ERROR');
    this.name = 'GitError';
  }
}

export class HookError extends GitMuseError {
  constructor(detail: string) {
    super(`Hook operation failed: ${detail}`, 'HOOK_ERROR');
    this.name = 'HookError';
  }
}

export class MissingApiKeyError extends GitMuseError {
  constructor(provider: string, envVar: string) {
    super(
      `Missing API key for ${provider}. Set ${envVar} or run \`gm setup\`.`,
      'MISSING_API_KEY',
    );
    this.name = 'MissingApiKeyError';
  }
}

export class AgentNotInstalledError extends GitMuseError {
  constructor(name: string, command: string, install: string) {
    super(
      `${name} is not installed — "${command}" was not found on your PATH.\n` +
        `    Install it with: ${install}`,
      'AGENT_NOT_INSTALLED',
    );
    this.name = 'AgentNotInstalledError';
  }
}

export class AgentNotConnectedError extends GitMuseError {
  constructor(name: string, loginCommand: string) {
    super(
      `${name} is installed but not signed in.\n    Sign in with: ${loginCommand}`,
      'AGENT_NOT_CONNECTED',
    );
    this.name = 'AgentNotConnectedError';
  }
}

/**
 * Prints a friendly error message to stderr and exits with code 1.
 * Use as the top-level catch handler in every command.
 */
export function handleFatalError(err: unknown): never {
  if (err instanceof GitMuseError) {
    process.stderr.write(`\n  ✗ ${err.message}\n\n`);
    process.exit(1);
  }
  if (err instanceof Error) {
    process.stderr.write(`\n  ✗ Unexpected error: ${err.message}\n\n`);
    if (process.env['DEBUG']) process.stderr.write(err.stack ?? '');
    process.exit(1);
  }
  process.stderr.write('\n  ✗ An unknown error occurred.\n\n');
  process.exit(1);
}
