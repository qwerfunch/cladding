// F-90d054 — project-local host AI instruction writers.
//
// Writes:
//   • <project>/AGENTS.md       — cross-tool (Codex/Cursor/Continue/Copilot/Aider)
//   • <project>/CLAUDE.md       — Claude Code memory (idempotent append)
//
// Does NOT write `.claude-plugin/plugin.json`, `.mcp.json`, or
// `.codex/config.toml` to the project — those live globally under the user's
// home directory and are populated by the npm postinstall hook (and the
// `clad init` fallback retry for users who ran with `--ignore-scripts`).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENTS_MD_TEMPLATE = `# AGENTS.md

This project is managed by **cladding** — the Spec-Anchored Agent Harness.

## Single Source of Truth

- \`spec.yaml\` is the authoritative spec (Tier A). Code must conform.
- \`spec/features/<slug>-<hash>.yaml\` holds individual feature shards.
  Never hand-author \`F-NNN\` filenames — use \`clad_create_feature\` MCP
  tool.
- \`docs/project-context.md\` is the Tier B design SSoT.
- Run \`clad check --strict\` to verify spec ↔ code drift across 27
  detectors.

## Persona separation (anti-self-cert)

The agent that writes a unit of work must not be the agent that signs off
on it. librarian writes spec, reviewer audits, specialists implement.

## More

See \`CLAUDE.md\` for Claude Code-specific memory, and
\`spec/architecture.yaml\` for the layer / \`forbidden_imports\` invariants
enforced by \`ARCHITECTURE_FROM_SPEC\`.
`;

export const CLAUDE_MD_SECTION_MARKER = '## cladding';

export const CLAUDE_MD_SECTION = `## cladding

This project is managed by **cladding** (Spec-Anchored Agent Harness).

**Spec is SSoT** — \`spec.yaml\` is authoritative. Any code change must
satisfy the relevant \`features[]\` and \`acceptance_criteria\`. Run
\`clad check --strict\` before commit.

**Persona separation** — librarian writes spec, reviewer audits,
specialists implement. The agent that authors must not sign off on its
own work (anti-self-cert invariant).

**Hash-based IDs** — Use \`clad_create_feature\` MCP tool. Never
hand-author \`F-NNN\` filenames; the multi-developer-safe model is in
\`docs/spec-ids-multi-dev.md\`.

**The 27 detectors** — \`clad check --strict\` runs every drift detector.
Don't suppress findings; either fix them or update spec.
`;

export type AgentsMdResult = 'created' | 'skipped-exists' | 'overwritten';
export type ClaudeMdResult = 'created' | 'appended' | 'unchanged';

export function writeAgentsMd(
  targetDir: string,
  opts: { readonly force?: boolean } = {},
): AgentsMdResult {
  const path = join(targetDir, 'AGENTS.md');
  if (existsSync(path) && !opts.force) {
    return 'skipped-exists';
  }
  const existed = existsSync(path);
  writeFileSync(path, AGENTS_MD_TEMPLATE);
  return existed ? 'overwritten' : 'created';
}

export function writeClaudeMdSection(
  targetDir: string,
  opts: { readonly force?: boolean } = {},
): ClaudeMdResult {
  const path = join(targetDir, 'CLAUDE.md');
  if (!existsSync(path)) {
    writeFileSync(path, CLAUDE_MD_SECTION);
    return 'created';
  }
  const existing = readFileSync(path, 'utf8');
  if (existing.includes(CLAUDE_MD_SECTION_MARKER) && !opts.force) {
    return 'unchanged';
  }
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  writeFileSync(path, `${existing}${separator}${CLAUDE_MD_SECTION}`);
  return 'appended';
}
