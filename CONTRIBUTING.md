# Contributing to gitmuse

Thanks for taking the time to contribute. All contributions are welcome — bug fixes, new providers, docs, tests, or ideas.

## getting started

```bash
git clone https://github.com/bitsbyritik/gitmuse
cd gitmuse
npm install
npm run dev        # watch mode — rebuilds on every save
node dist/cli.js   # run the local build directly
npm link           # makes `gm` available globally from your local build
```

## before opening a PR

All three must pass with zero errors:

```bash
npm run typecheck   # strict TypeScript — no any, no implicit types
npm run lint        # ESLint
npm run test        # Vitest
```

## adding a new AI provider

1. Create `src/adapters/<name>.ts` extending `BaseAdapter` — implement `stream(prompt): AsyncIterable<string>`
2. Add the provider config interface to `src/types.ts`
3. Add defaults and the env-var priority chain to `src/config.ts`
4. Register a `case '<name>'` in `src/adapters/index.ts`
5. Add the provider choice and API key prompt to `src/setup.ts`
6. Update `README.md` — provider setup section, env-vars block, comparison table

For agents (Claude Code and friends) see *adding a CLI agent* below instead — they need no
adapter of their own.

Look at `src/adapters/groq.ts` as the simplest reference implementation.

## adding a CLI agent

An **agent** is a coding CLI the user is already signed in to (Claude Code and Codex CLI today).
gitmuse spawns it instead of holding a key — so there is no credential to store, and no OAuth flow
to reimplement. `src/adapters/cli-agent.ts` does the spawning, streaming, timeout and error
handling for every agent, so adding one is a single definition file:

1. Create `src/agents/<name>.ts` exporting a `CliAgent` (see `src/agents/types.ts` for the contract):
   - `versionArgs` — how to detect the binary
   - `authArgs` + `parseAuth` — how the CLI reports who is signed in (offline, no request).
     `parseAuth` gets stdout when the CLI wrote anything there, else stderr — Claude Code prints
     status on stdout, Codex on stderr
   - `buildInvocation(model, tier)` — argv for a one-shot, non-interactive completion.
     `full` may use any flag; `basic` must use only flags the CLI has had for a long time —
     it is retried automatically when an older install rejects a newer flag
   - `parseEvent(line)` — turn one line of stdout into `text` / `error` / `end`
2. Add the id to `AgentProviderName` in `src/types.ts`
3. Push it into `CLI_AGENTS` in `src/agents/index.ts`, and drop it from `PLANNED_AGENTS`
4. Add the id to the agent `case` list in `src/setup.ts` so the wizard offers it

That is all — `gm connect`, config (`agents.<id>.*`), the adapter and the error messages pick it up
from the registry. Use `src/agents/claude-code.ts` (stream deltas, JSON auth) or
`src/agents/codex.ts` (whole-message events, text auth) as the reference.

If the CLI's usable models depend on the user's plan or its own version, list `'default'` first and
have `buildInvocation` pass no model flag for it. Pinning a slug the account cannot request fails
every run — `gm connect` renders `default` as "whatever <agent> is already set to".

**Ground rule:** never read, copy, or reuse another tool's credential files or tokens. gitmuse
only ever *runs the agent's own CLI* and lets that CLI authenticate itself.

## change detection

`src/classify.ts` decides what kind of file a path is (source / test / docs / config / deps / ci /
generated / asset) and what the file mix already proves about the commit type. `src/git.ts` spends
the `maxDiffLines` budget across files using that, so noise never crowds out the real change.

If you add or fix a pattern there, add a case to `test/classify.test.ts` — the table format makes it
a one-line change, and it is the cheapest place in the codebase to prevent a wrong commit type.

## code style

- Strict TypeScript — no `any`, explicit return types on all exported functions
- ESM only — use `.js` extensions on all local imports
- No `__dirname` / `__filename` — use `import.meta.url` instead
- No comments explaining *what* the code does — only *why* when it's non-obvious
- Keep each file focused on one responsibility

## commit messages

Follow conventional commits. Use `gm` itself:

```bash
git add .
gm
```

## reporting bugs

Open an issue at https://github.com/bitsbyritik/gitmuse/issues and include:

- gitmuse version (`gm --version`)
- provider and model (`gm config list`)
- the exact command you ran
- the full error output
