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
  Never hand-author \`F-NNN\` filenames — ask cladding via the \`clad\`
  CLI (or, when your host has cladding wired as an MCP server,
  \`clad_create_feature\`).
- \`docs/project-context.md\` is the Tier B design SSoT.
- Run \`clad check --strict\` to verify spec ↔ code drift across 27
  detectors.

## Persona separation (anti-self-cert)

The agent that writes a unit of work must not be the agent that signs off
on it. librarian writes spec, reviewer audits, specialists implement.

## When to invoke \`clad_create_feature\`

Call **before** the first code-edit tool (Edit / Write / file mutation) in
any session that changes behavior, even when:

- the user did not say "add a feature" / "기능 추가" — implementation
  prompts ("fix X", "refactor Y", "make it do Z") still count
- you have just exited plan mode and are about to implement what the plan
  described — the implementation phase needs its own feature shard
- the final scope is unclear — register a provisional slug now
  (e.g. \`wip-<short-description>\`). The hash id is the stable
  identifier; the slug is baked into both the filename
  (\`<slug>-<hash>.yaml\`) and the \`slug:\` field, so a later rename
  requires \`git mv\` on the file **plus** a matching \`slug:\` edit
- the work spans multiple logically distinct features — make one
  \`clad_create_feature\` call per distinct feature, not a single
  catch-all shard
- the work also introduces a new user journey — pair the feature with
  a \`clad_create_scenario\` call so the journey is registered too

Skip only for read-only sessions (questions, code review, git-history
queries) and single-line typo / formatting fixes.

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

**Hash-based IDs** — Never hand-author \`F-NNN\` filenames; use the
\`clad\` CLI or invoke cladding through the \`/cladding:init\` slash
command. The multi-developer-safe model is in
\`docs/spec-ids-multi-dev.md\`.

**Call \`clad_create_feature\` before the first code-edit tool** in
any session that changes behavior — implementation prompts without
the words "feature" / "기능" still count (e.g. "fix X", "refactor Y",
or implementing right after \`ExitPlanMode\`). If the slug isn't
clear, register a provisional one (e.g. \`wip-<short-description>\`);
the slug is baked into both the filename (\`<slug>-<hash>.yaml\`)
and the \`slug:\` field, so a later rename needs \`git mv\` plus a
matching field edit. Make one call per logically distinct feature,
and pair with \`clad_create_scenario\` when the work introduces a
new user journey. Skip read-only sessions and single-line typo
fixes.

**The 27 detectors** — \`clad check --strict\` runs every drift detector.
Don't suppress findings; either fix them or update spec.
`;

// v0.3.x markers that disappeared in v0.4.0. When detected in an existing
// AGENTS.md or CLAUDE.md, the file was written by an older `clad init` and
// needs a refresh — otherwise the AI session reads stale guidance (e.g.
// "use the clad_create_feature MCP tool" in a Claude Code session that has
// no MCP server wired) and surfaces confusing prompts before the user can
// run `/cladding:init`.
const STALE_MARKERS = [
  '_meta.enrichment_status',
  'first-task enrichment rule',
  'enrichment_scope',
];

export function isStaleInstructions(body: string): boolean {
  if (STALE_MARKERS.some((m) => body.includes(m))) return true;
  // Lone "use clad_create_feature MCP tool" with no surrounding "clad CLI"
  // qualifier — the new template always pairs the two.
  const mcpMentioned = /clad_create_feature[^.\n]{0,40}MCP\s*\n?\s*tool/i.test(body);
  if (mcpMentioned && !body.includes('clad` CLI') && !body.includes('clad CLI')) {
    return true;
  }
  return false;
}

export type AgentsMdResult =
  | 'created'
  | 'skipped-exists'
  | 'overwritten'
  | 'refreshed-stale';
export type ClaudeMdResult =
  | 'created'
  | 'appended'
  | 'unchanged'
  | 'refreshed-stale';

export function writeAgentsMd(
  targetDir: string,
  opts: { readonly force?: boolean } = {},
): AgentsMdResult {
  const path = join(targetDir, 'AGENTS.md');
  const existed = existsSync(path);
  if (!existed) {
    writeFileSync(path, AGENTS_MD_TEMPLATE);
    return 'created';
  }
  if (opts.force) {
    writeFileSync(path, AGENTS_MD_TEMPLATE);
    return 'overwritten';
  }
  const existing = readFileSync(path, 'utf8');
  if (isStaleInstructions(existing)) {
    writeFileSync(path, AGENTS_MD_TEMPLATE);
    return 'refreshed-stale';
  }
  return 'skipped-exists';
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
  const hasMarker = existing.includes(CLAUDE_MD_SECTION_MARKER);
  if (!hasMarker) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    writeFileSync(path, `${existing}${separator}${CLAUDE_MD_SECTION}`);
    return 'appended';
  }
  if (opts.force) {
    writeFileSync(path, replaceCladdingSection(existing, CLAUDE_MD_SECTION));
    return 'refreshed-stale';
  }
  const sectionBody = extractCladdingSection(existing);
  if (sectionBody !== null && isStaleInstructions(sectionBody)) {
    writeFileSync(path, replaceCladdingSection(existing, CLAUDE_MD_SECTION));
    return 'refreshed-stale';
  }
  return 'unchanged';
}

function extractCladdingSection(body: string): string | null {
  const start = body.indexOf(CLAUDE_MD_SECTION_MARKER);
  if (start < 0) return null;
  const after = body.slice(start);
  const nextHeader = after.search(/\n##\s+(?!cladding\b)/);
  return nextHeader < 0 ? after : after.slice(0, nextHeader);
}

function replaceCladdingSection(body: string, newSection: string): string {
  const start = body.indexOf(CLAUDE_MD_SECTION_MARKER);
  if (start < 0) {
    const separator = body.endsWith('\n') ? '\n' : '\n\n';
    return `${body}${separator}${newSection}`;
  }
  const before = body.slice(0, start);
  const after = body.slice(start);
  const nextHeader = after.search(/\n##\s+(?!cladding\b)/);
  const tail = nextHeader < 0 ? '' : after.slice(nextHeader);
  const separator = before.length === 0 || before.endsWith('\n') ? '' : '\n';
  return `${before}${separator}${newSection.replace(/\n+$/, '')}\n${tail.replace(/^\n+/, tail.length > 0 ? '\n' : '')}`;
}
