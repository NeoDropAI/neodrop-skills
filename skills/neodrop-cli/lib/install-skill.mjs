// Copy SKILL.md + references/ into the agent's skill directory so that a single
// `npx neodrop-cli` command installs both the CLI and the skill description.
//
// npm/npx only distributes "executables"; an agent skill for Claude Code and the
// like is the SKILL.md + references/ file set, which is only routed once it lands
// in the agent's skill directory. The two distribution channels are normally
// separate, and this command merges them into one step.
//
// The default target is ~/.claude/skills/neodrop-cli/ (the Claude Code
// convention); --dest can point at another agent's skill directory. The
// directory name is fixed to neodrop-cli, matching the name in SKILL.md's
// frontmatter.

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultSkillDest() {
  return join(homedir(), ".claude", "skills", "neodrop-cli");
}

export function installSkill({ dest } = {}) {
  // Package root = the parent of this file's lib/ dir (bin/, lib/, and SKILL.md are siblings)
  const here = dirname(fileURLToPath(import.meta.url)); // .../lib
  const pkgRoot = dirname(here);
  const target = dest || defaultSkillDest();

  const skillSrc = join(pkgRoot, "SKILL.md");
  if (!existsSync(skillSrc)) {
    throw new Error(`SKILL.md not found (expected at ${skillSrc}); the npm package may not have included SKILL.md in its files allowlist`);
  }

  mkdirSync(target, { recursive: true });
  cpSync(skillSrc, join(target, "SKILL.md"));

  const refSrc = join(pkgRoot, "references");
  const copied = ["SKILL.md"];
  if (existsSync(refSrc)) {
    cpSync(refSrc, join(target, "references"), { recursive: true });
    copied.push("references/");
  }

  return { target, copied };
}
