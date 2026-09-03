// Cladding · Spec 0.2 F9b · 5,000-feature synthetic GraphIR workspace for the topology suite.
//
// The feature/criterion/alias generator below DUPLICATES `syntheticCompilation` from
// `tests/graph/graph-ir-v2-query.test.ts` on purpose. That file is a reviewed proof
// carrier: editing it to export the generator would restale every `[covers:F-208eaa79/…]`
// binding that points into it, which is a far larger cost than one copied loop. The copy
// is therefore deliberate duplication with a named original, not an accident.
//
// Two things are ADDED on top of the copied generator, because the F8 original answers a
// different question (index + projection latency on a pure `depends_on` chain):
//
//   • a schema 0.2 `contract`, without which `buildCycleContextEnvelope` cannot resolve a
//     feature at all — the envelope is a contract projection, and the F8 generator emits
//     schema 0.1 nodes with no contract;
//   • artifact nodes and `touches` edges, so `owners(path)` has something to answer and a
//     shared-module HUB exists. On a bare prerequisite chain every feature owns exactly one
//     private file, "most co-owned modules" is undefined, and the ownership fan-out section
//     the hub measurement exists to stress is empty.
//
// A synthetic feature has no shard file on disk. `inputRevisionsFor` records `unknown` for
// an unreadable shard, which is the honest answer and exactly what the suite asserts.

import {graphIrV2} from '../../../src/spec/compiler/graph-ir-v2.js';
import type {GraphIrV2Workspace} from '../../../src/graph/query.js';
import type {
  GraphAliasRecord,
  GraphEdge,
  GraphNode,
  GraphPresentationRecord,
  SourceLocator,
  SpecCompilation,
  Schema02FeatureContract,
} from '../../../src/spec/compiler/types.js';
import type {Feature, Spec} from '../../../src/spec/types.js';

/** Distinct shared modules the synthetic corpus spreads its features across. */
const SHARED_MODULES = 128;

/** Extra shared modules the designated hub declares, on top of the one it shares by index. */
const HUB_EXTRA_MODULES = 6;

/** One locator reused by every synthetic record; no synthetic shard exists on disk. */
const SOURCE: SourceLocator = {
  path: 'spec/features/synthetic.yaml',
  yamlPath: '$.id',
  range: {start: 0, end: 0, line: 1, column: 1},
};

/** Zero-padded synthetic feature id, matching the copied F8 generator's spelling. */
function featureId(index: number): string {
  return `F-${String(index).padStart(8, '0')}`;
}

/** Zero-padded shared-module path, so path ordering matches index ordering. */
function sharedModule(index: number): string {
  return `src/synthetic/hub-${String(index).padStart(3, '0')}.ts`;
}

/** The private module exactly one synthetic feature declares. */
function privateModule(index: number): string {
  return `src/synthetic/mod-${String(index).padStart(5, '0')}.ts`;
}

/**
 * Module paths one synthetic feature declares.
 *
 * Feature 0 is the designated hub: it declares `HUB_EXTRA_MODULES` further shared paths, so
 * its co-owner fan-out is the widest in the corpus by construction rather than by luck.
 */
export function syntheticModules(index: number): readonly string[] {
  const shared = [sharedModule(index % SHARED_MODULES)];
  if (index === 0) {
    for (let extra = 1; extra <= HUB_EXTRA_MODULES; extra++) shared.push(sharedModule(extra));
  }
  return [privateModule(index), ...new Set(shared)].sort();
}

/**
 * Builds one deterministic synthetic compilation of `count` features.
 *
 * @param count - Number of synthetic features to generate.
 * @returns A schema 0.2 compilation with a contract, artifacts, and ownership edges.
 */
