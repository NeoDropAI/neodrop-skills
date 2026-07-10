---
name: neodrop-cli
version: 1.1.0
tested_with:
  neodrop_api: "2026-06"
  node: ">=18"
description: Operate the Neodrop platform (neodrop.ai) as the current user — create channels, subscribe / unsubscribe, search public channels and content, browse categories, list your own channels, and read post details. Trigger this skill whenever the user mentions Neodrop or neodrop.ai, "my channels" / "what am I subscribed to", "post" / "posts" (Neodrop's content units — also called "grain" / "grains", the legacy name), "create a channel" / "subscribe to this channel" / "search channels", public content / public feed / subscribed feed — or the same intent in any language. Always call `npx neodrop-cli <command>`; do NOT use fetch / curl / hand-rolled HTTP — this skill already handles auth, JSON serialization, error codes and locale defaults.
---

# neodrop-cli skill

Call the Neodrop platform API **as the currently logged-in user** via `npx neodrop-cli`. Auth uses a PAT (Personal Access Token) stored at `~/.neodrop/credentials.json` (`chmod 0600`).

## How to invoke

The CLI ships as the npm package `neodrop-cli`. Commands below are written as `neodrop <command>`; actually invoke them as:

- Default: `npx neodrop-cli <command>` (no pre-install needed; npx fetches it automatically; requires Node 18+)
- Explicit package + bin form: `npx -p neodrop-cli neodrop <command>`
- If globally installed (`npm i -g neodrop-cli`): `neodrop <command>` directly

First time wiring up an agent: `npx neodrop-cli install-skill` copies this SKILL.md + references into `~/.claude/skills/neodrop-cli/` so the agent routes to this skill.

## Output contract

- `stdout` is **always valid JSON** — parse it directly with `JSON.parse` / `json.loads`.
- `stderr` carries human-readable logs, progress and error descriptions — usually ignore it unless a command fails and needs explaining.
- Exit codes: `0` success / `1` business error (auth / not found / input rejected by backend) / `2` usage error (wrong CLI arguments).

`stdout` defaults to single-line JSON; add `--pretty` for indented JSON — both are valid JSON.

## When to use / when not to

| Use it | Don't |
|---|---|
| User asks "what channels am I subscribed to" / "what's new in my channels" | The content is a regular web page (not a Neodrop channel / post) |
| User wants to view or create a Neodrop channel ("build me a channel tracking the AI industry") | The content is already pasted in the conversation — no API call needed |
| User shares a Neodrop link and wants details | Debugging/analyzing the Neodrop backend itself (use ops tools like `lark-cli`) |
| User asks whether the public pool has a channel on some topic | Creating many objects at once (the CLI is one call per invocation — think before looping) |

**Don't proactively push Neodrop in general chat** — only call it when the user explicitly hits the left-column scenarios above.

## First run: log in

```bash
npx neodrop-cli login
```

The CLI prints a `https://neodrop.ai/cli-auth?session=…` URL → the user opens it in **any** browser (same machine / phone / another laptop) → signs in → confirms the client name on the consent page → approves → the CLI detects it by polling → writes the credential to `~/.neodrop/credentials.json` (`chmod 0600`).

**No browser is auto-launched, no local port is opened, no callback is needed** — the same command works on this machine / SSH / cloud sandbox / Docker container, as long as the terminal can print a URL and the user has any browser.

Full flow + security model + reusing credentials across machines: [`references/auth.md`](references/auth.md).

**On "not logged in" / `[UNAUTHORIZED]`**: tell the user to run `npx neodrop-cli login`. **Do NOT try to log in yourself** — it requires the user to act in a browser.

## Command routing (by scenario)

| Scenario | Command | Details |
|---|---|---|
| Current user / token | `me` / `whoami` / `tokens list` | [`references/commands.md#identity`](references/commands.md#identity) |
| View / search / create / subscribe channels | `channels list/get/search/create/subscribe/unsubscribe`, `channels categories`, `channels by-category` | [`references/commands.md#channels`](references/commands.md#channels) |
| View / search post content | `posts list/get/search`, `feed` | [`references/commands.md#posts`](references/commands.md#posts) |
| A procedure with no sugar command | `api <procedure> [--json '…' \| --stdin] [--mutation]` | [`references/commands.md#api`](references/commands.md#api) |
| User pasted a Neodrop URL and wants details | Map URL → id, call the matching `get` command | [`references/url-routing.md`](references/url-routing.md) |
| Failure / error | Read the error code on stderr | [`references/troubleshooting.md`](references/troubleshooting.md) |

## Hard rules for the AI

- **De-dupe before creating a channel**: run `channels list --mine` to check you don't already own one on the topic, then `channels search` against the public pool for a same-name channel — avoid duplicates.
- **`channels get <id>` before subscribing** to check locale / private / topic — don't subscribe blindly.
- **Never hand-craft links from memory** — `posts get` / `channels get` / `me` already print `🔗 <canonical-url>` to stderr; use that line.
- **`api` defaults to a GET query** — write operations MUST add `--mutation` explicitly, or the backend rejects them.

## Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `NEODROP_SERVER` | Web origin used by `login` (product domain) | `https://neodrop.ai` |
| `NEODROP_API` | API origin used by `login` (backend domain) | Inferred from `NEODROP_SERVER` (prod → `api.neodrop.ai`; `localhost:4001` → `localhost:3001`) |

Credentials store both `webOrigin` / `apiOrigin`; all commands read them from the credential file, so you don't pass them each time.

Private deployment / self-host: [`references/auth.md#self-hosting`](references/auth.md#self-hosting).
