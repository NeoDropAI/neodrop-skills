# neodrop-cli command reference

> Invocation convention: `npx neodrop-cli <command>` (see [SKILL.md → How to invoke](../SKILL.md#how-to-invoke)).
> Equivalent explicit form: `npx -p neodrop-cli neodrop <command>`. Examples below are written as `neodrop <command>`.
>
> Every command prints **valid JSON to stdout**; logs, progress and `🔗` links go to stderr. Add `--pretty` for indented JSON, `--help` on any command for its arguments.

## identity

| Command | What it does |
|---|---|
| `neodrop me` | Current user info (`user.getMe`). |
| `neodrop whoami` | `me` plus token metadata — which credential is in use and when it expires. |
| `neodrop tokens list` | Every Personal Access Token you've issued. |
| `neodrop tokens revoke <id>` | Revoke a PAT. If it's this machine's token, the local credential is cleared too. |

## channels

**View & search**

| Command | What it does |
|---|---|
| `neodrop channels list --mine` | Channels you own. |
| `neodrop channels list --locale en --limit 20` | Public channels, paginated. |
| `neodrop channels get <channelId>` | Single channel detail, including `requirement.public`. |
| `neodrop channels categories` | All channel categories. |
| `neodrop channels by-category <category> --sort latest --limit 20` | Channels in a category. |
| `neodrop channels search "<query>" --locale en --limit 10` | Full-text search over the public pool. |

**Create & subscribe**

| Command | What it does |
|---|---|
| `neodrop channels create --name "<name>" --description "<desc>" --locale en` | Create a channel from flags. |
| `neodrop channels create --json '{"name":"X","locale":"en","type":"PRIVATE"}'` | Create a channel from a full JSON payload. |
| `neodrop channels subscribe <channelId>` | Subscribe to a channel. |
| `neodrop channels unsubscribe <channelId>` | Unsubscribe from a channel. |

> **Locale defaults**: `channels list` defaults to `en` (the product's default public pool). `channels search` / `by-category` omit locale unless you pass `--locale`, letting the backend decide. Pass `--locale en` (etc.) explicitly to query across locales.

## posts

> The content unit is a **post**. The old name `grains` stays as a backward-compatible alias; new code should use `posts`.

| Command | What it does |
|---|---|
| `neodrop posts list --limit 10` | Public feed. |
| `neodrop posts list --subscribed --limit 10` | Posts from your subscriptions (same as `neodrop feed --limit 10`). |
| `neodrop posts list --channel <channelId> --limit 10` | Posts from one channel. |
| `neodrop posts get <postId>` | Single post detail. |
| `neodrop posts search "<query>" --limit 10` | Full-text search over posts. |
| `neodrop feed --limit 10` | Alias for `posts list --subscribed`. |

## chat

Talk to Neodrop's AI assistants as the current user. The command **blocks until the reply is fully generated** (replies come from a backend worker and survive disconnects), then prints the complete result as JSON.

| Command | What it does |
|---|---|
| `neodrop chat "<message>"` | Send a message to the **global assistant** in a new session. |
| `neodrop chat "<message>" --session <sessionId>` | Continue an existing session. |
| `neodrop chat "<message>" --channel <channelId>` | Talk to a **channel assistant** (owner: can edit the channel's config; reader: Q&A about the channel). |
| `neodrop chat history --session <sessionId>` | Full message list of a session. |
| `neodrop chat sessions` | Your sessions — find one to continue. |

**Flags**

| Flag | Default | Purpose |
|---|---|---|
| `--session <id>` | — | Continue a specific session instead of starting a new one. |
| `--channel <id>` | — | Target a channel assistant instead of the global assistant. |
| `--locale <code>` | `en` | Language of the assistant's error messages. |
| `--timeout <seconds>` | `600` | Max total wait. On timeout the reply keeps generating server-side — fetch it later with `chat history`. |

**Output shape**: `{sessionId, reply: {text, parts} | null, newMessages: [...]}` — `reply.text` is the assistant's final text; `newMessages` is every message produced this turn (tool calls, cards, …). `reply` can be `null` if generation failed; inspect `newMessages` then.

- A new conversation prints its `sessionId` on stderr — **reuse it with `--session` for follow-ups**, don't start a fresh session per question.
- Chat consumes the account's AI credits like the web app does; a `402 insufficient_credits` error means the user must top up.

## api

For tRPC procedures with no sugar command, fall back to `api`:

| Command | What it does |
|---|---|
| `neodrop api <procedure>` | Call any tRPC **query** (GET). |
| `neodrop api <procedure> --json '{...}' --mutation` | Call a **write** — `--mutation` is required or the backend rejects it as a query. |
| `echo '{...}' \| neodrop api <procedure> --stdin --mutation` | Read the JSON input from stdin (great for heredocs / pipelines). |

- **Defaults to a GET query** — every write MUST add `--mutation` explicitly.
- To find a procedure's full name, check the main repo's `packages/backend/src/api/trpc/routers.ts`, or probe `curl /api/trpc/<router>.<procedure>?input=...` against a dev backend.

## Global flags

| Flag | Purpose |
|---|---|
| `--pretty` | Indented JSON for humans (still valid JSON). |
| `--help` | Show a subcommand's arguments. |
