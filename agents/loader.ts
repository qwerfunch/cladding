// Cladding · agents · persona loader
//
// Parses an `agents/<id>.md` file into a {@link PersonaSpec} so the
// drive loop can hand it to an adapter. The five personas
// (orchestrator · librarian · reviewer · observability · specialists)
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
 * Returns the {@link PersonaSpec} for the named persona.
 *
 * Looks for `agents/<id>.md` relative to {@link rootDir}. When the
 * file is missing the function throws — the drive loop should map
 * the error to a `UNCAUGHT_ERROR` halt and surface it to the user.
 *
 * @param id - Persona id (`orchestrator` · `librarian` · `reviewer`
 *     · `observability` · `specialists`).
 * @param rootDir - Optional root directory containing the `agents/`
 *     folder. Defaults to the cladding package's own `agents/`.
 * @returns Parsed persona spec ready to hand to `runAgent`.
 */
export function loadPersona(id: string, rootDir?: string): PersonaSpec {
  const path = resolveAgentPath(id, rootDir);
  const cached = cache.get(path);
  if (cached) return cached;
  if (!existsSync(path)) {
    throw new Error(`agents/${id}.md not found at ${path}`);
  }
  const spec = parseAgentFile(id, readFileSync(path, 'utf8'));
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
  return join(here, `${id}.md`);
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
