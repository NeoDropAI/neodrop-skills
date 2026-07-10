#!/usr/bin/env node
// neodrop CLI entry point. Shared by AI agents and humans — talks to the Neodrop
// tRPC HTTP API directly (Bearer PAT auth), not over MCP.
//
// Invocation:
//   npx neodrop-cli <command> [args...]
//   or, when installed globally: neodrop <command> [args...]
//
// Output:
//   stdout = JSON (parse it directly); --pretty switches to indented JSON for humans
//   stderr = logs / progress / error descriptions
// Exit codes: 0 success / 1 business error / 2 usage error

import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { ApiError, trpcMutation, trpcQuery } from "../lib/api.mjs";
import { resolveChatSession, sendAndAwaitReply, slimMessage } from "../lib/chat.mjs";
import {
  clearCredentials,
  credentialsPath,
  readCredentials,
  requireCredentials,
  writeCredentials,
} from "../lib/credentials.mjs";
import { defaultSkillDest, installSkill } from "../lib/install-skill.mjs";
import { inferApiOrigin } from "../lib/origins.mjs";
import { emit, note, setPretty } from "../lib/output.mjs";
import { channelUrl, postUrl, userUrl } from "../lib/web-urls.mjs";

const DEFAULT_SERVER = process.env.NEODROP_SERVER || "https://neodrop.ai";
const ENV_API_OVERRIDE = process.env.NEODROP_API;

