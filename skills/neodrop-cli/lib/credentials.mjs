// Local credentials (~/.neodrop/credentials.json, chmod 0600).
//
// Only a single active token is supported — switching server / account goes
// through logout → login.
//
// Credential schema:
//   webOrigin  string  product origin (neodrop.ai; local dev 4001)
//   apiOrigin  string  API origin (api.neodrop.ai; local dev 3001) — split from
//                      web because they deploy on different domains
//   token      string  PAT in plaintext, local machine only; mode 0600
//   tokenId    string  used for logout / remote revocation
//   name       string  client name shown on /settings/cli-tokens
//   expiresAt  string  ISO 8601, defaults to 90 days
//   createdAt  string  ISO 8601

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const FILE_DIR = join(homedir(), ".neodrop");
const FILE_PATH = join(FILE_DIR, "credentials.json");

export function credentialsPath() {
  return FILE_PATH;
}

export function readCredentials() {
  if (!existsSync(FILE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(FILE_PATH, "utf-8"));
  } catch (err) {
    throw new Error(`Failed to parse ${FILE_PATH}: ${err.message}`);
  }
}

// Atomic write: write temp file → chmod 0600 → rename. The chmod completes
// before the rename, guaranteeing the final file has 0600 permissions the moment
// it appears — there is no window where another process could read it as
// world-readable.
export function writeCredentials(creds) {
  mkdirSync(FILE_DIR, { recursive: true });
  const tmp = `${FILE_PATH}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(creds, null, 2)}\n`, { encoding: "utf-8", mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, FILE_PATH);
}

export function clearCredentials() {
  try {
    unlinkSync(FILE_PATH);
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}

export function requireCredentials() {
  const creds = readCredentials();
  if (creds === null) {
    throw new Error("Not logged in. Run: npx neodrop-cli login");
  }
  return creds;
}
