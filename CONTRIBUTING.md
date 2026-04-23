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

Look at `src/adapters/groq.ts` as the simplest reference implementation.

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