// Usage error → exit code 2 (distinct from business error 1).
class UsageError extends Error {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Client identifier — shown on the consent page and settings/cli-tokens so the user can recognize it.
function detectClientName() {
  const host = hostname() || "host";
  const term = process.env.TERM_PROGRAM || "";
  if (process.env.CLAUDECODE) return `Claude Code @ ${host}`;
  if (process.env.CURSOR_TRACE_ID) return `Cursor @ ${host}`;
  if (term === "vscode") return `VS Code @ ${host}`;
  if (term === "WarpTerminal") return `Warp @ ${host}`;
  return `neodrop-cli @ ${host}`;
}

function authedCtx() {
  const creds = requireCredentials();
  return { apiOrigin: creds.apiOrigin, token: creds.token, creds };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

// One of `--json '<input>'` / `--stdin` (mutually exclusive, checked by the caller); returns undefined if neither is given.
async function loadInput(values) {
  if (values.json) {
    try {
      return JSON.parse(values.json);
    } catch (err) {
      throw new UsageError(`--json failed to parse: ${err.message}`);
    }
  }
  if (values.stdin) {
    return JSON.parse(await readStdin());
  }
  return undefined;
}

// parseArgs wrapper: unknown flags / missing values become a UsageError (exit code 2).
function parse(argv, options) {
  try {
    return parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

function toLimit(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new UsageError(`--limit must be a number, got "${value}"`);
  return n;
}

function requirePositional(positionals, index, hint) {
  const value = positionals[index];
  if (value === undefined) throw new UsageError(hint);
  return value;
}

// ---- meta commands ----------------------------------------------------

// Unified login: session-polling flow.
//   1. startSession returns sessionId + pollSecret + verification URL
//      (pollSecret is held only in this process — the sole credential for polling the token, never in the URL)
//   2. print the URL for the user to open in a browser (nothing is auto-launched, no local server, no callback)
//   3. poll pollSession with the pollSecret until APPROVED / DENIED / EXPIRED
//   4. on success, write the token to ~/.neodrop/credentials.json
async function cmdLogin(argv) {
  const { values } = parse(argv, {
    server: { type: "string" },
    api: { type: "string" },
    name: { type: "string" },
  });

  const webOrigin = (values.server || DEFAULT_SERVER).replace(/\/+$/, "");
  // explicit --api > NEODROP_API env > heuristic inference
  const apiOrigin = values.api || ENV_API_OVERRIDE || inferApiOrigin(webOrigin);
  const clientName = values.name || detectClientName();

  note(`web   = ${webOrigin}`);
  note(`api   = ${apiOrigin}`);

  // 1. start a session
  const session = await trpcMutation({ apiOrigin, token: null }, "cliToken.startSession", {
    clientName,
    webOrigin,
  });
  const sessionId = session.sessionId;
  // pollSecret is a private claim credential the backend hands only to this CLI process; it is never in the
  // verification URL. You must send it back when polling to claim the token. The URL carries only the sessionId,
  // so a leaked screenshot / forward cannot claim the token.
  const pollSecret = session.pollSecret;
  const verificationUrl = session.verificationUrl;
  const pollInterval = Math.max(1, Number(session.pollIntervalSeconds || 2));

  note("");
  note("👉 Open the URL below in any browser (phone / laptop / this machine) to authorize:");
  note("");
  // The URL is printed flush-left on its own line (no indent): it contains a 256-bit ?session= string, always
  // exceeds 80 columns and the terminal wraps it. Flush-left on its own line makes it easiest to triple-click /
  // drag-select the whole line and copy the full URL in one go.
  note(verificationUrl);
  note("");
  note("   (Long URLs wrap — when copying, select all the way through the trailing ?session=...)");
  note(`   Client name "${clientName}" (confirm it on the consent page — it's this CLI launch)`);
  note("   The link is valid for 10 minutes. After approving, return to this terminal — the CLI detects it automatically.");
  note("");

  // 2. poll
  const deadline = Date.now() + 10 * 60 * 1000; // aligned with the backend session lifetime
  let waitedDots = 0;
  let token = null;
  let tokenId = null;
  let expiresAt = null;
  while (Date.now() < deadline) {
    await sleep(pollInterval * 1000);
    let res;
    try {
      res = await trpcQuery({ apiOrigin, token: null }, "cliToken.pollSession", {
        sessionId,
        pollSecret,
      });
    } catch (err) {
      // NOT_FOUND usually means the backend already cleaned up the session; rethrow any other error too
      throw new Error(`Failed to poll for authorization: ${err.message}`);
    }

    const status = res.status;
    if (status === "APPROVED") {
      if (res.alreadyClaimed) {
        throw new Error(
          "The authorization token was already claimed (rare — normally this CLI claims it itself). Please run `npx neodrop-cli login` again.",
        );
      }
      token = res.token;
      tokenId = res.tokenId;
      const ea = res.tokenExpiresAt;
      expiresAt = typeof ea === "string" ? ea : ea ? String(ea) : null;
      if (!token) throw new Error("Authorization returned APPROVED but no token; please run `npx neodrop-cli login` again");
      break;
    }
    if (status === "DENIED") {
      throw new Error("Authorization was denied by the user. If needed, run `npx neodrop-cli login` again and check the client name.");
    }
    if (status === "EXPIRED") {
      throw new Error("The authorization link expired (not approved within 10 minutes). Please run `npx neodrop-cli login` again.");
    }
    // still PENDING — print a progress dot (one dot every 5 polls, to avoid spamming)
    waitedDots += 1;
    if (waitedDots % 5 === 0) note(".", "");
  }

  if (!token) throw new Error("Timed out waiting for authorization. Please run `npx neodrop-cli login` again.");

  note("");

  // 3. write the credential
  writeCredentials({
    webOrigin,
    apiOrigin,
    token,
    tokenId: tokenId || "",
    name: clientName,
    expiresAt: expiresAt || "",
    createdAt: new Date().toISOString(),
  });

  // 4. verify + output
  const me = await trpcQuery({ apiOrigin, token }, "user.getMe");
  note(`✅ Logged in: ${me.email || me.id || "<unknown>"}`);
  note(`   credentials = ${credentialsPath()}`);
  emit({
    ok: true,
    webOrigin,
    apiOrigin,
    user: me,
    tokenId,
    tokenName: clientName,
    expiresAt,
  });
}

async function cmdLogout() {
  const creds = readCredentials();
  if (creds === null) {
    note("Not logged in — nothing to log out of.");
    emit({ ok: true, alreadyLoggedOut: true });
    return;
  }
  let revoked = false;
  try {
    await trpcMutation({ apiOrigin: creds.apiOrigin, token: creds.token }, "cliToken.revoke", {
      id: creds.tokenId,
    });
    revoked = true;
    note(`✅ Revoked ${creds.tokenId}`);
  } catch (err) {
    note(`⚠ Revocation failed (clearing local credential anyway): ${err.message}`);
  }
  clearCredentials();
  emit({ ok: true, revoked });
}

async function cmdWhoami() {
  const { apiOrigin, token, creds } = authedCtx();
  const me = await trpcQuery({ apiOrigin, token }, "user.getMe");
  emit({
    webOrigin: creds.webOrigin,
    apiOrigin,
    tokenName: creds.name,
    tokenId: creds.tokenId,
    expiresAt: creds.expiresAt,
    user: me,
  });
}

async function cmdMe() {
  const { apiOrigin, token, creds } = authedCtx();
  const me = await trpcQuery({ apiOrigin, token }, "user.getMe");
  emit(me);
  if (me && typeof me === "object" && me.id) {
    note(`🔗 ${userUrl(creds.webOrigin, me.id)}`);
  }
}

async function cmdTokensList() {
  const { apiOrigin, token } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "cliToken.list"));
}

async function cmdTokensRevoke(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop tokens revoke <id>");
  const { apiOrigin, token, creds } = authedCtx();
  const r = await trpcMutation({ apiOrigin, token }, "cliToken.revoke", { id });
  if (id === creds.tokenId) {
    clearCredentials();
    note("(That was this machine's current token — the local credential has been cleared. You'll need to run neodrop login again.)");
  }
  emit(r);
}

// ---- channel commands -------------------------------------------------

async function cmdChannelsList(argv) {
  const { values } = parse(argv, {
    mine: { type: "boolean" },
    limit: { type: "string" },
    cursor: { type: "string" },
    locale: { type: "string", default: "en" }, // default en, matching the web default locale
  });
  const { apiOrigin, token } = authedCtx();
  if (values.mine) {
    emit(await trpcQuery({ apiOrigin, token }, "channel.getMyChannels"));
    return;
  }
  const payload = { limit: toLimit(values.limit) ?? 20, locale: values.locale };
  if (values.cursor) payload.cursor = values.cursor;
  emit(await trpcQuery({ apiOrigin, token }, "channel.list", payload));
}

async function cmdChannelsGet(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop channels get <channelId>");
  const { apiOrigin, token, creds } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "channel.getById", { id }));
  note(`🔗 ${channelUrl(creds.webOrigin, id)}`);
}

