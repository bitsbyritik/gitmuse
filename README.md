# gitmuse

> AI-generated commit messages in seconds. Free, local, or cloud — your choice.

[![npm version](https://img.shields.io/npm/v/gitmuse)](https://www.npmjs.com/package/gitmuse)
[![npm downloads](https://img.shields.io/npm/dm/gitmuse)](https://www.npmjs.com/package/gitmuse)
[![license](https://img.shields.io/github/license/bitsbyritik/gitmuse)](LICENSE)
[![node](https://img.shields.io/node/v/gitmuse)](https://nodejs.org)

```bash
npm install -g gitmuse
```

---

## demo

<!-- Replace with your actual GIF before launch -->

![gitmuse demo](https://raw.githubusercontent.com/bitsbyritik/gitmuse/main/demo.gif)

---

## features

- **zero config to start** — works with Ollama out of the box, no API key needed
- **connect an agent you already pay for** — `gm connect` borrows Claude Code, Codex CLI or Cursor
  CLI, so a subscription you already have generates your commit messages with no API key at all
- **free cloud tier** — Groq's free API gives you 14,000 requests/day at zero cost
- **any provider** — Ollama, OpenAI, Groq, Anthropic, Gemini, or any OpenAI-compatible endpoint
- **conventional commits** — picks the right type per diff (`fix`, `docs`, `refactor`, …), with a
  fixed emoji per type when `emoji` is on
- **reads the change, not just the diff** — file statuses, renames, churn and file kinds are sent as
  evidence, and lockfiles/build output never crowd the real change out of the prompt
- **live streaming** — watch tokens appear as they generate
- **know what it cost** — a token badge after every message, with a price when gitmuse knows the
  model's rate; connected agents show tokens only, since they bill a plan you already pay for
- **interactive TUI** — edit, regenerate, or confirm before anything is committed
- **git hook support** — `gm install` fills in the message on every `git commit` (husky-aware)
- **tiny footprint** — single ESM bundle, Node 18+, no native deps

## why gitmuse

- **Groq is genuinely free** — 14,400 requests/day, no credit card, no usage cap on the free tier
- **works offline** — Ollama runs entirely on your machine; your diff never leaves
- **tokens stream live** — you see the message build word by word, not a spinner then a wall of text
- **your keys, your data** — gitmuse never proxies your requests; it calls provider APIs directly from your machine
- **6 providers + connected agents, one command to switch** — `gm --provider gemini` overrides for a single run without touching config
- **no credential handling for agents** — gitmuse never reads another tool's tokens; it runs that tool's own CLI, which authenticates itself

---

## quick start

### option 1 — connect an agent you already pay for (no API key)

Already signed in to Claude Code, Codex CLI, or Cursor CLI? Borrow it:

```bash
npm install -g gitmuse
gm connect          # finds what you have installed, checks your sign-in,
                    # asks the agent which models you can use, sends a test request

git add .
gm
```

Nothing is stored but your choice of agent and model — the agent's own CLI keeps owning the
credential.

### option 2 — fully free with Groq

```bash
npm install -g gitmuse

# get a free API key at console.groq.com (no credit card)
gm config set provider groq
gm config set groq.apiKey YOUR_KEY_HERE

git add .
gm
```

### option 3 — 100% offline with Ollama

```bash
# install Ollama from ollama.com, then:
ollama pull llama3

npm install -g gitmuse
gm
```

### option 4 — first run wizard

```bash
npm install -g gitmuse
gm setup   # interactive setup, picks your provider
```

---

## usage

```bash
# generate a commit message for staged changes
gm

# short alias
gitmuse

# stage everything and commit in one step
git add . && gm

# skip the TUI, commit immediately
gm --yes

# regenerate without re-reading the diff
gm --retry

# preview the message without committing
gm --dry-run

# use a specific provider for this run
gm --provider openai

# connect / re-check a local coding agent
gm connect
gm connect claude-code --model sonnet
gm connect codex --model gpt-5.5
gm connect cursor --model composer-2.5
gm connect --list

# install as a git hook (fills in the message on every plain `git commit`)
gm install
```

### keyboard shortcuts in TUI

| key         | action                     |
| ----------- | -------------------------- |
| `Enter`     | confirm and commit         |
| `e`         | open in editor (`$EDITOR`) |
| `r`         | regenerate message         |
| `q` / `Esc` | abort                      |

---

## configuration

Config lives at `~/.config/gitmuse/config.json` and is managed via:

```bash
gm config set <key> <value>
gm config get <key>
gm config list
gm config reset
```

### all options

| key            | default          | description                  |
| -------------- | ---------------- | ---------------------------- |
| `provider`     | `ollama`         | AI provider to use           |
| `model`        | provider default | model override               |
| `maxDiffLines` | `200`            | diff line budget (see below) |
| `emoji`        | `false`          | add emoji to commit type     |
| `autoConfirm`  | `false`          | skip TUI, commit immediately |
| `language`     | `en`             | commit message language      |
| `showUsage`    | `true`           | print the token/cost badge   |

Connected agents store their settings under `agents.<id>`:

| key                            | default   | description                             |
| ------------------------------ | --------- | --------------------------------------- |
| `agents.claude-code.model`     | `sonnet`  | model to ask the agent for              |
| `agents.claude-code.command`   | `claude`  | path/name of the executable to spawn    |
| `agents.claude-code.timeoutMs` | `120000`  | how long to wait for the agent to reply |
| `agents.codex.model`           | `default` | model to ask for; `default` names none  |
| `agents.codex.command`         | `codex`   | path/name of the executable to spawn    |
| `agents.codex.timeoutMs`       | `120000`  | how long to wait for the agent to reply |
| `agents.cursor.model`          | `auto`    | model to ask the agent for              |
| `agents.cursor.command`        | `cursor-agent` | path/name of the executable to spawn |
| `agents.cursor.timeoutMs`      | `120000`  | how long to wait for the agent to reply |

`agents.codex.model` is `default` on purpose: which slugs a Codex account may request depends on the
plan and the CLI version, so gitmuse passes no `--model` unless you name one.

`gm connect` fills `model` in for you by asking the agent what your account may actually run, so you
rarely need to set it by hand.

### provider setup

**Ollama (local, free, offline)**

```bash
gm config set provider ollama
gm config set ollama.model llama3        # or mistral, codellama, etc.
gm config set ollama.baseURL http://localhost:11434
```

**Groq (cloud, free tier)**

```bash
gm config set provider groq
gm config set groq.apiKey gsk_xxxxxxxxxxxx
gm config set groq.model openai/gpt-oss-120b
```

**OpenAI**

```bash
gm config set provider openai
gm config set openai.apiKey sk-xxxxxxxxxxxx
gm config set openai.model gpt-4o-mini
```

**Anthropic**

```bash
gm config set provider anthropic
gm config set anthropic.apiKey sk-ant-xxxxxxxxxxxx
gm config set anthropic.model claude-haiku-4-5
```

**Gemini (cloud, free tier)**

```bash
gm config set provider gemini
gm config set gemini.apiKey YOUR_KEY_HERE   # free at aistudio.google.com
gm config set gemini.model gemini-2.5-flash # optional — this is the default
```

Available free-tier models:

| model              | rate limit | notes                                     |
| ------------------ | ---------- | ----------------------------------------- |
| `gemini-2.5-flash` | 10 req/min | default — best balance of speed + quality |
| `gemini-1.5-flash` | 15 req/min | slightly older, still excellent           |
| `gemini-1.5-pro`   | 2 req/min  | higher quality, stricter limits           |

**Custom OpenAI-compatible endpoint** (LM Studio, Jan, vLLM, etc.)

```bash
gm config set provider custom
gm config set custom.baseURL http://localhost:1234/v1
gm config set custom.apiKey optional-key
gm config set custom.model your-model-name
```

---

## how it reads your changes

Before any prompt is built, gitmuse asks git three questions — `--name-status -M` (what happened to
each file, including renames), `--numstat -M` (churn, and which files are binary), and the diff
itself — then classifies every path as source, test, docs, config, deps, ci, generated or asset.

That buys two things:

**1. The budget goes to the code that matters.** `maxDiffLines` is a budget shared *between* files,
not a blunt cut at line 200. Lockfiles, `dist/`, snapshots and binaries are reduced to a one-line
placeholder; the rest is split fairly, so a 2,000-line `package-lock.json` can no longer push your
actual fix out of the prompt:

```
3 files changed, +606 −601
- M  package-lock.json     +600 −600  [deps, diff trimmed]
- M  src/auth/session.js   +2 −1      [source]
- A  test/session.test.js  +4 −0      [test]
```

**2. The model is told what the files already prove.** Docs-only, tests-only, CI-only, deps-only and
pure-rename commits are pinned to a type before the model reads a line of code, and a scope is
guessed from the shared directory:

```
- every changed file is documentation → `docs` — use it unless the diff clearly shows otherwise
- likely scope: `auth` — use it only if it fits the change
- package-lock.json is generated/dependency noise — describe the source change, not this
```

The result for the example above: `🐛 fix(auth): treat missing sessions as expired` — not
`chore(deps): update lockfile`.

---

## connected agents (no API key)

Instead of giving gitmuse a key, you can point it at a coding CLI you are **already signed in to**.
gitmuse spawns that CLI in non-interactive mode and streams back what it prints.

```bash
gm connect            # pick an agent, sign in if needed, pick a model, test it
gm connect --list     # who is installed, who is signed in, what is in use
```

```
  Agents

  ◉  Claude Code   signed in · you@example.com · pro · v2.1.235  ← in use
  ●  Codex CLI     signed in · v0.139.0
  ●  Cursor CLI    signed in · you@example.com · v2026.7.9
```

**Supported today**

| agent           | vendor    | runs on                                                                           | install                                    |
| --------------- | --------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| **Claude Code** | Anthropic | your Claude Pro/Max subscription (or its API key, if that is how you set it up)     | `npm install -g @anthropic-ai/claude-code` |
| **Codex CLI**   | OpenAI    | your ChatGPT Plus/Pro/Business plan (or its API key, if that is how you set it up)  | `npm install -g @openai/codex`             |
| **Cursor CLI**  | Cursor    | your Cursor subscription (or its API key, if that is how you set it up)             | `curl https://cursor.com/install -fsS \| bash` |

The registry in `src/agents/index.ts` takes one definition file per agent, so adding another is a
small PR (see [CONTRIBUTING.md](CONTRIBUTING.md#adding-a-cli-agent)).

**How it works**

*Detection.* `gm connect` looks for each agent's executable across your PATH, and then across the
directories these installers actually write to (`~/.local/bin`, `~/.claude/local`, `~/.bun/bin`,
Homebrew, …). That last part matters: a git hook or a GUI-launched terminal often has a thinner PATH
than your shell, and "not installed" is the wrong answer when the binary is right there. When one
turns up off PATH, gitmuse pins its absolute path in config so every later run finds it too.

*Sign-in.* Each agent's own status command answers who you are — `claude auth status --json`,
`codex login status`, `cursor-agent status --format json`. All the probes run concurrently, because
some of these CLIs take seconds just to boot.

*Models.* Agents that can list their catalogue are asked for it, so you pick from what your account
may actually run rather than a list hardcoded here — Cursor reports 200+ models, which is why long
lists get a type-to-filter prompt. Agents with no such command fall back to gitmuse's defaults.

*Generating.* At commit time gitmuse runs the agent non-interactively (`claude -p`,
`codex exec --json`, `cursor-agent -p`) from a temp dir, not your repo, so your project's agent
instructions, hooks and MCP servers never enter the request. Codex runs in its `read-only` sandbox
and Cursor in `--mode ask`, since writing a commit message needs no write access to anything.

Every subprocess goes through [execa](https://github.com/sindresorhus/execa) — one place that owns
timeouts, missing binaries and non-zero exits, so a new agent inherits all of it.

**gitmuse never touches your credentials.** It does not read `~/.claude`, `~/.codex/auth.json` or
`~/.cursor`, does not copy tokens, and stores no secret of its own — the agent's CLI authenticates
itself, exactly as it does when you use it directly. (Extracting a subscription token to call the
API yourself is against these vendors' terms; this feature exists so nobody needs to.)

**Trade-offs**

- **slower** — ~10–30s, because a full agent CLI boots per commit (vs ~1–2s for a direct API call).
  Claude Code is the quickest of the three; Cursor's CLI takes several seconds just to start
- **counts against your plan** — the same rate limits as your interactive sessions
- **local only** — CI has no signed-in CLI, so keep an API-key provider configured there

---

## environment variables

All config keys can be overridden via environment variables. Useful for CI or shared machines.

```bash
GITMUSE_PROVIDER=groq
GITMUSE_MODEL=openai/gpt-oss-120b
GROQ_API_KEY=gsk_xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
GEMINI_API_KEY=your_key_here
```

Priority: **CLI flag > env var > config file > default**

---

## token usage and cost

After each message, gitmuse prints what the request actually consumed:

```
✨ feat(agents): add Cursor CLI support

  ↑ 4.0k in · ↓ 64 out · Cost: $0.0014
```

The counts are **reported by the provider**, not estimated from the diff — every adapter reads them
off the response (`usage`, `x_groq.usage`, `usageMetadata`, `prompt_eval_count`, …).

**Connected agents show tokens only, never a price:**

```
  ↑ 14k in · ↓ 133 out · 7.2k cached
```

That is deliberate, and it is what Claude Code and Codex CLI do too. Those requests bill a
subscription you have already paid for, so a per-request dollar figure would be invented.

**Cost appears only when gitmuse knows the model's rate.** Prices are first-party list rates, last
checked on the date in `src/pricing.ts`. A model that is not in that table shows tokens and no
price — gitmuse never guesses a dollar figure. Ollama reads as `local · free`.

A note on cache: providers disagree about whether cached input is counted inside their input
figure. Claude and Cursor report it separately (gitmuse sums them); Codex already includes it. The
`cached` figure is the share of the input that was served from cache.

Turn the badge off with:

```bash
gm config set showUsage false
```

---

## git hook

Install once per repo, and a plain `git commit` opens your editor with the message already written:

```bash
gm install
```

You still see and approve the message — the hook fills it in, git commits it. Edit it, or delete it
and write your own; nothing is committed until you save and close.

**Where it goes.** `gm install` asks git where it actually looks for hooks (`core.hooksPath`), not
just `.git/hooks`. In a repo using husky it installs to `.husky/prepare-commit-msg`, alongside your
other husky hooks, because husky regenerates `.husky/_` and the files in there only delegate
upwards. Committing that file shares the hook with everyone on the repo — leave it untracked if you
would rather it stayed yours.

**What it skips.** Anything that already has a message: `git commit -m`, `--amend`, merges, squashes
and commit templates. Only a plain `git commit` gets a generated one.

**It cannot block a commit.** If `gm` is missing, misconfigured or fails, the hook says so on stderr
and exits cleanly — git opens your editor as it always would.

To remove:

```bash
gm uninstall
```

---

## adding a provider

`gitmuse` uses a simple async iterable interface. Adding a new provider is ~20 lines:

```typescript
// src/adapters/my-provider.ts
import { BaseAdapter } from './base.js';
import type { Config } from '../types.js';

export class MyProviderAdapter extends BaseAdapter {
  constructor(private config: Config) {
    super();
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const res = await fetch('https://api.myprovider.com/v1/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.myProvider.apiKey}` },
      body: JSON.stringify({ prompt, stream: true }),
    });

    for await (const chunk of res.body!) {
      yield parseChunk(chunk);
    }
  }
}
```

Then register it in `src/adapters/index.ts` and open a PR. Contributions welcome.

### adding an agent

Agents (Claude Code, Codex CLI, Cursor CLI) need no adapter — `src/adapters/cli-agent.ts` already
handles spawning, streaming, timeouts and errors for all of them, and `src/agents/detect.ts` handles
finding the binary. You write one definition:

```typescript
// src/agents/my-agent.ts
import type { CliAgent } from './types.js';

export const myAgent: CliAgent = {
  id: 'my-agent',
  name: 'My Agent',
  vendor: 'Someone',
  tagline: 'runs on your Someone subscription',
  command: 'myagent',
  models: ['default'],
  install: 'npm install -g myagent',
  loginCommand: 'myagent login',
  docsUrl: 'https://example.com/docs',

  versionArgs: ['--version'],
  authArgs: ['auth', 'status', '--json'],
  parseAuth: (out) => ({ connected: JSON.parse(out).loggedIn === true }),

  // Optional: ask the CLI what the signed-in account may actually run.
  listModels: {
    args: ['models', '--json'],
    parse: (out) => JSON.parse(out).map((m) => ({ id: m.id, label: m.name })),
  },

  buildInvocation: (model, tier) => ({
    args: ['--print', '--model', model],
    format: 'text',
  }),

  parseEvent: (line, state) => ({ type: 'text', text: line }),
};
```

Add the id to `AgentProviderName` in `src/types.ts`, push the definition into `CLI_AGENTS` in
`src/agents/index.ts`, and `gm connect` lists it. Full checklist in
[CONTRIBUTING.md](CONTRIBUTING.md#adding-a-cli-agent).

---

## comparison

| tool            | install     | offline      | free tier           | streams | interactive | providers |
| --------------- | ----------- | ------------ | ------------------- | ------- | ----------- | --------- |
| **gitmuse**     | `npm i -g`  | yes (Ollama) | yes (Groq + Gemini) | yes     | yes         | 6         |
| opencommit      | `npm i -g`  | no           | no                  | no      | no          | 3         |
| aicommits       | `npm i -g`  | no           | no                  | no      | no          | 1         |
| gpt-commit      | pip         | no           | no                  | no      | no          | 1         |
| commitgpt       | browser ext | no           | no                  | no      | no          | 1         |

---

## requirements

- Node.js 18 or higher
- git
- one of: Ollama running locally, or an API key for Groq / Gemini / OpenAI / Anthropic

---

## contributing

```bash
git clone https://github.com/bitsbyritik/gitmuse
cd gitmuse
npm install
npm run dev        # watch mode
node dist/cli.js   # test locally
npm link           # makes `gm` available globally from your local build
```

Before opening a PR:

```bash
npm run typecheck
npm run lint
npm run test
```

Commit messages must follow conventional commits — feel free to use `gm` itself to generate them.

---

## star history

[![Star History Chart](https://api.star-history.com/svg?repos=bitsbyritik/gitmuse&type=Date)](https://star-history.com/#bitsbyritik/gitmuse&Date)

---

## license

MIT © [Ritik Singh](https://github.com/bitsbyritik)

---

<div align="center">
  <sub>if this saves you time, a star goes a long way ⭐</sub>
</div>
