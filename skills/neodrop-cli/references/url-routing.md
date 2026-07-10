# Neodrop URL → CLI command mapping

When the user pastes a Neodrop link and wants details, extract the id from the path and call the matching command below.

| URL pattern | id meaning | Call |
|---|---|---|
| `neodrop.ai/post/<id>` | post id | `posts get <id>` |
| `neodrop.ai/feed/<id>` | legacy post id | `posts get <id>` |
| `neodrop.ai/channel/<id>` | channelId | `channels get <id>` |
| `neodrop.ai/user/<id>` | userId | No dedicated sugar command — use `api user.getById --json '{"id":"<id>"}'` |
| `neodrop.ai/discover` | public discover page | `channels list --locale <l>` / `channels by-category <slug>`, per the user's context |
| `neodrop.ai/search?q=...` | site-wide search | `channels search "<q>"` + `posts search "<q>"` combined |

## Reverse: how to give the user a link back

**Don't hand-craft from memory** — `posts get` / `channels get` / `me` already print a `🔗 <canonical-url>` line to stderr; quote that line directly.

Don't assemble `/grain/<id>` or legacy `/feed/<id>` (both migrate to `/post/<id>`) or guess other paths. If a command didn't print a canonical URL, derive it from the table above:

- channelId → `https://neodrop.ai/channel/<id>`
- postId → `https://neodrop.ai/post/<id>`
- userId → `https://neodrop.ai/user/<id>`

For a self-hosted instance, read the `webOrigin` from the credential (shown in `neodrop whoami` output).