// Creating a channel = launching a creation Agent task (agentTask.create), the same pipeline as the web
// create wizard. A bare channel.create only leaves an empty shell stuck forever in DRAFT with no runnable
// config (issue #7), so the sugar command no longer exposes it; if you truly need a shell, use
// `api channel.create --mutation`.
const CREATE_CARRIERS = ["Article", "ImagePost", "Podcast", "Music", "Video"];

async function cmdChannelsCreate(argv) {
  const { values } = parse(argv, {
    name: { type: "string" },
    prompt: { type: "string" },
    description: { type: "string" },
    locale: { type: "string" },
    carrier: { type: "string" },
    wait: { type: "boolean" },
    json: { type: "string" },
    stdin: { type: "boolean" },
  });
  if (values.json && values.stdin) {
    throw new UsageError("--json and --stdin are mutually exclusive, pass only one");
  }
  if (values.carrier && !CREATE_CARRIERS.includes(values.carrier)) {
    throw new UsageError(`--carrier must be one of ${CREATE_CARRIERS.join(" | ")}`);
  }
  const ctx = authedCtx();
  // --json / --stdin passes the raw agentTask.create input through (advanced use; field contract in references/commands.md)
  let input = await loadInput(values);
  if (input === undefined) {
    if (!values.name) {
      throw new UsageError(
        'Usage: neodrop channels create --name <channel name> [--prompt "<creation brief>"] [--description <one-line summary>] [--locale en] [--carrier Article|ImagePost|Podcast|Music|Video] [--wait]\n' +
          "Creation is asynchronous (an Agent generates the channel config, usually a few minutes): by default it returns the task immediately — poll with channels create-status <taskId>; --wait blocks until creation finishes.",
      );
    }
    input = { channelName: values.name };
    if (values.description) input.channelDescription = values.description;
    if (values.prompt) input.description = values.prompt;
    if (values.locale) input.locale = values.locale;
    if (values.carrier) input.contentCarrier = values.carrier;
  }
  const task = await trpcMutation(ctx, "agentTask.create", input);
  note(`✅ Creation task started: task=${task.id} channel=${task.channelId ?? "<pending>"}`);
  if (task.channelId) note(`🔗 ${channelUrl(ctx.creds.webOrigin, task.channelId)}`);

  if (!values.wait) {
    note("   The channel config is generated asynchronously by an Agent (usually a few minutes). Poll: neodrop channels create-status " + task.id);
    emit(task);
    return;
  }

  // --wait: poll to a terminal state (COMPLETED / FAILED), or stop at PAUSED (credits exhausted, awaiting top-up).
  const deadline = Date.now() + 20 * 60 * 1000;
  let current = task;
  while (Date.now() < deadline) {
    if (current.status === "COMPLETED" || current.status === "FAILED") break;
    if (current.status === "PAUSED") {
      note("⚠ Task paused (usually insufficient credits). It resumes automatically after a top-up; check later with channels create-status.");
      break;
    }
    await sleep(15 * 1000);
    current = await trpcQuery(ctx, "agentTask.getById", { id: task.id });
    note(`… status=${current.status}`);
  }
  if (current.status === "FAILED") process.exitCode = 1;
  emit(current);
}

