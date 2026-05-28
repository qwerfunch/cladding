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

import type {Capability, PersonaHostHints, PersonaSpec} from '../adapters/types.js';

const CAPABILITY_VALUES: ReadonlySet<string> = new Set<string>([
  'read',
  'write',
  'edit',
  'exec',
  'dispatch',
]);

const PERMISSION_MODES: ReadonlySet<string> = new Set<string>([
  'default',
  'plan',
  'acceptEdits',
  'bypassPermissions',
  'dontAsk',
]);

const SANDBOX_MODES: ReadonlySet<string> = new Set<string>([
  'read-only',
  'workspace-write',
  'danger-full-access',
]);

const ISOLATION_VALUES: ReadonlySet<string> = new Set<string>(['session', 'worktree']);

interface Frontmatter {
  readonly name?: string;
  readonly description?: string;
  readonly tools?: string;
  readonly capabilities?: readonly string[];
  // 0.4.10 PR-A.2 — host-specific hints (all optional). Unknown values
  // are silently dropped at normalize time so the loader never throws
  // on a forward-compat frontmatter from a newer persona spec.
  readonly model?: string;
  readonly permissionMode?: string;
  readonly sandbox_mode?: string;
  readonly maxTurns?: number;
  readonly skills?: readonly string[];
  readonly isolation?: string;
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
  const hostHints = normalizeHostHints(frontmatter);
  return {
    id: frontmatter.name ?? id,
    body: body.trim(),
    capabilities,
    ...(hostHints ? {hostHints} : {}),
  };
}

/**
 * Pulls host-hint fields out of frontmatter, validating enum values
 * silently (unknown values are dropped — the loader never throws on
 * forward-compat frontmatter, since older cladding builds must
 * tolerate persona files written for newer hosts).
 *
 * Returns undefined when no host hint is present so the PersonaSpec
 * stays minimal for personas that don't declare any hint.
 */
function normalizeHostHints(frontmatter: Frontmatter): PersonaHostHints | undefined {
  const hints: Record<string, unknown> = {};
  if (typeof frontmatter.model === 'string' && frontmatter.model.length > 0) {
    hints.model = frontmatter.model;
  }
  if (typeof frontmatter.permissionMode === 'string' && PERMISSION_MODES.has(frontmatter.permissionMode)) {
    hints.permissionMode = frontmatter.permissionMode;
  }
  if (typeof frontmatter.sandbox_mode === 'string' && SANDBOX_MODES.has(frontmatter.sandbox_mode)) {
    hints.sandbox_mode = frontmatter.sandbox_mode;
  }
  if (typeof frontmatter.maxTurns === 'number' && Number.isFinite(frontmatter.maxTurns) && frontmatter.maxTurns > 0) {
    hints.maxTurns = Math.floor(frontmatter.maxTurns);
  }
  if (Array.isArray(frontmatter.skills) && frontmatter.skills.length > 0) {
    const cleaned = frontmatter.skills.filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (cleaned.length > 0) hints.skills = cleaned;
  }
  if (typeof frontmatter.isolation === 'string' && ISOLATION_VALUES.has(frontmatter.isolation)) {
    hints.isolation = frontmatter.isolation;
  }
  if (Object.keys(hints).length === 0) return undefined;
  return hints as PersonaHostHints;
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
