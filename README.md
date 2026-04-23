# gitmuse

> AI-generated commit messages in seconds. Free, local, or cloud — your choice.

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
- **free cloud tier** — Groq's free API gives you 14,000 requests/day at zero cost
- **any provider** — Ollama, OpenAI, Groq, Anthropic, Gemini, or any OpenAI-compatible endpoint
- **conventional commits** — always generates `feat:`, `fix:`, `chore:` format
- **live streaming** — watch tokens appear as they generate
- **interactive TUI** — edit, regenerate, or confirm before anything is committed
- **git hook support** — `gm install` wires it into your repo permanently
- **tiny footprint** — single ESM bundle, Node 18+, no native deps

---

## quick start

### option 1 — fully free with Groq (recommended)

```bash
npm install -g gitmuse

# get a free API key at console.groq.com (no credit card)
gm config set provider groq
gm config set groq.apiKey YOUR_KEY_HERE

git add .
gm
```

### option 2 — 100% offline with Ollama

```bash
# install Ollama from ollama.com, then:
ollama pull llama3

npm install -g gitmuse
gm
```

### option 3 — first run wizard

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

# install as a git hook (runs on every git commit)
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
| `maxDiffLines` | `200`            | truncate large diffs         |
| `emoji`        | `false`          | add emoji to commit type     |
| `autoConfirm`  | `false`          | skip TUI, commit immediately |
| `language`     | `en`             | commit message language      |

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
gm config set groq.model llama-3.3-70b-versatile
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
gm config set gemini.model gemini-2.0-flash # optional — this is the default
```

Available free-tier models:

| model | rate limit | notes |
| ----- | ---------- | ----- |
| `gemini-2.0-flash` | 15 req/min | default — best balance of speed + quality |
| `gemini-1.5-flash` | 15 req/min | slightly older, still excellent |
| `gemini-1.5-pro`   | 2 req/min  | higher quality, stricter limits |

**Custom OpenAI-compatible endpoint** (LM Studio, Jan, vLLM, etc.)

```bash
gm config set provider custom
gm config set custom.baseURL http://localhost:1234/v1
gm config set custom.apiKey optional-key
gm config set custom.model your-model-name
```

---

## environment variables

All config keys can be overridden via environment variables. Useful for CI or shared machines.

```bash
GITMUSE_PROVIDER=groq
GITMUSE_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=gsk_xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
GEMINI_API_KEY=your_key_here
```

Priority: **CLI flag > env var > config file > default**

---

## git hook

Install once per repo and `git commit` triggers `gitmuse` automatically:

```bash
gm install
```

This writes a `prepare-commit-msg` hook to `.git/hooks/`. Works with any git workflow — `git commit`, IDE git panels, GitLens, etc.

To remove:

```bash
gm uninstall
```

---

## adding a provider

`gitmuse` uses a simple async iterable interface. Adding a new provider is ~20 lines:

```typescript
// src/adapters/my-provider.ts
import { BaseAdapter } from "./base.js";
import type { Config } from "../types.js";

export class MyProviderAdapter extends BaseAdapter {
  constructor(private config: Config) {
    super();
  }

  async *stream(prompt: string): AsyncIterable<string> {
    const res = await fetch("https://api.myprovider.com/v1/generate", {
      method: "POST",
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

---

## comparison

| tool        | install     | offline      | free tier               | streams | interactive |
| ----------- | ----------- | ------------ | ----------------------- | ------- | ----------- |
| **gitmuse** | `npm i -g`  | yes (Ollama) | yes (Groq + Gemini)     | yes     | yes         |
| aicommits   | `npm i -g`  | no           | no                      | no      | no          |
| gpt-commit  | pip         | no           | no                      | no      | no          |
| commitgpt   | browser ext | no           | no                      | no      | no          |

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

## license

MIT © [Ritik Singh](https://github.com/bitsbyritik)

---

<div align="center">
  <sub>if this saves you time, a star goes a long way ⭐</sub>
</div>