// Query a creation task's status (agentTask.getById). status: PENDING/RUNNING → in progress;
// COMPLETED → done; FAILED → failed; PAUSED → paused (insufficient credits, resumes after top-up).
async function cmdChannelsCreateStatus(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop channels create-status <taskId>");
  const { apiOrigin, token } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "agentTask.getById", { id }));
}

// Manually trigger a channel to produce one run of content (channel.triggerRun). The channel must have
// finished creation (or be DRAFT but already have a runnable config — the backend activates it automatically).
async function cmdChannelsRun(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop channels run <channelId>");
  const { apiOrigin, token } = authedCtx();
  emit(await trpcMutation({ apiOrigin, token }, "channel.triggerRun", { channelId: id }));
}

async function cmdChannelsSubscribe(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop channels subscribe <channelId>");
  const { apiOrigin, token } = authedCtx();
  emit(await trpcMutation({ apiOrigin, token }, "channel.subscribe", { channelId: id }));
}

async function cmdChannelsUnsubscribe(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop channels unsubscribe <channelId>");
  const { apiOrigin, token } = authedCtx();
  emit(await trpcMutation({ apiOrigin, token }, "channel.unsubscribe", { channelId: id }));
}

async function cmdChannelsSearch(argv) {
  const { values, positionals } = parse(argv, {
    limit: { type: "string" },
    locale: { type: "string" },
    strict: { type: "boolean" },
  });
  const query = requirePositional(positionals, 0, 'Usage: neodrop channels search "<query>"');
  const { apiOrigin, token } = authedCtx();
  const payload = { query };
  const limit = toLimit(values.limit);
  if (limit !== undefined) payload.limit = limit;
  if (values.locale) payload.locale = values.locale;
  if (values.strict) payload.strictLocale = true;
  emit(await trpcQuery({ apiOrigin, token }, "channel.searchPublic", payload));
}

async function cmdChannelsCategories() {
  const { apiOrigin, token } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "channel.getCategories"));
}

async function cmdChannelsByCategory(argv) {
  const { values, positionals } = parse(argv, {
    limit: { type: "string" },
    cursor: { type: "string" },
    locale: { type: "string" },
    sort: { type: "string" },
  });
  const slug = requirePositional(positionals, 0, "Usage: neodrop channels by-category <slug>");
  if (values.sort && values.sort !== "latest" && values.sort !== "popular") {
    throw new UsageError("--sort must be latest or popular");
  }
  const { apiOrigin, token } = authedCtx();
  const payload = { categorySlug: slug };
  const limit = toLimit(values.limit);
  if (limit !== undefined) payload.limit = limit;
  if (values.cursor) payload.cursor = values.cursor;
  if (values.locale) payload.locale = values.locale;
  if (values.sort) payload.sortBy = values.sort;
  emit(await trpcQuery({ apiOrigin, token }, "channel.listByCategory", payload));
}

