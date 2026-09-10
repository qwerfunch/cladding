// Cladding · Spec 0.2 F7 P1 · compiler-derived authoring snapshot.

import {compileSpecWorkspaceWithLockHeld} from './compile.js';
import {requireSchema02Contract} from './contract-assertion.js';
import {shardFilenameSlug} from './id-policy.js';
import {readSpecTransactionBytes, withSpecWorkspaceLock} from '../transaction.js';
import type {
  Schema02CapabilityContract,
  Schema02FeatureContract,
  Schema02ScenarioContract,
  SemanticGraphNode,
  SpecCompilation,
} from './types.js';

/**
 * One canonical catalog preimage retained only for optimistic typed edits.
 *
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export interface Schema02AuthoringCatalogSource {
  /** Canonical repository-relative capability catalog path. */
  readonly path: 'spec/capabilities.yaml';
  /** Exact bytes observed under the same lock as the compiler snapshot. */
  readonly sourceBytes: string;
}

/**
 * Compiler feature fact with its canonical shard preimage.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d06--feature-and-criterion-contract
 */
export type Schema02AuthoringFeature = Schema02FeatureContract & {
  /** Filename-derived operation selector, never a persisted legacy alias. */
  readonly slug: string;
  /** Canonical repository-relative shard path. */
  readonly path: string;
  /** Exact shard bytes observed under the snapshot lock. */
  readonly sourceBytes: string;
};

/**
 * Compiler capability fact with the canonical catalog preimage.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d07--capability-contract-and-edge-ownership
 */
export type Schema02AuthoringCapability = Schema02CapabilityContract & Schema02AuthoringCatalogSource;

/**
 * Compiler-complete journey fact with its canonical shard preimage.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d09--scenario-contract
 */
export interface Schema02AuthoringScenario extends Schema02ScenarioContract {
  /** Filename-derived operation selector, normalized for typed edits. */
  readonly slug: string;
  /** Canonical repository-relative shard path. */
  readonly path: string;
  /** Exact shard bytes observed under the snapshot lock. */
  readonly sourceBytes: string;
}

/**
 * One immutable compiler and source-byte snapshot for schema 0.2 authoring.
 *
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 */
export interface Schema02AuthoringSnapshot {
  /** Lock-held compiler snapshot whose complete contract supplied every fact below. */
  readonly compilation: SpecCompilation;
  /** Compiler-authoritative feature records with their source preimages. */
  readonly features: readonly Schema02AuthoringFeature[];
  /** Compiler-authoritative capability records with their shared catalog preimage. */
  readonly capabilities: readonly Schema02AuthoringCapability[];
  /** Canonical catalog preimage, retained even when the catalog has no entries. */
  readonly capabilityCatalog: Schema02AuthoringCatalogSource;
  /** Complete compiler-authoritative scenario records with their source preimages. */
  readonly scenarios: readonly Schema02AuthoringScenario[];
}

/**
 * Reads one coherent schema 0.2 authoring snapshot without interpreting YAML
 * outside the compiler. The captured bytes are optimistic revision preimages,
 * not a second semantic authority.
 *
 * @param cwd - Workspace root.
 * @returns Complete compiler facts plus exact managed source bytes.
 * @throws Error when the compiler cannot produce a complete schema 0.2 contract.
 * @see docs/design/spec-0.2/proof-and-editing.md#d12--transactional-spec-editing
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 */
export function readSchema02AuthoringSnapshot(cwd: string = '.'): Schema02AuthoringSnapshot {
  return withSpecWorkspaceLock(cwd, () => {
    const compilation = compileSpecWorkspaceWithLockHeld(cwd);
    const contract = requireSchema02Contract(compilation);
    const featureSources = sourcePaths(compilation, 'feature');
    const scenarioSources = sourcePaths(compilation, 'scenario');
    const capabilityCatalog: Schema02AuthoringCatalogSource = {
      path: 'spec/capabilities.yaml',
      sourceBytes: requiredSourceBytes(cwd, 'spec/capabilities.yaml', 'capability catalog'),
    };
    return {
      compilation,
      features: contract.features.map((feature) => {
        const path = requiredSourcePath(featureSources, feature.id, 'feature');
        return {...feature, slug: operationSlug(path, feature.id), path, sourceBytes: requiredSourceBytes(cwd, path, `feature ${feature.id}`)};
      }),
      capabilities: contract.capabilities.map((capability) => ({...capability, ...capabilityCatalog})),
      capabilityCatalog,
      scenarios: contract.scenarios.map((scenario) => {
        const path = requiredSourcePath(scenarioSources, scenario.id, 'scenario');
        return {...scenario, slug: operationSlug(path, scenario.id), path, sourceBytes: requiredSourceBytes(cwd, path, `scenario ${scenario.id}`)};
      }),
    };
  });
}

function sourcePaths(
  compilation: SpecCompilation,
  kind: 'feature' | 'scenario',
): ReadonlyMap<string, string> {
  return new Map<string, string>(compilation.nodes
    .filter((node): node is SemanticGraphNode => node.nodeType === 'semantic' && node.kind === kind)
    .map((node) => [node.address.slice(`${kind}:`.length), node.source.path]));
}

function requiredSourcePath(sources: ReadonlyMap<string, string>, id: string, kind: string): string {
  const path = sources.get(id);
  if (!path) throw new Error(`Schema 0.2 compiler cannot locate the ${kind} shard for ${id}.`);
  return path;
}

function requiredSourceBytes(cwd: string, path: string, label: string): string {
  const bytes = readSpecTransactionBytes(cwd, path);
  if (bytes === null) throw new Error(`Schema 0.2 compiler cannot read the canonical ${label} source at ${path}.`);
  return bytes;
}

function operationSlug(path: string, id: string): string {
  return shardFilenameSlug(path, id).toLowerCase();
}
