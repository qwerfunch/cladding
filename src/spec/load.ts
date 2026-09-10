// Cladding · spec loader — parse + validate + return typed Spec
//
// Supports two layouts (heuristic, zero-config):
//   1. **Unsharded** — `spec.yaml` carries `features` / `scenarios`
//      inline. Used when the project is small enough to keep the
//      whole catalogue in one file (cladding's own current layout).
//   2. **Sharded** — `spec.yaml` carries metadata only; each feature
//      lives in `spec/features/<id>.yaml` and each scenario in
//      `spec/scenarios/<id>.yaml`. Architecture stays a single file
//      at `spec/architecture.yaml`. Used when the spec grows past
//      one-file readability (≈ 1k lines).
//
// Detection: if the master `features` field is missing or an empty
// array AND `spec/features/` exists, the loader scans that dir and
// fills the catalogue. Same for `scenarios`. Architecture is always
// inline OR `spec/architecture.yaml` (single file, mutually exclusive).

import {existsSync, readdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

import {parseSpec} from './parse.js';
import {compileSpecWorkspaceFromStableSnapshot} from './compiler/compile.js';
import {compilerParsedYamlPaths, schema02ConsumerView} from './compiler/consumer-view.js';
import {withStableSpecWorkspaceSnapshot} from './transaction.js';
import {prospectiveSpecOverlay} from './prospective.js';
import type {Architecture, Capability, Feature, Scenario, Spec} from './types.js';
import {assertSpec} from './validate.js';

interface PartialSpec {
  schema?: string;
  project?: unknown;
  features?: readonly Feature[];
  scenarios?: readonly Scenario[];
  architecture?: Architecture;
  capabilities?: readonly Capability[];
}

function parseSpecWithCensus(path: string, parsedPaths?: Set<string>): unknown {
  const parsed = parseSpec(path);
  // Record only successful parses. A caller must still inspect a path that
  // threw, so an incomplete census can never mask malformed input.
  parsedPaths?.add(resolve(path));
  return parsed;
}

function loadDirectory<T>(dir: string, parsedPaths?: Set<string>): T[] {
  if (!existsSync(dir)) return [];
  // Readdir order is filesystem-dependent. Sort before parsing so callers that
  // compare a loaded snapshot with a gate snapshot cannot manufacture a stale
  // attestation merely by creating the same shards in a different order.
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  return files.map((f) => parseSpecWithCensus(join(dir, f), parsedPaths) as T);
}

/**
 * Reads, parses, and validates a cladding spec. Auto-detects
 * unsharded vs sharded layout per the heuristic in the module docstring.
 *
 * @param cwd - Project root. Defaults to `.`.
 * @param specPath - Master spec path relative to `cwd`. Defaults to `spec.yaml`.
 * @returns The validated, fully-resolved Spec object.
 * @throws Error when the master file is missing/unparseable or the
 *         merged result fails schema validation.
 * @see spec/parse.ts · spec/validate.ts
 */
// ─── Run-scoped spec cache (F-cd0415) ───
// Every withSpec detector independently re-parsed the whole shard tree —
// O(detectors × shards) YAML parses per gate run. Detectors are synchronous
// by Iron Law, so a cache primed around the synchronous runDrift loop and
// cleared in finally cannot go stale mid-run, and the MCP server's
// long-lived process never carries it across requests.
let runCache:
  | {
      readonly cwd: string;
      readonly spec: Spec;
      readonly parsedPaths: ReadonlySet<string>;
    }
  | null = null;

/** A loaded spec plus the disk paths that parsed successfully to create it. */
export interface LoadedSpecWithFileCensus {
  readonly spec: Spec;
  readonly parsedPaths: readonly string[];
}

/** Prime (or clear, with null) the run-scoped cache. Callers MUST clear in a
 * finally block — a primed cache outliving its run would serve stale spec. */
export function primeSpecCache(cwd: string, spec: Spec | null, parsedPaths: readonly string[] = []): void {
  runCache = spec
    ? {cwd: resolve(cwd), spec, parsedPaths: new Set(parsedPaths.map((path) => resolve(path)))}
    : null;
}

/**
 * True only when this exact path parsed successfully while the active run
 * loaded its immutable spec snapshot. The cache is cleared by the run's
 * finally block, so this never authorizes a later filesystem state.
 */
export function wasSpecPathParsedInRunCache(cwd: string, path: string): boolean {
  return runCache?.cwd === resolve(cwd) && runCache.parsedPaths.has(resolve(path));
}

export function loadSpec(cwd: string = '.', specPath: string = 'spec.yaml'): Spec {
  // F6 completion overlays outlive nested runDrift cache prime/clear pairs.
  // They are scoped by `withProspectiveSpecOverlay`, never retained across a
  // request, and always take precedence over a disk snapshot for this run.
  const prospective = specPath === 'spec.yaml' ? prospectiveSpecOverlay(cwd) : undefined;
  if (prospective) return prospective;
  if (runCache && specPath === 'spec.yaml' && resolve(cwd) === runCache.cwd) {
    return runCache.spec;
  }
  // The F4 commit boundary replaces a coherent group of root and shard files.
  // Readers that still use the legacy typed loader must see either side of that
  // transaction, never a mixture during its replacements.
  return withStableSpecWorkspaceSnapshot(cwd, () => loadSpecFromDiskUnlocked(cwd, specPath));
}

/**
 * Loads one immutable disk snapshot and returns the files that parsed to form
 * it. Gate coordinators may reuse this successful-parse census within the
 * same synchronous pass, avoiding a second YAML traversal without extending
 * the cache across runs.
 */
export function loadSpecWithFileCensus(
  cwd: string = '.',
  specPath: string = 'spec.yaml',
): LoadedSpecWithFileCensus {
  const prospective = specPath === 'spec.yaml' ? prospectiveSpecOverlay(cwd) : undefined;
  if (prospective) return {spec: prospective, parsedPaths: []};
  if (runCache && specPath === 'spec.yaml' && resolve(cwd) === runCache.cwd) {
    return {spec: runCache.spec, parsedPaths: [...runCache.parsedPaths]};
  }
  const parsedPaths = new Set<string>();
  const spec = withStableSpecWorkspaceSnapshot(cwd, () =>
    loadSpecFromDiskUnlocked(cwd, specPath, parsedPaths),
  );
  return {spec, parsedPaths: [...parsedPaths]};
}

/**
 * Reads the complete spec without acquiring the F4 lock.
 *
 * Call only while the caller owns the exclusive F4 lock or is inside
 * `withStableSpecWorkspaceSnapshot`; this seam never acquires a nested lock.
 */
export function loadSpecFromDiskUnlocked(
  cwd: string,
  specPath: string = 'spec.yaml',
  parsedPaths?: Set<string>,
): Spec {
  const masterPath = join(cwd, specPath);
  const partial = parseSpecWithCensus(masterPath, parsedPaths) as PartialSpec;

  // Schema 0.2 has no raw legacy merge path. The root parse above determines
  // only the dispatch version; every semantic input then comes from the
  // compiler snapshot already protected by this caller's stable authority.
  if (partial.schema === '0.2') {
    if (specPath !== 'spec.yaml') {
      throw new Error('Schema 0.2 workspaces require the canonical spec.yaml compiler entry point.');
    }
    const compilation = compileSpecWorkspaceFromStableSnapshot(cwd);
    const spec = schema02ConsumerView(cwd, compilation);
    for (const path of compilerParsedYamlPaths(cwd, compilation)) parsedPaths?.add(path);
    return spec;
  }

  const specDir = join(cwd, dirname(specPath), 'spec');

  // Features: fill from spec/features/*.yaml when the master's `features`
  // field is empty/absent. NOTE: an absent master *file* throws at parseSpec
  // above (see @throws) — this branch handles the sharded layout where the
  // master EXISTS but carries metadata only. Callers that must tolerate an
  // absent master (the MCP read tools) wrap loadSpec — see serve/server.ts
  // loadSpecOrError; detectors wrap it via detectors/with-spec.ts.
  if (!partial.features || partial.features.length === 0) {
    const featureFiles = loadDirectory<Feature>(join(specDir, 'features'), parsedPaths);
    if (featureFiles.length > 0) {
      (partial as Record<string, unknown>).features = featureFiles;
    }
  }

  // Scenarios: same pattern.
  if (!partial.scenarios || partial.scenarios.length === 0) {
    const scenarioFiles = loadDirectory<Scenario>(join(specDir, 'scenarios'), parsedPaths);
    if (scenarioFiles.length > 0) {
      (partial as Record<string, unknown>).scenarios = scenarioFiles;
    }
  }

  // Architecture: load `spec/architecture.yaml` only when master has no inline value.
  if (!partial.architecture) {
    const archPath = join(specDir, 'architecture.yaml');
    if (existsSync(archPath)) {
      (partial as Record<string, unknown>).architecture = parseSpecWithCensus(archPath, parsedPaths) as Architecture;
    }
  }

  // Capabilities: load the `capabilities` array out of `spec/capabilities.yaml`
  // (a `{schema, source, capabilities}` wrapper) when the master has none inline,
  // so Tier B is merged into the typed Spec and schema-validated at parse time
  // rather than only read ad-hoc by a detector. Added v0.4.x (J2).
  if (!partial.capabilities || partial.capabilities.length === 0) {
    const capPath = join(specDir, 'capabilities.yaml');
    if (existsSync(capPath)) {
      const capFile = parseSpecWithCensus(capPath, parsedPaths) as {capabilities?: readonly Capability[]};
      if (capFile && Array.isArray(capFile.capabilities)) {
        (partial as Record<string, unknown>).capabilities = capFile.capabilities;
      }
    }
  }

  // The shipped JSON-schema validator remains the schema-0.1 compatibility
  // contract. Schema 0.2 uses the compiler contract instead, but this loader
  // still supplies its deterministic locked snapshot to generated-artifact
  // callers such as attestation rendering.
  if (partial.schema !== '0.2') assertSpec(partial);
  return partial as Spec;
}