// ---- post commands ----------------------------------------------------
// The user-facing term is unified as post; the tRPC procedure names are still the backend contract `grain.*`, unchanged.

async function cmdPostsList(argv) {
  const { values } = parse(argv, {
    channel: { type: "string" },
    subscribed: { type: "boolean" },
    limit: { type: "string" },
    cursor: { type: "string" },
    locale: { type: "string" },
  });
  const { apiOrigin, token } = authedCtx();
  const limit = toLimit(values.limit) ?? 20;
  if (values.subscribed) {
    const payload = { limit };
    if (values.cursor) payload.cursor = values.cursor;
    if (values.channel) payload.channelId = values.channel;
    emit(await trpcQuery({ apiOrigin, token }, "grain.listSubscribed", payload));
    return;
  }
  if (values.channel) {
    const payload = { channelId: values.channel, limit };
    if (values.cursor) payload.cursor = values.cursor;
    emit(await trpcQuery({ apiOrigin, token }, "grain.list", payload));
    return;
  }
  // otherwise listRecent (public feed)
  const payload = { limit };
  if (values.cursor) payload.cursor = values.cursor;
  if (values.locale) payload.locale = values.locale;
  emit(await trpcQuery({ apiOrigin, token }, "grain.listRecent", payload));
}

async function cmdPostsGet(argv) {
  const { positionals } = parse(argv, {});
  const id = requirePositional(positionals, 0, "Usage: neodrop posts get <postId>");
  const { apiOrigin, token, creds } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "grain.getById", { id }));
  note(`🔗 ${postUrl(creds.webOrigin, id)}`);
}

async function cmdPostsSearch(argv) {
  const { values, positionals } = parse(argv, {
    limit: { type: "string" },
    locale: { type: "string" },
    strict: { type: "boolean" },
  });
  const query = requirePositional(positionals, 0, 'Usage: neodrop posts search "<query>"');
  const { apiOrigin, token } = authedCtx();
  const payload = { query };
  const limit = toLimit(values.limit);
  if (limit !== undefined) payload.limit = limit;
  if (values.locale) payload.locale = values.locale;
  if (values.strict) payload.strictLocale = true;
  emit(await trpcQuery({ apiOrigin, token }, "grain.searchPublic", payload));
}

async function cmdFeed(argv) {
  const { values } = parse(argv, {
    limit: { type: "string" },
    cursor: { type: "string" },
  });
  const { apiOrigin, token } = authedCtx();
  const payload = { limit: toLimit(values.limit) ?? 20 };
  if (values.cursor) payload.cursor = values.cursor;
  emit(await trpcQuery({ apiOrigin, token }, "grain.listSubscribed", payload));
}

// ---- chat commands ----------------------------------------------------

async function cmdChatSend(argv) {
  const { values, positionals } = parse(argv, {
    session: { type: "string" },
    channel: { type: "string" },
    locale: { type: "string", default: "en" },
    timeout: { type: "string" },
    "poll-interval": { type: "string" },
  });
  const text = requirePositional(
    positionals,
    0,
    'Usage: neodrop chat "<message>" [--session <id> | --channel <id>] [--locale en] [--timeout <seconds>]\n' +
      "       neodrop chat history --session <id>",
  );
  if (values.session && values.channel) {
    throw new UsageError("--session and --channel are mutually exclusive: --session continues an existing session, --channel gets that channel's assistant session");
  }
  const timeoutSec = values.timeout === undefined ? 600 : Number(values.timeout);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) {
    throw new UsageError(`--timeout must be a positive number of seconds, got "${values.timeout}"`);
  }
  const pollSec = values["poll-interval"] === undefined ? 2 : Number(values["poll-interval"]);
  if (!Number.isFinite(pollSec) || pollSec <= 0) {
    throw new UsageError(`--poll-interval must be a positive number of seconds, got "${values["poll-interval"]}"`);
  }

  const { apiOrigin, token } = authedCtx();
  let sessionId = values.session;
  if (!sessionId) {
    sessionId = await resolveChatSession({ apiOrigin, token, channelId: values.channel });
    note(`session ${sessionId} (continue with: neodrop chat "…" --session ${sessionId})`);
  }

  const result = await sendAndAwaitReply({
    apiOrigin,
    token,
    sessionId,
    text,
    locale: values.locale,
    timeoutMs: timeoutSec * 1000,
    pollIntervalMs: pollSec * 1000,
  });
  if (!result.reply) {
    note("⚠ No assistant text reply this turn (generation may have failed or been cancelled); newMessages holds every message added this turn.");
  }
  emit(result);
}