export function syntheticCompilation(count: number): SpecCompilation {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const presentations: GraphPresentationRecord[] = [];
  const aliases: GraphAliasRecord[] = [];
  const features: Schema02FeatureContract[] = [];
  const artifactOwners = new Map<string, string[]>();

  for (let index = 0; index < count; index++) {
    const id = featureId(index);
    const address = `feature:${id}`;
    const criterionAddress = `criterion:${id}/AC-00000001`;
    const modules = syntheticModules(index);
    const dependsOn = index > 0 ? [featureId(index - 1)] : [];

    nodes.push({address, nodeType: 'semantic', kind: 'feature', provenance: 'authored', source: SOURCE});
    nodes.push({address: criterionAddress, nodeType: 'semantic', kind: 'criterion', provenance: 'authored', source: SOURCE});
    presentations.push({schemaVersion: '0.2', address, kind: 'feature', title: `Synthetic ${index}`, status: 'planned', purpose: `Hold synthetic feature ${index}.`, source: SOURCE});
    presentations.push({schemaVersion: '0.2', address: criterionAddress, kind: 'criterion', statement: 'The system shall hold one synthetic criterion.', source: SOURCE});
    aliases.push({alias: id, address, kind: 'feature_id', source: SOURCE});
    edges.push({address: `${address}|contains|${criterionAddress}`, from: address, to: criterionAddress, relation: 'contains', provenance: 'authored', owner: SOURCE});

    if (index > 0) {
      const prerequisite = `feature:${featureId(index - 1)}`;
      edges.push({address: `${address}|depends_on|${prerequisite}|synthetic:${index}`, from: address, to: prerequisite, relation: 'depends_on', provenance: 'authored', owner: SOURCE});
    }
    for (const modulePath of modules) {
      const artifact = `artifact:${modulePath}`;
      const owners = artifactOwners.get(modulePath) ?? [];
      owners.push(id);
      artifactOwners.set(modulePath, owners);
      edges.push({address: `${address}|touches|${artifact}`, from: address, to: artifact, relation: 'touches', provenance: 'authored', owner: SOURCE});
    }

    features.push({
      id,
      title: `Synthetic ${index}`,
      status: 'planned',
      purpose: `Hold synthetic feature ${index}.`,
      modules,
      dependsOn,
      capabilityRefs: [],
      acceptanceCriteria: [{
        id: 'AC-00000001',
        kind: 'behavior',
        statement: 'The system shall hold one synthetic criterion.',
        constraintRefs: [],
      }],
    });
  }

  for (const [modulePath, owners] of [...artifactOwners].sort((left, right) => left[0].localeCompare(right[0]))) {
    nodes.push({
      address: `artifact:${modulePath}`,
      nodeType: 'artifact',
      roles: ['source'],
      owners: [...owners].sort(),
      provenance: 'derived',
      source: SOURCE,
    });
  }

  return {
    schemaVersion: '0.2',
    nodes,
    edges,
    diagnostics: [],
    presentations,
    aliases,
    contract: {
      project: {
        name: 'synthetic',
        language: 'typescript',
        purpose: 'Measure the envelope against a five-thousand-feature graph.',
        assuranceLevel: 'L2',
        scenarioPolicy: 'advisory',
        retainedPolicies: {},
      },
      capabilities: [],
      features,
      scenarios: [],
      architecture: {layers: [['src']], rules: []},
    },
  };
}

/** The legacy presentation the consumer view resolves feature spellings through. */
function syntheticSpec(compilation: SpecCompilation): Spec {
  const features: Feature[] = (compilation.contract?.features ?? []).map((feature) => ({
    id: feature.id,
    title: feature.title,
    status: feature.status,
    modules: [...(feature.modules ?? [])],
    depends_on: [...(feature.dependsOn ?? [])],
    acceptance_criteria: feature.acceptanceCriteria.map((criterion) => ({id: criterion.id, text: criterion.statement})),
  }));
  return {
    schema: '0.2',
    project: {name: 'synthetic', language: 'typescript'},
    features,
    scenarios: [],
  };
}

/**
 * Wraps one synthetic compilation as a workspace `buildCycleContextEnvelope` accepts.
 *
 * @param compilation - A compilation from {@link syntheticCompilation}.
 * @returns A workspace whose every layer is explicitly complete; nothing was read from disk.
 */
export function syntheticWorkspace(compilation: SpecCompilation): GraphIrV2Workspace {
  return Object.freeze({
    spec: syntheticSpec(compilation),
    compilation,
    kernel: graphIrV2(compilation),
    layers: Object.freeze([Object.freeze({
      id: 'synthetic-fixture',
      completeness: 'complete' as const,
      reasons: Object.freeze([]),
    })]),
  });
}

/**
 * Picks the hub by co-ownership width, so the choice is measured and not asserted.
 *
 * Score is the number of DISTINCT other features that declare any path this feature
 * declares; ties resolve to the lowest id so the answer is stable across runs.
 *
 * @param compilation - A compilation from {@link syntheticCompilation}.
 * @returns The hub feature id and the co-owner count that won it.
 */
export function syntheticHub(compilation: SpecCompilation): {readonly feature: string; readonly coOwners: number} {
  const owners = new Map<string, string[]>();
  for (const feature of compilation.contract?.features ?? []) {
    for (const path of feature.modules ?? []) {
      const list = owners.get(path) ?? [];
      list.push(feature.id);
      owners.set(path, list);
    }
  }
  let best = {feature: '', coOwners: -1};
  for (const feature of compilation.contract?.features ?? []) {
    const peers = new Set<string>();
    for (const path of feature.modules ?? []) {
      for (const owner of owners.get(path) ?? []) if (owner !== feature.id) peers.add(owner);
    }
    if (peers.size > best.coOwners || (peers.size === best.coOwners && feature.id < best.feature)) {
      best = {feature: feature.id, coOwners: peers.size};
    }
  }
  return best;
}
