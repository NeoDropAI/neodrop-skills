// Neodrop deploys the web origin (product domain) and api origin (backend
// domain) decoupled.
//
// Production: web = https://neodrop.ai, api = https://api.neodrop.ai
// Local dev:  web = http://localhost:4001, api = http://localhost:3001
//
// The CLI lets the user pass --api explicitly; when omitted it is inferred
// heuristically from the web origin. For self-hosted users the default assumes
// the backend is reverse-proxied on the same domain as web at /trpc/*, which can
// be overridden with --api when needed.

export function inferApiOrigin(webOrigin) {
  let parsed;
  try {
    parsed = new URL(webOrigin);
  } catch {
    return webOrigin.replace(/\/+$/, "");
  }
  const host = (parsed.hostname || "").toLowerCase();
  const port = parsed.port;
  const scheme = parsed.protocol.replace(/:$/, "");

  // Production neodrop.ai → api.neodrop.ai
  if (host === "neodrop.ai") {
    return `${scheme}://api.neodrop.ai`;
  }

  // Local dev: localhost:4001 / 127.0.0.1:4001 → same host on 3001
  if ((host === "localhost" || host === "127.0.0.1") && port === "4001") {
    return `${scheme}://${host}:3001`;
  }

  // Otherwise (self-host reverse proxy, etc.): default to the same domain as
  // web, assuming /trpc/* is proxied to the backend.
  return webOrigin.replace(/\/+$/, "");
}
