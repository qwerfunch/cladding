// F-a4085adf — spec-driven AGENTS.md for adopting projects (issue #199).
//
// WHY this exists: `writeAgentsMd` (host-instructions.ts) writes a STATIC
// `AGENTS_MD_TEMPLATE` with zero spec interpolation — every adopter's AGENTS.md
// is byte-identical regardless of their project's test framework, branch policy,
// forbidden/preferred patterns, or preferred persona. #199 asks for the opposite:
// the cross-host entry point (Codex · Cursor · Gemini · Continue · Copilot ·
// Aider — every reader of the agents.md standard) should carry the SAME
// spec-sourced guidance Claude gets from `spec.yaml::project.ai_hints`, so a
// non-Claude host is not flying blind.
//
// This module emits a MARKER-DELIMITED managed block, mirroring
// `upsertInventoryBlock` (src/spec/inventory.ts): re-emission regenerates only
// the delimited block, preserves the user's surrounding prose, and is byte-stable
// when the spec is unchanged. A file that carries NO markers (hand-authored —
// including cladding's own root /AGENTS.md) is never rewritten wholesale.
//
// LEAN: the managed block replaces the static template's generic prose with
// project-specific spec content — it is roughly the template's size, not an
// addition on top of it.

import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../spec/load.js';
import type {Spec} from '../spec/types.js';

/** Managed-block delimiters. Everything between them is regenerated from spec;
 * everything outside is preserved verbatim across re-emission. */
export const AGENTS_MD_BEGIN = '<!-- clad:agents-md begin -->';
export const AGENTS_MD_END = '<!-- clad:agents-md end -->';

/** Minimal frame written above the managed block when the file is created fresh.
 * The H1 lives OUTSIDE the markers so a user may retitle without churn. */
const AGENTS_MD_FRAME_HEADER = '# AGENTS.md\n\n';

/**
 * Provider-neutral persona → capability map. Sourced from the `capabilities:`
 * frontmatter of src/agents/*.md (read, write, edit, exec, dispatch) — the
 * vendor-agnostic companion to each persona's Claude-only `tools:` key. Baked in
 * (not read from the adopter's disk) because these personas ship with the engine;
 * an adopting repo has no src/agents/. Surfacing this map is the cross-host value
 * #199 names (AC-9d3f2e88): a Codex/Gemini session gets the same persona guidance.
 */
const PERSONA_CAPABILITIES: ReadonlyArray<readonly [string, string]> = [
  ['planner', 'read, write, edit, exec'],
  ['developer', 'read, write, edit, exec'],
  ['reviewer', 'read, exec'],
  ['blind-author', 'write, exec'],
  ['observability', 'read, exec'],
  ['orchestrator', 'read, write, edit, exec, dispatch'],
];

export type SpecAgentsMdResult =
  /** File was absent — created fresh (frame + managed block). */
  | 'created'
  /** File carried the markers and the regenerated block differed — block spliced. */
  | 'updated'
  /** File carried the markers and the regenerated block was byte-identical — no write. */
  | 'unchanged'
  /** File exists but carries NO clad markers (hand-authored) — left untouched. */
  | 'skipped-unmanaged';

