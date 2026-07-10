# Troubleshooting

When the CLI errors, **first read the error code in brackets on stderr**, then match it below.

## Auth / login

| Symptom | Meaning | Fix |
|---|---|---|
| `not logged in` | `~/.neodrop/credentials.json` wasn't found | Tell the user to run `npx neodrop-cli login` |
| Consent page says "invalid authorization request / missing valid session parameter" | The opened URL has no valid `?session=cas_...`. **Most often the CLI is outdated** — old versions used a callback mode and print `/cli-auth?callback=&state=&name=`, which the new session-polling consent page rejects; otherwise the `?session=` tail was dropped when copying | Check the URL shape: ① `?callback=&state=` (or those keys all empty) → the CLI is stale (npx hit a cached old version); force the latest with `npx neodrop-cli@latest login`, the new link looks like `?session=cas_...`; ② already `?session=` but partial → rerun `login` and copy the whole line. Links are valid 10 minutes; reissue if expired |
| `[UNAUTHORIZED]` | PAT is invalid (expired / revoked / user logged out) | Ask the user to `login` again; for headless environments see [auth.md](auth.md) |
| `[FORBIDDEN]` | The PAT lacks permission for this procedure (e.g. an admin procedure) | Don't re-login — a PAT is always a regular-user identity; switch commands or have a real admin do it |

## Network / domains

| Symptom | Fix |
|---|---|
| `connection failed: ECONNREFUSED` | Backend isn't up / wrong port. Local dev: re-login with `NEODROP_SERVER=http://localhost:4001 npx neodrop-cli login` |
| `connection failed: ENOTFOUND` / `EAI_AGAIN` | DNS failure; check whether `apiOrigin` is wrong (see `whoami` output) |
| `connection failed: self-signed certificate` / `unable to verify ... certificate` | A self-hosted instance uses a self-signed cert; unsupported today — use LetsEncrypt or a reverse proxy with a valid cert |
| `connection failed: HeadersTimeoutError` / hangs ~30 s then errors | Network flakiness / unresponsive backend (the CLI times out a single request at 30 s and already retried once); try again later |

## Backend business errors

| Symptom | Meaning | Fix |
|---|---|---|
| `[NOT_FOUND]` | id / slug doesn't exist | List with `channels list` / `posts list` first to verify the id |
| `[BAD_REQUEST]` | Input schema is wrong (most common with `--json`) | Read the stderr detail; cross-check `neodrop <cmd> --help`; for complex input, get it working with a sugar command first, then drop to `--json` |
| `[INTERNAL_SERVER_ERROR]` | The backend crashed | Retry once; if it persists, open an issue with the full stderr |

## Environment

| Symptom | Fix |
|---|---|
| `npx: command not found` / unsupported syntax / `fetch is not defined` | Node is missing or too old; install Node 18+ (`node --version` to check) |
| `npx` stuck downloading / running a stale version | npx caches packages; force the latest with `npx neodrop-cli@latest <cmd>`, or install globally with `npm i -g neodrop-cli` |
| stdout looks empty / isn't JSON | The command actually failed — read stderr; the CLI only writes JSON to stdout on success |
