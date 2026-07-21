// F-90d054 — project-local host AI instruction writers.
//
// Writes:
//   • <project>/CLAUDE.md       — Claude Code memory (idempotent append)
//
// AGENTS.md is NOT written here anymore: the spec-driven managed block
// (src/init/agents-md.ts, F-a4085adf) replaced the old static template, and a
// markerless file is treated as user-owned and never rewritten.
//
// Does NOT write `.mcp.json`, `.codex/config.toml`, or the other host MCP
// wiring files — those are project-local since 0.9.0 and are written by
// `clad setup` (src/init/host-setup.ts), never at npm install time.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLAUDE_MD_SECTION_MARKER = '## cladding';

export const CLAUDE_MD_SECTION = `## cladding

**Spec is SSoT** — \`spec.yaml\` is authoritative; code must satisfy its
\`features[]\` and \`acceptance_criteria\`. Run \`clad check --strict\` before commit.

**Persona separation** — planner writes spec, reviewer audits, developer
implements; whoever authors a unit must not sign off on it (anti-self-cert).

**Feature cycle — one at a time** — One feature end-to-end before the next:
author its spec entry (\`acceptance_criteria\` + \`modules\`) → implement → author tests
in a separate context → \`clad done <featureId>\` (sets \`status: done\` only when
\`clad check --tier=pre-push --strict\` is GREEN). Never author spec entries ahead of
their code, or hand-write \`status: done\`. See \`docs/feature-cycle.md\`.

**Hash-based IDs** — Never hand-author \`F-NNN\` filenames; use the \`clad\` CLI
(or \`/cladding:init\`). Model in \`docs/spec-ids-multi-dev.md\`.

**Drift detectors** — \`clad check --strict\` runs them all; don't suppress
findings — fix them or update spec.

**Speak the user's language** — when reporting to the user, translate
cladding terms into plain words in the user's own language — including
cladding's own gate and hook messages: relay them by
meaning. Never lead with internal ids.
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

// Positive freshness marker: every v0.4.x+ cladding-authored block carries
// the per-feature-cycle cadence rule. A cladding-authored file (one that
// carries the anti-self-cert signature, so we never mistake a user's own
// prose for stale cladding output) that PREDATES this rule must re-sync.
const FRESH_MARKER = 'Feature cycle — one at a time';
const CLADDING_AUTHORED_SIGNATURE = 'anti-self-cert';

export function isStaleInstructions(body: string): boolean {
  if (STALE_MARKERS.some((m) => body.includes(m))) return true;
  // Lone "use clad_create_feature MCP tool" with no surrounding "clad CLI"
  // qualifier — the new template always pairs the two.
  const mcpMentioned = /clad_create_feature[^.\n]{0,40}MCP\s*\n?\s*tool/i.test(body);
  if (mcpMentioned && !body.includes('clad` CLI') && !body.includes('clad CLI')) {
    return true;
  }
  // Cladding-authored but missing the feature-cycle cadence → pre-v0.4.x.
  if (body.includes(CLADDING_AUTHORED_SIGNATURE) && !body.includes(FRESH_MARKER)) {
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
