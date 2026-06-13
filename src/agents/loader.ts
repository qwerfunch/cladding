// Cladding · agents · persona loader
//
// Parses an `agents/<id>.md` file into a {@link PersonaSpec} so the
// drive loop can hand it to an adapter. The five personas
// (orchestrator · planner · reviewer · observability · developer)
// each declare a YAML frontmatter that names them, their description,
// the Claude Code `tools:` enum, and the provider-agnostic
// `capabilities:` set; the body is the prose prompt every adapter
// passes to its LLM.
//
// Loaded personas are cached by id — re-parsing on every drive
// iteration is wasteful and the file content does not change at
// runtime.
//
// @see adapters/types.ts — `PersonaSpec` contract.
// @see agents/README.md — the persona index.

import {readFileSync, existsSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import {parse as parseYaml} from 'yaml';

import type {Capability, PersonaSpec} from '../adapters/types.js';

const CAPABILITY_VALUES: ReadonlySet<string> = new Set<string>([
  'read',
  'write',
  'edit',
  'exec',
  'dispatch',
]);

interface Frontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly tools?: string;
  readonly capabilities?: readonly string[];
}

/** Cache keyed by absolute file path so different cwds stay isolated. */
const cache = new Map<string, PersonaSpec>();

/**
 * 0.6.0 persona renames (alias-and-deprecate, docs/glossary.md). Resolving an
 * old id loads the NEW persona file and emits a one-line stderr deprecation
 * notice; the old ids are removed in 0.7.
 */
export const PERSONA_ALIASES: Readonly<Record<string, string>> = {
  librarian: 'planner',
  specialists: 'developer',
};

/**
 * Returns the {@link PersonaSpec} for the named persona.
 *
 * Looks for `agents/<id>.md` relative to {@link rootDir}. When the
 * file is missing the function throws — the drive loop should map
 * the error to a `UNCAUGHT_ERROR` halt and surface it to the user.
 *
 * Deprecated ids (`librarian` → `planner`, `specialists` →
 * `developer`) still resolve through {@link PERSONA_ALIASES} for the
 * 0.6.x line, with a one-line stderr notice naming the replacement.
 *
 * @param id - Persona id (`orchestrator` · `planner` · `reviewer`
 *     · `observability` · `developer`), or a deprecated alias.
 * @param rootDir - Optional root directory containing the `agents/`
 *     folder. Defaults to the cladding package's own `agents/`.
 * @returns Parsed persona spec ready to hand to `runAgent`.
 */
export function loadPersona(id: string, rootDir?: string): PersonaSpec {
  const replacement = PERSONA_ALIASES[id];
  if (replacement) {
    process.stderr.write(
      `cladding: persona '${id}' is now '${replacement}' — the old id is removed in 0.7\n`,
    );
  }
  const resolvedId = replacement ?? id;
  const path = resolveAgentPath(resolvedId, rootDir);
  const cached = cache.get(path);
  if (cached) return cached;
  if (!existsSync(path)) {
    throw new Error(`agents/${resolvedId}.md not found at ${path}`);
  }
  const spec = parseAgentFile(resolvedId, readFileSync(path, 'utf8'));
  cache.set(path, spec);
  return spec;
}

/**
 * Drops the cache. Test-only — production code should not need to
 * invalidate, but unit tests that swap files between cases do.
 */
export function clearPersonaCache(): void {
  cache.clear();
}

function resolveAgentPath(id: string, rootDir?: string): string {
  if (rootDir) return join(rootDir, 'agents', `${id}.md`);
  const here = dirname(fileURLToPath(import.meta.url));
  // Personas live in a different place per run mode: dev-from-src (this module IS
  // src/agents/, so the sibling <id>.md), the bundled binary (build.mjs copies them
  // to dist/agents/ next to the dist/clad.js bundle), or — as a last resort — the
  // packaged plugin tree. Earlier this returned only `dist/<id>.md`, which the build
  // never produced, so `clad run` and the MCP persona prompts crashed on a real
  // npm install. Return the first candidate that exists.
  const candidates = [
    join(here, `${id}.md`), // dev: src/agents/<id>.md
    join(here, 'agents', `${id}.md`), // bundled: dist/agents/<id>.md
    join(here, '..', 'plugins', 'claude-code', 'agents', `${id}.md`), // packaged plugin tree
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[1];
}

function parseAgentFile(id: string, raw: string): PersonaSpec {
  const {frontmatter, body} = splitFrontmatter(raw);
  const capabilities = normalizeCapabilities(frontmatter.capabilities);
  return {
    id: frontmatter.name ?? id,
    body: body.trim(),
    capabilities,
  };
}

/**
 * Splits a markdown file into a YAML frontmatter object and the
 * remaining body. Frontmatter is delimited by `---` lines at the
 * start of the file. Returns `{frontmatter: {}, body: raw}` when no
 * frontmatter is present.
 */
function splitFrontmatter(raw: string): {frontmatter: Frontmatter; body: string} {
  if (!raw.startsWith('---\n')) {
    return {frontmatter: {}, body: raw};
  }
  const end = raw.indexOf('\n---\n', 4);
  if (end === -1) return {frontmatter: {}, body: raw};
  const yamlText = raw.slice(4, end);
  const body = raw.slice(end + 5);
  const parsed = parseYaml(yamlText) as Frontmatter | null;
  return {frontmatter: parsed ?? {}, body};
}

function normalizeCapabilities(input: readonly string[] | undefined): ReadonlySet<Capability> {
  if (!input) return new Set();
  const out = new Set<Capability>();
  for (const value of input) {
    if (CAPABILITY_VALUES.has(value)) out.add(value as Capability);
  }
  return out;
}
