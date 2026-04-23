import { program } from 'commander';
import { createRequire } from 'module';
import { handleFatalError } from '../src/errors.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// Clean exit on Ctrl+C before any command starts
process.on('SIGINT', () => {
  process.stdout.write('\n');
  process.exit(0);
});

program
  .name('gitmuse')
  .description('AI-generated commit messages in seconds')
  .version(pkg.version)
  .option('-y, --yes', 'skip confirmation, commit immediately')
  .option('-d, --dry-run', 'print message without committing')
  .option('-r, --retry', 'regenerate without re-reading diff')
  .option('-p, --provider <name>', 'override provider for this run')
  .option('-s, --silent', 'suppress output except the commit message')
  .action(async (options: Record<string, unknown>) => {
    const { run } = await import('../src/engine.js');
    await run(options);
  });

program
  .command('setup')
  .description('interactive provider setup wizard')
  .action(async () => {
    const { setup } = await import('../src/setup.js');
    await setup().catch(handleFatalError);
  });

program
  .command('config <action> [key] [value]')
  .description('get, set, list, or reset config values')
  .action(async (action: string, key?: string, value?: string) => {
    const { manageConfig } = await import('../src/config.js');
    await manageConfig(action, key, value).catch(handleFatalError);
  });

program
  .command('install')
  .description('install gitmuse as a git hook in the current repo')
  .action(async () => {
    const { installHook } = await import('../src/hooks.js');
    await installHook().catch(handleFatalError);
  });

program
  .command('uninstall')
  .description('remove the gitmuse git hook from the current repo')
  .action(async () => {
    const { uninstallHook } = await import('../src/hooks.js');
    await uninstallHook().catch(handleFatalError);
  });

program.parseAsync().catch(handleFatalError);
