// Unified output: stdout = JSON (an AI can JSON.parse directly), stderr = logs/notices.
//
// Single-line JSON by default; --pretty switches to 2-space indented JSON — both
// are valid JSON, so an AI can parse either without needing the flag.

let pretty = false;

export function setPretty(value) {
  pretty = Boolean(value);
}

export function emit(data) {
  if (data === null || data === undefined) return;
  process.stdout.write(`${JSON.stringify(data, null, pretty ? 2 : undefined)}\n`);
}

export function note(msg, end = "\n") {
  process.stderr.write(msg + end);
}
