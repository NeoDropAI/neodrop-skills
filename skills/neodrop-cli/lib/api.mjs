// Minimal tRPC 11 HTTP client (matches the backend's superjson transformer).
//
// URL shapes:
//   - query:    GET  /trpc/<proc>?input=<urlencoded {json:<input>}>
//   - mutation: POST /trpc/<proc>  body = {json:<input>}
//
// Response shapes (superjson):
//   - success: { result: { data: { json: <T>, meta?: {...} } } }
//   - failure: { error: { json: { message, code, data: {...} } } }
//
// The superjson `meta` field on inputs/outputs restores non-JSON types such as
// Date, which the CLI doesn't need (credential expiresAt is a plain ISO string),
// so we only read the `json` field here.
//
// Zero runtime dependencies: uses Node's native fetch (Node 18+), no third-party
// HTTP library.

export class ApiError extends Error {
  // tRPC business error (HTTP >= 400 or a non-empty body.error).
  // code comes from tRPC's error codes ('UNAUTHORIZED' / 'NOT_FOUND' /
  // 'BAD_REQUEST', etc.), so the CLI can branch on it (e.g. prompt to re-login
  // on 401).
  constructor(message, code = "", httpStatus = 0) {
    super(code ? `[${code}] ${message}` : message);
    this.name = "ApiError";
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function buildUrl(apiOrigin, proc, inputValue) {
  const base = `${apiOrigin.replace(/\/+$/, "")}/trpc/${proc}`;
  if (inputValue === undefined) return base;
  // superjson input wrapper: { json: <value> }
  const qs = new URLSearchParams({ input: JSON.stringify({ json: inputValue }) });
  return `${base}?${qs.toString()}`;
}

// Cloudflare WAF rejects the default UA as a bot (HTTP 403 + error code 1010).
// Present an honest client identity — telling CF/origin "this is neodrop-cli"
// makes debugging and allowlisting easier. Setting the UA is not about
// disguise, it's about passing the basic client fingerprint check.
const USER_AGENT = "neodrop-cli/1.0 (+https://github.com/NeoDropAI/neodrop-skills)";

async function doRequest({ method, url, token, body }) {
  const headers = {
    "content-type": "application/json",
    "user-agent": USER_AGENT,
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;

  // One transparent retry — production Cloudflare/upstream occasionally has
  // TLS-layer hiccups ("EOF occurred in violation of protocol", etc.). Retry is
  // applied to mutations too: a tRPC mutation is idempotent-enough to retry when
  // the network flaked before the business layer committed (worst case, one
  // extra PAT/subscription is issued — an acceptable cost). Note that fetch does
  // not throw on 4xx/5xx — that's handled by handleResponse; here we only retry
  // true network-layer failures.
  let lastErr;
  for (let i = 0; i < 2; i++) {
    try {
      return await fetch(url, { method, headers, body, signal: AbortSignal.timeout(30000) });
    } catch (err) {
      lastErr = err;
    }
  }
  // Node fetch hides the real reason in err.cause (e.g. ECONNREFUSED /
  // ENOTFOUND / self-signed certificate); err.message is usually just the
  // generic "fetch failed".
  const cause = lastErr?.cause;
  const detail = cause?.code || cause?.message || lastErr?.message || String(lastErr);
  throw new Error(`Connection failed: ${detail}`);
}

async function handleResponse(res) {
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
  }

  if (res.status >= 400 || (body && body.error)) {
    const err = (body && body.error) || {};
    const errJson = err.json || {};
    const msg = errJson.message || err.message || `HTTP ${res.status}`;
    const code = (errJson.data && errJson.data.code) || err.code || "";
    throw new ApiError(msg, code, res.status);
  }

  // Unwrap the superjson response
  return body.result.data.json;
}

export async function trpcQuery(opts, proc, inputValue) {
  const url = buildUrl(opts.apiOrigin, proc, inputValue);
  const res = await doRequest({ method: "GET", url, token: opts.token });
  return handleResponse(res);
}

export async function trpcMutation(opts, proc, inputValue) {
  const url = buildUrl(opts.apiOrigin, proc); // mutations don't use query input
  // A mutation always sends a JSON body: {"json": null} when input is undefined
  const body = JSON.stringify({ json: inputValue === undefined ? null : inputValue });
  const res = await doRequest({ method: "POST", url, token: opts.token, body });
  return handleResponse(res);
}