/** Backtick-wrap a literal, defusing any stray backtick so the span stays intact. */
function code(s: string): string {
  return '`' + s.replace(/`/g, '‘') + '`';
}

/** Renders the ai_hints-derived "this project's conventions" section, or '' when
 * there is nothing project-specific to say (so a hints-less spec degrades to the
 * generic block — AC-4b6c1a97). */
function renderConventions(spec: Spec | null): string {
  const hints = spec?.project?.ai_hints;
  if (!hints) return '';
  const lines: string[] = [];
  if (hints.test_framework) {
    lines.push(`- Tests run under **${hints.test_framework}** — keep new tests where this project already keeps them.`);
  }
  if (hints.primary_branch) {
    lines.push(`- New feature work targets the **${hints.primary_branch}** branch by default.`);
  }
  if (hints.forbidden_patterns && hints.forbidden_patterns.length > 0) {
    lines.push(`- Never introduce these identifiers: ${hints.forbidden_patterns.map(code).join(', ')}.`);
  }
  if (hints.preferred_patterns && hints.preferred_patterns.length > 0) {
    lines.push('- Preferred patterns:');
    for (const p of hints.preferred_patterns) {
      const over = p.over ? ` over ${p.over}` : '';
      lines.push(`  - ${p.when} → prefer ${p.prefer}${over}.`);
    }
  }
  if (lines.length === 0) return '';
  return `\n## This project's conventions (from \`spec.yaml::project.ai_hints\`)\n\n${lines.join('\n')}\n`;
}

/** Pointer line to the Tier B/C docs, emitted only for docs that actually exist
 * under `cwd` (keeps the block accurate + project-aware without inlining prose). */
function renderDocPointers(cwd: string): string {
  const hasContext = existsSync(join(cwd, 'docs', 'project-context.md'));
  const hasConventions = existsSync(join(cwd, 'docs', 'conventions.md'));
  if (!hasContext && !hasConventions) return '';
  const parts: string[] = [];
  if (hasContext) parts.push('`docs/project-context.md` (why this project exists)');
  if (hasConventions) parts.push('`docs/conventions.md` (its code style)');
  return `- Deeper context: ${parts.join(' and ')}.\n`;
}

/**
 * Renders the cladding-managed AGENTS.md block from the project's spec. Pure
 * (no writes). Degrades gracefully: a null spec or a spec with no `ai_hints`
 * yields the generic guidance (project sections + persona map) rather than
 * throwing — AC-4b6c1a97.
 */
export function renderAgentsMdManagedBlock(spec: Spec | null, cwd: string = '.'): string {
  const name = spec?.project?.name?.trim();
  const intent = (spec?.project?.intent_summary ?? spec?.project?.description)?.trim();
  const persona = spec?.project?.ai_hints?.preferred_persona?.trim();

  const heading = name ? `## ${name} — what this project is` : '## What this project is';
  const intentLine = intent ? `\n${intent}\n` : '\n';

  const personaLines = PERSONA_CAPABILITIES.map(([p, caps]) => `- ${p} — ${caps}`).join('\n');
  const defaultPersona = persona
    ? ` The default persona for this project is **${persona}**.`
    : '';

  return [
    'This project is managed by **cladding** — the Spec-Anchored Agent Harness.',
    `The lines between the \`clad:agents-md\` markers are generated from \`spec.yaml\`; edit the spec, not them. Everything OUTSIDE the markers is yours to keep.`,
    '',
    heading,
    intentLine.replace(/\n$/, ''),
    '',
    '## Single source of truth',
    '',
    '- `spec.yaml` is authoritative (Tier A); code must conform to its `features[]` and',
    '  `acceptance_criteria`. Feature detail lives in `spec/features/<slug>-<hash>.yaml` —',
    '  never hand-author `F-NNN` filenames; ask cladding via the `clad` CLI (or',
    '  `clad_create_feature` when your host has cladding wired as an MCP server).',
    '- For shell commands, use `node .cladding/host/serve.cjs <arguments>` when that',
    '  project launcher exists; it pins the CLI to the same engine as MCP. Fall back to',
    '  `clad <arguments>` only when the project has no launcher.',
    '- Run the resolved Cladding command with `check --strict` to verify spec ↔ code',
    '  across every drift detector.',
    renderDocPointers(cwd).replace(/\n$/, ''),
    '',
    '## Feature cycle — one at a time',
    '',
    'Finish ONE feature end-to-end before the next: author its spec entry (`acceptance_criteria`',
    '+ `modules`) → implement → author tests in a separate context → run the declared test',
    'command and confirm it collected relevant tests → run the resolved Cladding command',
    'with `done <featureId>` (sets `status: done` only when the strict pre-push gate is',
    'GREEN). Package test scripts must not depend on shell-expanded glob patterns. Do not',
    'author spec entries ahead of their code, or hand-write `status: done`.',
    '',
    '## Writing an acceptance criterion',
    '',
    'Each criterion may declare an `ears` pattern. When it does, its `condition` must open',
    'with that pattern\'s trigger word — the gate rejects the entry otherwise:',
    '',
    '| `ears` | `condition` must | example |',
    '|---|---|---|',
    '| `ubiquitous` | be omitted — the rule always holds | *(none)* |',
    '| `event` | start with **when** | `when the upload completes` |',
    '| `state` | start with **while** | `while the queue is draining` |',
    '| `optional` | start with **where** | `where telemetry is enabled` |',
    '| `unwanted` | start with **if** | `if the checksum does not match` |',
    '| `complex` | start with **while** and also contain a **when** clause | `while offline, when a retry fires` |',
    '',
    'Write the obligation in `text`, or in the `action` / `response` fields — both are read',
    'as the requirement. Put the reasoning in `notes`; it is free prose and nothing parses it.',
    '',
    '## Design evolves with each feature',
    '',
    'Before implementation, classify the feature as: no design impact, an additive',
    'capability/scenario link, or a structural change. Apply deterministic links directly;',
    'preview architecture or project-context changes for the user. Do not finish a feature',
    'while a material design impact remains unresolved, and do not churn design documents',
    'for internal fixes that genuinely have no design impact.',
    renderConventions(spec).replace(/\n$/, ''),
    '',
    '## Personas — cross-host capability map (anti-self-cert)',
    '',
    `The agent that writes a unit of work must not sign off on it.${defaultPersona} Each`,
    'persona and the vendor-neutral capabilities it may use — so Codex, Gemini, and other',
    'AGENTS.md readers receive the same guidance Claude does:',
    '',
    personaLines,
    '',
    "These briefs are manuals for cladding's touchpoints, not a roster of permitted agents: any host agent may take up any of them, and an agent that never touches a cladding surface needs none. The gates judge a result the same way whoever produced it — the one thing tied to identity is the independence label, which records whether the verifier was independent of the author, never which brief (if any) an agent wore.",
    '',
    "## Speak the user's language",
    '',
    "Translate cladding's vocabulary into plain words in the user's own language when you",
    'report progress — relay gate/hook messages by meaning, and never lead with an internal',
    'id (`F-…`, `AC-…`, `stage_X.Y`): name the feature and the plain outcome instead.',
  ]
    .join('\n')
    // Collapse the blank lines left by any section that rendered empty (doc
    // pointers, conventions, intent) so the block is tidy + deterministic.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Splices a freshly-rendered managed block into `body` between the markers,
 * preserving all surrounding prose. Returns `body` unchanged when the markers
 * are absent or malformed (the caller treats that as skip-unmanaged). CRLF-safe:
 * all surgery happens in LF, the file's original ending is restored at the exit.
 */
export function upsertAgentsMdBlock(body: string, block: string): string {
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lf = body.replace(/\r\n/g, '\n');
  const begin = lf.indexOf(AGENTS_MD_BEGIN);
  const end = lf.indexOf(AGENTS_MD_END);
  if (begin < 0 || end < 0 || end < begin) return body; // markerless / malformed → untouched
  const before = lf.slice(0, begin);
  const after = lf.slice(end + AGENTS_MD_END.length);
  const rebuiltLf = `${before}${AGENTS_MD_BEGIN}\n${block}\n${AGENTS_MD_END}${after}`;
  return eol === '\r\n' ? rebuiltLf.replace(/\n/g, '\r\n') : rebuiltLf;
}

/**
 * Writes the spec-driven AGENTS.md for an adopting project.
 *
 *   • absent file           → create it (frame + managed block)               'created'
 *   • marker file, changed  → regenerate only the block, preserve prose        'updated'
 *   • marker file, same     → no write (byte-stable on unchanged spec)         'unchanged'
 *   • existing, NO markers  → leave untouched (hand-authored — AC-1f8d7b02)    'skipped-unmanaged'
 *
 * Never throws: a spec that cannot be loaded or that declares no `ai_hints`
 * degrades to the generic block (AC-4b6c1a97).
 */
export function writeSpecDrivenAgentsMd(cwd: string = '.'): SpecAgentsMdResult {
  let spec: Spec | null = null;
  try {
    spec = loadSpec(cwd);
  } catch {
    spec = null; // AC-4b6c1a97 — degrade, never fail the command
  }
  const block = renderAgentsMdManagedBlock(spec, cwd);
  const path = join(cwd, 'AGENTS.md');

  if (!existsSync(path)) {
    writeFileSync(path, `${AGENTS_MD_FRAME_HEADER}${AGENTS_MD_BEGIN}\n${block}\n${AGENTS_MD_END}\n`);
    return 'created';
  }

  const existing = readFileSync(path, 'utf8');
  if (!existing.includes(AGENTS_MD_BEGIN) || !existing.includes(AGENTS_MD_END)) {
    return 'skipped-unmanaged'; // hand-authored (incl. cladding's own root /AGENTS.md)
  }
  const rebuilt = upsertAgentsMdBlock(existing, block);
  if (rebuilt === existing) return 'unchanged';
  writeFileSync(path, rebuilt);
  return 'updated';
}