async function cmdChatHistory(argv) {
  const { values } = parse(argv, {
    session: { type: "string" },
  });
  if (!values.session) {
    throw new UsageError("Usage: neodrop chat history --session <id>");
  }
  const { apiOrigin, token } = authedCtx();
  const messages = await trpcQuery({ apiOrigin, token }, "session.getMessages", {
    sessionId: values.session,
  });
  emit(messages.map(slimMessage));
}

async function cmdChatSessions() {
  const { apiOrigin, token } = authedCtx();
  emit(await trpcQuery({ apiOrigin, token }, "session.list"));
}

async function cmdChat(argv) {
  const sub = argv[0];
  if (sub === "history") return cmdChatHistory(argv.slice(1));
  if (sub === "sessions") return cmdChatSessions();
  return cmdChatSend(argv);
}

// ---- escape hatch -----------------------------------------------------

async function cmdApi(argv) {
  const { values, positionals } = parse(argv, {
    json: { type: "string" },
    stdin: { type: "boolean" },
    mutation: { type: "boolean" },
  });
  if (values.json && values.stdin) {
    throw new UsageError("--json and --stdin are mutually exclusive, pass only one");
  }
  const procedure = requirePositional(positionals, 0, "Usage: neodrop api <procedure> [--json '...' | --stdin] [--mutation]");
  const { apiOrigin, token } = authedCtx();
  const input = await loadInput(values);
  if (values.mutation) {
    emit(await trpcMutation({ apiOrigin, token }, procedure, input));
  } else {
    emit(await trpcQuery({ apiOrigin, token }, procedure, input));
  }
}

// ---- skill install ----------------------------------------------------

async function cmdInstallSkill(argv) {
  const { values } = parse(argv, {
    dest: { type: "string" },
  });
  const { target, copied } = installSkill({ dest: values.dest });
  note(`✅ Installed skill to ${target}`);
  note(`   Copied: ${copied.join(", ")}`);
  note("   After restarting Claude Code (or opening a new session), the AI will route Neodrop-related questions to this skill automatically.");
  emit({ ok: true, target, copied });
}

// ---- help -------------------------------------------------------------

