# neodrop-cli

> Operate the [Neodrop](https://neodrop.ai) platform **as yourself** from the command line — built to be driven by an AI agent (Claude Code / Cursor / Codex), usable by hand. Every `stdout` is valid JSON.

[![npm](https://img.shields.io/npm/v/neodrop-cli.svg)](https://www.npmjs.com/package/neodrop-cli)
[![node](https://img.shields.io/node/v/neodrop-cli.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/neodrop-cli.svg)](./LICENSE)

`neodrop-cli` calls the Neodrop API **as the currently logged-in user** — browse and search channels, read posts, manage subscriptions, and create channels. It handles auth, JSON serialization, error codes and locale defaults for you, so an agent never has to hand-roll HTTP.

## Install & run

```bash
# Recommended — no install, npx fetches it on demand (Node 18+)
npx neodrop-cli <command>

# Or install globally, then call the `neodrop` bin directly
npm i -g neodrop-cli
neodrop <command>
```

## Quick start

```bash
npx neodrop-cli login    # prints a neodrop.ai/cli-auth URL — open it, approve, done
npx neodrop-cli me       # who am I
npx neodrop-cli feed     # latest from the channels you subscribe to
```

`login` prints a `https://neodrop.ai/cli-auth?session=…` URL. Open it in **any** browser (this machine, your phone, another laptop), sign in, confirm the client on the consent page, and the CLI detects approval by polling and writes a Personal Access Token to `~/.neodrop/credentials.json` (`chmod 0600`).

No browser is auto-launched, no local port is opened, no callback is needed — so the same command works over SSH, in a cloud sandbox, or inside a Docker container, as long as the terminal can print a URL.

## Output contract

- **`stdout` is always valid JSON** — parse it directly (`JSON.parse` / `json.loads`). Add `--pretty` for indented JSON; both are valid.
- **`stderr`** carries human-readable logs, progress, error descriptions, and canonical `🔗 <url>` links — ignore it unless a command fails.
- **Exit codes**: `0` success · `1` business error (auth / not found / rejected input) · `2` usage error (bad CLI arguments).

## Commands

| Area | Commands |
|---|---|
| Identity | `me` · `whoami` · `tokens list` |
| Channels | `channels list` · `get` · `search` · `create` · `subscribe` · `unsubscribe` · `categories` · `by-category` |
| Posts | `posts list` · `get` · `search` · `feed` |
| Raw procedure | `api <procedure> [--json '…' \| --stdin] [--mutation]` |

Full command reference: [`references/commands.md`](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/references/commands.md).

## Use as an AI-agent skill

```bash
npx neodrop-cli install-skill
```

Copies the skill definition into `~/.claude/skills/neodrop-cli/` so an agent routes Neodrop requests to this CLI automatically. The agent-facing routing doc lives in [`SKILL.md`](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/SKILL.md).

## Documentation

- [Auth & security model](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/references/auth.md) — full login flow, reusing credentials across machines, self-hosting
- [Command reference](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/references/commands.md)
- [URL routing](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/references/url-routing.md) — map a pasted Neodrop link to the right command
- [Troubleshooting](https://github.com/NeoDropAI/neodrop-skills/blob/main/skills/neodrop-cli/references/troubleshooting.md) — error codes

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NEODROP_SERVER` | Web origin used by `login` | `https://neodrop.ai` |
| `NEODROP_API` | API origin used by `login` | Inferred from `NEODROP_SERVER` |

Credentials persist `webOrigin` / `apiOrigin`, so every other command reads them from the credential file — you don't pass them each time.

## License

[MIT](./LICENSE)
