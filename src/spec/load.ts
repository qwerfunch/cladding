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

function loadDirectory<T>(dir: string): T[] {
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  return files.map((f) => parseSpec(join(dir, f)) as T);
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
let runCache: {readonly cwd: string; readonly spec: Spec} | null = null;

/** Prime (or clear, with null) the run-scoped cache. Callers MUST clear in a
 * finally block — a primed cache outliving its run would serve stale spec. */
export function primeSpecCache(cwd: string, spec: Spec | null): void {
  runCache = spec ? {cwd: resolve(cwd), spec} : null;
}

export function loadSpec(cwd: string = '.', specPath: string = 'spec.yaml'): Spec {
  if (runCache && specPath === 'spec.yaml' && resolve(cwd) === runCache.cwd) {
    return runCache.spec;
  }
  return loadSpecFromDisk(cwd, specPath);
}

function loadSpecFromDisk(cwd: string, specPath: string): Spec {
  const masterPath = join(cwd, specPath);
  const partial = parseSpec(masterPath) as PartialSpec;

  const specDir = join(cwd, dirname(specPath), 'spec');

  // Features: fill from spec/features/*.yaml when the master's `features`
  // field is empty/absent. NOTE: an absent master *file* throws at parseSpec
  // above (see @throws) — this branch handles the sharded layout where the
  // master EXISTS but carries metadata only. Callers that must tolerate an
  // absent master (the MCP read tools) wrap loadSpec — see serve/server.ts
  // loadSpecOrError; detectors wrap it via detectors/with-spec.ts.
  if (!partial.features || partial.features.length === 0) {
    const featureFiles = loadDirectory<Feature>(join(specDir, 'features'));
    if (featureFiles.length > 0) {
      (partial as Record<string, unknown>).features = featureFiles;
    }
  }

  // Scenarios: same pattern.
  if (!partial.scenarios || partial.scenarios.length === 0) {
    const scenarioFiles = loadDirectory<Scenario>(join(specDir, 'scenarios'));
    if (scenarioFiles.length > 0) {
      (partial as Record<string, unknown>).scenarios = scenarioFiles;
    }
  }

  // Architecture: load `spec/architecture.yaml` only when master has no inline value.
  if (!partial.architecture) {
    const archPath = join(specDir, 'architecture.yaml');
    if (existsSync(archPath)) {
      (partial as Record<string, unknown>).architecture = parseSpec(archPath) as Architecture;
    }
  }

  // Capabilities: load the `capabilities` array out of `spec/capabilities.yaml`
  // (a `{schema, source, capabilities}` wrapper) when the master has none inline,
  // so Tier B is merged into the typed Spec and schema-validated at parse time
  // rather than only read ad-hoc by a detector. Added v0.4.x (J2).
  if (!partial.capabilities || partial.capabilities.length === 0) {
    const capPath = join(specDir, 'capabilities.yaml');
    if (existsSync(capPath)) {
      const capFile = parseSpec(capPath) as {capabilities?: readonly Capability[]};
      if (capFile && Array.isArray(capFile.capabilities)) {
        (partial as Record<string, unknown>).capabilities = capFile.capabilities;
      }
    }
  }

  assertSpec(partial);
  return partial;
}
