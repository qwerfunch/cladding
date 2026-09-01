// Cladding · Spec 0.2 F8 · coherent compiler/presentation workspace query.

import {graphIrV2, type GraphIrV2Kernel} from '../spec/compiler/graph-ir-v2.js';
import {compileSpecWorkspaceFromStableSnapshot} from '../spec/compiler/compile.js';
import {schema02ConsumerView} from '../spec/compiler/consumer-view.js';
import type {GraphPresentationRecord, Schema02FeatureContract, SpecCompilation} from '../spec/compiler/types.js';
import {scanDocumentFacts, type DocumentFactScan} from '../spec/doc-references.js';
import {currentSafeBindingCensus} from '../proof/current-bindings.js';
import {knownCriteriaFromCompilerView} from '../proof/vitest-jest.js';
import {loadSpecFromDiskUnlocked} from '../spec/load.js';
import {prospectiveCompilationOverlay, prospectiveSpecOverlay} from '../spec/prospective.js';
import {withStableSpecWorkspaceSnapshot} from '../spec/transaction.js';
import type {Feature, Spec} from '../spec/types.js';
import {documentFactAugmentation, workspaceFactAugmentation} from './workspace-facts.js';
import {
  scanSourceReferences,
  sourceReferenceAugmentation,
} from './source-references.js';

/**
 * One immutable presentation, compiler, and GraphIR view of a workspace.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 * @since 0.10.0
 * @internal
 */
export interface GraphIrV2Workspace {
  /** Legacy compatibility presentation from the same snapshot as `compilation`. */
  readonly spec: Spec;
  /** One compiler-owned GraphIR source snapshot. */
  readonly compilation: SpecCompilation;
  /** The memoized GraphIR kernel for exactly `compilation`. */
  readonly kernel: GraphIrV2Kernel;
}

/**
 * Reads one coherent workspace view for an internal GraphIR consumer.
 *
 * The boundary intentionally does not use the detector run cache: MCP and
 * server processes must observe a new workspace snapshot on each call.
 *
 * @param cwd - Workspace root containing the canonical `spec.yaml`.
 * @returns Frozen presentation, compilation, and GraphIR kernel from one source snapshot.
 * @throws Error when the schema, contract, or prospective overlay pair is unsafe.
 * @example
 * ```ts
 * const workspace = loadGraphIrV2Workspace(process.cwd());
 * workspace.kernel.resolveAddress('feature:F-aaaaaaaa');
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @see docs/design/spec-0.2/delivery.md#cutover-and-retirement-map
 * @since 0.10.0
 * @internal
 */
export function loadGraphIrV2Workspace(cwd: string = '.'): GraphIrV2Workspace {
  const prospectiveSpec = prospectiveSpecOverlay(cwd);
  const prospectiveCompilation = prospectiveCompilationOverlay(cwd);
  if (prospectiveSpec || prospectiveCompilation) {
    if (!prospectiveSpec || !prospectiveCompilation) {
      throw new Error('GraphIR workspace query requires matching prospective Spec and compiler overlays.');
    }
    // A completion overlay has already sealed its immutable Spec/compiler
    // pair. Documents are independent artifacts, so scan that one bounded
    // surface without probing the prospective spec disk state.
    const documents = scanDocumentFacts(cwd);
    const sourceReferences = scanSourceReferences(cwd, prospectiveCompilation);
    return createWorkspace(cwd, prospectiveSpec, prospectiveCompilation, undefined, documents, sourceReferences);
  }
  return withStableSpecWorkspaceSnapshot(cwd, () =>
    loadGraphIrV2WorkspaceFromStableSnapshot(cwd),
  );
}

/**
 * Builds a GraphIR workspace view while a caller owns a stable reader snapshot.
 *
 * @param cwd - Workspace root guarded by `withStableSpecWorkspaceSnapshot` or the F4 writer lock.
 * @returns Frozen presentation, compilation, and GraphIR kernel from the caller-owned snapshot.
 * @throws Error when the caller has not supplied a coherent schema contract.
 * @example
 * ```ts
 * const workspace = withStableSpecWorkspaceSnapshot(cwd, () =>
 *   loadGraphIrV2WorkspaceFromStableSnapshot(cwd));
 * ```
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 * @since 0.10.0
 * @internal
 */
