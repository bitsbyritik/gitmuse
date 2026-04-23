#!/usr/bin/env node
import { program } from "commander";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

program
  .name("gitmuse")
  .description("AI-generated commit messages in seconds")
  .version(pkg.version)
  .option("-y, --yes", "skip confirmation, commit immediately")
  .option("-d, --dry-run", "print message without committing")
  .option("-r, --retry", "regenerate without re-reading diff")
  .option("-p, --provider <name>", "override provider for this run")
  .option("-s, --silent", "suppress output except the message")
  .action(async (options) => {
    const { run } = await import("../src/engine.js");
    await run(options);
  });

program
  .command("setup")
  .description("interactive provider setup wizard")
  .action(async () => {
    const { setup } = await import("../src/setup.js");
    await setup();
  });

program
  .command("config <action> [key] [value]")
  .description("get, set, list or reset config values")
  .action(async (action, key, value) => {
    const { manageConfig } = await import("../src/config.js");
    await manageConfig(action, key, value);
  });

program
  .command("install")
  .description("install as a git hook in current repo")
  .action(async () => {
    const { installHook } = await import("../src/hooks.js");
    await installHook();
  });

program.parseAsync();