const HELP = `neodrop — Neodrop CLI (shared by AI agents and humans, stdout = JSON)

Usage:
  npx neodrop-cli <command> [args...]

Meta:
  login [--server <url>] [--api <url>] [--name <name>]  Authorize and write a PAT to ~/.neodrop/credentials.json
  logout                                               Revoke the PAT + delete the local credential
  whoami                                               Current token + user info
  me                                                   Current user info (user.getMe)
  tokens list                                          List every PAT
  tokens revoke <id>                                   Revoke a specific PAT
  install-skill [--dest <dir>]                         Install SKILL.md + references into the agent's skill dir
                                                       (default ${defaultSkillDest()})

Channels:
  channels list [--mine] [--limit N] [--cursor C] [--locale L]
  channels get <channelId>
  channels create --name <X> [--prompt "<brief>"] [--description <Y>] [--locale L]
                  [--carrier Article|ImagePost|Podcast|Music|Video] [--wait]
                                                       Launch the creation Agent (async, a few minutes)
  channels create-status <taskId>                      Check a creation task's progress / result
  channels run <channelId>                             Manually trigger one run of content
  channels subscribe <channelId>
  channels unsubscribe <channelId>
  channels search "<query>" [--limit N] [--locale L] [--strict]
  channels categories
  channels by-category <slug> [--limit N] [--cursor C] [--locale L] [--sort latest|popular]

Content (Post):
  posts list [--subscribed | --channel <id>] [--limit N] [--cursor C] [--locale L]
  posts get <postId>
  posts search "<query>" [--limit N] [--locale L] [--strict]
  feed [--limit N] [--cursor C]                        = posts list --subscribed

Chat:
  chat "<message>" [--session <id> | --channel <id>] [--locale L] [--timeout <seconds>]
                                                       Send a message to the AI assistant and wait for the full
                                                       reply (defaults to a new global-assistant session;
                                                       --session continues a session; --channel talks to that
                                                       channel's assistant)
  chat history --session <id>                          View a session's full message list
  chat sessions                                        List my sessions

Escape hatch:
  api <procedure> [--json '...' | --stdin] [--mutation]

Global:
  --pretty                                             Indented JSON output (still valid JSON)

Environment variables: NEODROP_SERVER (web origin) / NEODROP_API (api origin)
See SKILL.md and references/ for more.`;

// ---- routing ----------------------------------------------------------

const TOKENS_SUB = {
  list: cmdTokensList,
  revoke: cmdTokensRevoke,
};
const CHANNELS_SUB = {
  list: cmdChannelsList,
  get: cmdChannelsGet,
  create: cmdChannelsCreate,
  "create-status": cmdChannelsCreateStatus,
  run: cmdChannelsRun,
  subscribe: cmdChannelsSubscribe,
  unsubscribe: cmdChannelsUnsubscribe,
  search: cmdChannelsSearch,
  categories: cmdChannelsCategories,
  "by-category": cmdChannelsByCategory,
};
const POSTS_SUB = {
  list: cmdPostsList,
  get: cmdPostsGet,
  search: cmdPostsSearch,
};

async function dispatchGroup(name, table, argv) {
  const sub = argv[0];
  if (!sub || sub === "--help" || sub === "-h") {
    throw new UsageError(`Usage: neodrop ${name} <${Object.keys(table).join(" | ")}>`);
  }
  const handler = table[sub];
  if (!handler) {
    throw new UsageError(`Unknown subcommand ${name} ${sub} (available: ${Object.keys(table).join(" / ")})`);
  }
  await handler(argv.slice(1));
}

async function dispatch(rawArgs) {
  // The global --pretty can appear anywhere: strip it out first, hand the rest to each command's parser.
  const pretty = rawArgs.includes("--pretty");
  setPretty(pretty);
  const args = rawArgs.filter((a) => a !== "--pretty");

  const cmd = args[0];
  if (!cmd || cmd === "--help" || cmd === "-h" || cmd === "help") {
    note(HELP);
    return;
  }

  const rest = args.slice(1);
  switch (cmd) {
    case "login":
      return cmdLogin(rest);
    case "logout":
      return cmdLogout();
    case "whoami":
      return cmdWhoami();
    case "me":
      return cmdMe();
    case "tokens":
      return dispatchGroup("tokens", TOKENS_SUB, rest);
    case "channels":
      return dispatchGroup("channels", CHANNELS_SUB, rest);
    case "grains": // backward compatible: old command name, renamed to posts
    case "posts":
      return dispatchGroup("posts", POSTS_SUB, rest);
    case "feed":
      return cmdFeed(rest);
    case "chat":
      return cmdChat(rest);
    case "api":
      return cmdApi(rest);
    case "install-skill":
      return cmdInstallSkill(rest);
    default:
      throw new UsageError(`Unknown command "${cmd}". Run neodrop --help to see every command.`);
  }
}

async function main() {
  try {
    await dispatch(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      note(`✗ ${err.message}`);
      process.exitCode = 2;
      return;
    }
    // ApiError (tRPC business error) and other runtime errors share exit code 1
    note(`✗ ${err.message}`);
    process.exitCode = 1;
  }
}

await main();
