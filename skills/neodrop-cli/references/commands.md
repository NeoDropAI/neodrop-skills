# neodrop-cli command reference

> Invocation convention: use `npx neodrop-cli <command>` (see [SKILL.md → How to invoke](../SKILL.md#how-to-invoke)).
> Equivalent explicit package + bin form: `npx -p neodrop-cli neodrop <command>`.
> Examples below are written as `neodrop <command>`.

## identity

```bash
neodrop me                    # current user info (user.getMe)
neodrop whoami                # me + token metadata (credential + expiry)
neodrop tokens list           # every PAT you've issued
neodrop tokens revoke <id>    # revoke a PAT; if it's this machine's token, the local credential is cleared too
```

## channels

### View / search

```bash
neodrop channels list --mine                       # channels you own
neodrop channels list --locale en --limit 20       # public channels, paginated
neodrop channels get <channelId>                   # single channel detail (incl. requirement.public)
neodrop channels categories                        # all categories
neodrop channels by-category tech --sort latest --limit 20

neodrop channels search "AI weekly" --locale en --limit 10
```

### Write

```bash
neodrop channels create --name "AI industry tracker" --description "..." --locale en
neodrop channels create --json '{"name":"X","locale":"en","type":"PRIVATE"}'
neodrop channels subscribe <channelId>
neodrop channels unsubscribe <channelId>
```

**Default locale**: `channels list` defaults to `en`, matching the product's default public pool. `channels search` and `channels by-category` omit locale when `--locale` is not provided and let the backend decide. Pass `--locale en` (etc.) explicitly to query the public pool across locales.

## posts

> The content unit is called a **post** on Neodrop. The old command name `grains` is kept as a backward-compatible alias, but new code should use `posts`.

```bash
neodrop posts list --limit 10                     # public feed
neodrop posts list --subscribed --limit 10        # your subscriptions (= neodrop feed --limit 10)
neodrop posts list --channel <channelId> --limit 10
neodrop posts get <postId>
neodrop posts search "Apple Intelligence" --limit 10

neodrop feed --limit 10                            # alias for posts list --subscribed
```

## api

For tRPC procedures with no sugar command, fall back to `api`:

```bash
neodrop api channel.update --json '{"id":"<chId>","name":"New name"}' --mutation
neodrop api user.getLinkedAccounts                 # any query
echo '{...}' | neodrop api channel.create --stdin --mutation
```

- **Defaults to a GET query** — a mutation (write) MUST add `--mutation` explicitly, or the backend routes it as a query and rejects it.
- Pass complex input with `--json '...'` inline, or `--stdin` to read from standard input (great for heredocs / pipelines).
- To find a procedure's full name, check the main repo's `packages/backend/src/api/trpc/routers.ts`, or probe with `curl /api/trpc/<router>.<procedure>?input=...` against a dev backend.

## Global

```bash
neodrop --pretty <cmd>          # indented JSON for humans (still valid JSON)
neodrop <cmd> --help            # subcommand arguments
```
