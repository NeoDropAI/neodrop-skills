# Login & credentials (auth)

## The only login flow: session polling

```bash
npx neodrop-cli login
```

No flags, no mode branches. The CLI does this:

1. Calls the backend `cliToken.startSession` to create a one-time session (256-bit random sessionId, valid 10 minutes), and receives a **private claim secret `pollSecret` handed only to this CLI process** (never in the URL).
2. Prints a `https://neodrop.ai/cli-auth?session=<sid>` verification URL to stderr (the URL carries only the sessionId, no pollSecret).
3. Polls `cliToken.pollSession` roughly every 2 s with `{sessionId, pollSecret}`, waiting for approval.
4. The user opens the URL in any browser → signs in → lands on the consent page → sees the CLI's self-reported `clientName` → **ticks "this is the CLI I just started"** → approves.
5. The CLI receives the PAT → writes it to `~/.neodrop/credentials.json` (`chmod 0600`).

Properties:

- **No auto-launched browser** — it only prints the URL; the user copies it (same machine / phone / another device).
- **No local HTTP server / callback** — the CLI polls the backend one-way; the browser never connects back to the CLI machine.
- **No token in a URL or browser history** — the plaintext token only ever travels over the CLI ↔ backend HTTPS API call.
- **Claiming requires the pollSecret** — polling must return the private `pollSecret` from `startSession` (the backend stores only its hash); the URL carries only the sessionId, so even a leaked/forwarded/screenshotted URL can't claim the token.
- **Single claim** — the moment the CLI's first poll receives the token, the backend wipes the `plaintextToken` field.
- **Session expires in 10 minutes** — if it lapses, rerun `login`.

## Credential file

```jsonc
~/.neodrop/credentials.json
{
  "webOrigin": "https://neodrop.ai",
  "apiOrigin": "https://api.neodrop.ai",
  "token": "grain_pat_…",          // plaintext PAT, local only; mode 0600
  "tokenId": "tok_…",              // used for logout / remote revoke
  "name": "Claude Code @ macbook",  // client name shown on /settings/cli-tokens
  "expiresAt": "2026-09-01T…Z",    // 90 days by default
  "createdAt": "2026-06-04T…Z"
}
```

## Across machines: scp the credential file

Cloud sandboxes / CI / remote agents / any machine with no browser but SSH access: log in once locally, then scp it over:

```bash
# Local machine (has a browser, already logged in):
scp ~/.neodrop/credentials.json agent-box:~/.neodrop/credentials.json
ssh agent-box 'chmod 600 ~/.neodrop/credentials.json && npx neodrop-cli whoami'
```

The credential file *is* the credential — the CLI has no dedicated `import` command because `cp` is enough. **A moved PAT equals your login identity**, so transfer it over SSH / an encrypted channel. A headless machine can `npx neodrop-cli logout` to revoke the token when done, then get a fresh one next time.

## Security model

| Risk | Defense |
|---|---|
| Someone sends you a malicious cli-auth URL to trick you into approving | The consent page forces the "this is the CLI I just started" checkbox + displays `clientName` for you to recognize |
| A leaked session-id URL is replayed to claim the token | The browser-visible sessionId is separated from the CLI-private `pollSecret` — claiming requires the pollSecret (the backend verifies its hash), which the URL never contains; plus single-claim + 10-minute expiry |
| A PAT recursively issuing new PATs | `approveSession` rejects requests whose `ctx.sessionId.startsWith('pat:')`, letting only browser sessions through |
| A PAT file sitting in plaintext locally | Written with `chmod 0600`, per the `~/.aws/credentials` convention |
| `startSession` being spammed | Backend IP-level rate limit (10 / min) |
| Cross-user privilege escalation | Each procedure's own `where: { userId: ctx.userId }` guard |

The consent page **untrustedly** shows the CLI's self-reported `clientName` (any script can pass `--name "Claude Code"` to spoof it) — which is exactly why the confirmation checkbox is mandatory. **The user must personally confirm** the clientName matches the command they just ran.

## Self-hosting

```bash
# Option A — environment variable
NEODROP_SERVER=https://your-neodrop.example.com npx neodrop-cli login

# Option B — login flag
npx neodrop-cli login --server https://your-neodrop.example.com
```

The API origin is inferred from the web origin heuristically (`neodrop.ai` → `api.neodrop.ai`; `localhost:4001` → `localhost:3001`; otherwise same as the web origin). If your API host differs, pass `--api <url>` or set `NEODROP_API`.

## Revoke & rotate

- Local logout: `npx neodrop-cli logout` (remote revoke + clears the local credential).
- Web revoke: [neodrop.ai/settings/cli-tokens](https://neodrop.ai/settings/cli-tokens).
- See which PATs you've issued: `npx neodrop-cli tokens list`.
- Revoke a PAT elsewhere: `npx neodrop-cli tokens revoke <id>`.
- PATs last 90 days by default; just `login` again when one expires.