export function loadGraphIrV2WorkspaceFromStableSnapshot(cwd: string): GraphIrV2Workspace {
  // Compile first so schema 0.2 never travels through the legacy loader's
  // independently-created compiler snapshot. Schema 0.1 retains its typed
  // compatibility reader only for presentation; GraphIR still comes solely
  // from this one compiler result.
  const compilation = compileSpecWorkspaceFromStableSnapshot(cwd);
  const census = currentSafeBindingCensus(cwd, knownCriteriaFromCompilerView(compilation.nodes));
  const documents = scanDocumentFacts(cwd);
  const sourceReferences = scanSourceReferences(cwd, compilation);
  switch (compilation.schemaVersion) {
    case '0.1':
      return createWorkspace(cwd, loadSpecFromDiskUnlocked(cwd), compilation, census, documents, sourceReferences);
    case '0.2':
      return createWorkspace(cwd, schema02ConsumerView(cwd, compilation, census), compilation, census, documents, sourceReferences);
    default:
      return assertNeverSchema(compilation.schemaVersion);
  }
}

function createWorkspace(
  cwd: string,
  spec: Spec,
  compilation: SpecCompilation,
  census = currentSafeBindingCensus(cwd, knownCriteriaFromCompilerView(compilation.nodes)),
  documents?: DocumentFactScan,
  sourceReferences = scanSourceReferences(cwd, compilation),
): GraphIrV2Workspace {
  assertMatchingWorkspacePair(spec, compilation);
  freezeDeep(spec);
  freezeDeep(compilation);
  const facts = workspaceFactAugmentation(compilation, census);
  const documentFacts = documentFactAugmentation(compilation, documents);
  const sourceFacts = sourceReferenceAugmentation(compilation, sourceReferences);
  const layers = [facts, documentFacts, sourceFacts].filter((layer) =>
    layer.completeness === 'unknown' || layer.nodes.length > 0 || layer.edges.length > 0,
  );
  const kernel = Object.freeze(layers.length === 0 ? graphIrV2(compilation) : graphIrV2(compilation, layers));
  return Object.freeze({spec, compilation, kernel});
}

function assertMatchingWorkspacePair(spec: Spec, compilation: SpecCompilation): void {
  if (spec.schema !== compilation.schemaVersion) {
    throw new Error(
      `GraphIR workspace query cannot combine Spec schema ${JSON.stringify(spec.schema)} ` +
      `with compiler schema ${JSON.stringify(compilation.schemaVersion)}.`,
    );
  }
  switch (compilation.schemaVersion) {
    case '0.1':
      assertSchema01FeatureIdentity(spec.features, compilation.presentations);
      return;
    case '0.2':
      assertSchema02ContractIdentity(spec.features, compilation);
      return;
    default:
      return assertNeverSchema(compilation.schemaVersion);
  }
}

function assertSchema01FeatureIdentity(
  features: readonly Feature[],
  presentations: readonly GraphPresentationRecord[],
): void {
  const compilerFeatures = presentations
    .filter((record) => record.schemaVersion === '0.1' && record.kind === 'feature')
    .map((record) => ({
      id: featureId(record.address),
      title: record.title,
      status: record.status,
      slug: record.slug,
    }));
  const presentationFeatures = features.map((feature) => ({
    id: feature.id,
    title: feature.title,
    status: feature.status,
    slug: feature.slug,
  }));
  if (!sameFeatureIdentity(presentationFeatures, compilerFeatures, true)) {
    throw new Error('GraphIR workspace query cannot prove schema 0.1 presentation and compiler feature identity.');
  }
}

function assertSchema02ContractIdentity(features: readonly Feature[], compilation: SpecCompilation): void {
  const blocking = compilation.diagnostics.filter((diagnostic) => diagnostic.severity !== 'advisory');
  if (!compilation.contract || blocking.length > 0) {
    throw new Error('GraphIR workspace query requires a complete schema 0.2 compiler contract.');
  }
  const contractFeatures = compilation.contract.features.map((feature) => ({
    id: feature.id,
    title: feature.title,
    status: feature.status,
    slug: undefined,
  }));
  const presentationFeatures = features.map((feature) => ({
    id: feature.id,
    title: feature.title,
    status: feature.status,
    slug: feature.slug,
  }));
  if (!sameFeatureIdentity(presentationFeatures, contractFeatures)) {
    throw new Error('GraphIR workspace query cannot prove schema 0.2 presentation and compiler contract identity.');
  }
  if (!sameSchema02FeatureStructure(features, compilation.contract.features)) {
    throw new Error('GraphIR workspace query cannot prove schema 0.2 presentation and compiler contract structure.');
  }
  const graphPresentations = compilation.presentations
    .filter((record) => record.schemaVersion === '0.2' && record.kind === 'feature')
    .map((record) => ({
      id: featureId(record.address),
      title: record.title,
      status: record.status,
      slug: record.slug,
    }));
  if (!sameFeatureIdentity(presentationFeatures, graphPresentations, true)) {
    throw new Error('GraphIR workspace query cannot prove schema 0.2 presentation and GraphIR feature identity.');
  }
  const contractAddresses = compilation.contract.features.map((feature) => `feature:${feature.id}`);
  const graphAddresses = compilation.nodes
    .filter((node) => node.nodeType === 'semantic' && node.kind === 'feature')
    .map((node) => node.address);
  if (!sameSortedValues(contractAddresses, graphAddresses)) {
    throw new Error('GraphIR workspace query cannot prove schema 0.2 contract and GraphIR feature identity.');
  }
}

function sameSchema02FeatureStructure(
  presentationFeatures: readonly Feature[],
  contractFeatures: readonly Schema02FeatureContract[],
): boolean {
  if (presentationFeatures.length !== contractFeatures.length) return false;
  const presentationById = new Map(presentationFeatures.map((feature) => [feature.id, feature]));
  if (presentationById.size !== presentationFeatures.length) return false;
  for (const contractFeature of contractFeatures) {
    const presentation = presentationById.get(contractFeature.id);
    if (!presentation || !sameCanonicalValue(
      schema02PresentationFeatureStructure(presentation),
      schema02ContractFeatureStructure(contractFeature),
    )) return false;
  }
  return true;
}

function schema02PresentationFeatureStructure(feature: Feature): object {
  return {
    id: feature.id,
    title: feature.title,
    status: feature.status,
    modules: feature.modules ?? null,
    dependsOn: feature.depends_on ?? null,
    designImpact: feature.design_impact ?? null,
    archivedAt: feature.archived_at ?? null,
    archiveReason: feature.archive_reason ?? null,
    supersededBy: feature.superseded_by ?? null,
    blockedReason: feature.blocked_reason ?? null,
    criteria: (feature.acceptance_criteria ?? []).map((criterion) => ({
      id: criterion.id,
      statement: criterion.text ?? null,
      oracleRefs: criterion.oracle_refs ?? null,
      evidenceRefs: criterion.evidence_refs ?? null,
      notes: criterion.notes ?? null,
    })),
  };
}

function schema02ContractFeatureStructure(feature: Schema02FeatureContract): object {
  return {
    id: feature.id,
    title: feature.title,
    status: feature.status,
    modules: feature.modules ?? null,
    dependsOn: feature.dependsOn ?? null,
    designImpact: feature.designImpact ?? null,
    archivedAt: feature.archivedAt ?? null,
    archiveReason: feature.archiveReason ?? null,
    supersededBy: feature.supersededBy ?? null,
    blockedReason: feature.blockedReason ?? null,
    criteria: feature.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      oracleRefs: criterion.oracleRefs ?? null,
      evidenceRefs: criterion.evidenceRefs ?? null,
      notes: criterion.notes ?? null,
    })),
  };
}

/**
 * Compares the compatibility fields that the schema 0.2 compiler owns.
 *
 * `test_refs` stay outside this pair invariant because `schema02ConsumerView`
 * derives them from the F5 live/reviewed binding channel, not from the compiler
 * contract. `constraint_refs` are likewise absent from the legacy `Spec` wire;
 * GraphIR retains both sources directly from the compilation.
 */
function sameCanonicalValue(left: object, right: object): boolean {
  return canonicalValue(left) === canonicalValue(right);
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalValue(record[key])}`).join(',')}}`;
}

function featureId(address: string): string {
  if (!address.startsWith('feature:')) {
    throw new Error(`GraphIR workspace query found a non-feature presentation address: ${address}`);
  }
  return address.slice('feature:'.length);
}

function sameFeatureIdentity(
  left: readonly {readonly id: string; readonly title: string; readonly status: string; readonly slug?: string}[],
  right: readonly {readonly id: string; readonly title?: string; readonly status?: string; readonly slug?: string}[],
  includeSlug: boolean = false,
): boolean {
  const normalize = (features: readonly {readonly id: string; readonly title?: string; readonly status?: string; readonly slug?: string}[]) =>
    [...features]
      .sort((first, second) => first.id.localeCompare(second.id))
      .map((feature) => [
        feature.id,
        feature.title ?? '',
        feature.status ?? '',
        ...(includeSlug ? [feature.slug ?? ''] : []),
      ].join('\u0000'));
  return sameSortedValues(normalize(left), normalize(right));
}

function sameSortedValues(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function assertNeverSchema(schema: never): never {
  throw new Error(`GraphIR workspace query does not recognize workspace schema ${JSON.stringify(schema)}.`);
}

function freezeDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    freezeDeep(Reflect.get(value, key), seen);
  }
  Object.freeze(value);
}
