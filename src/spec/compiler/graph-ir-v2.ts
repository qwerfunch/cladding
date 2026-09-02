// Cladding · Spec 0.2 F8 · compiler-owned directed GraphIR query kernel.

import {anchorAddress, artifactAddress, parseAnchorAddress} from './graph-address.js';
import type {
  ArtifactRole,
  CompilerCorpusView,
  CorpusProofRecord,
  GraphAliasRecord,
  GraphEdge,
  GraphNode,
  GraphPresentationRecord,
  GraphRelation,
  GraphState,
  LegacyReferenceChannel,
  SourceLocator,
  SpecCompilation,
} from './types.js';

/** Completeness status that prevents an incomplete query from looking empty and safe. */
export type GraphQueryCompleteness = 'complete' | 'bounded' | 'unresolved' | 'unknown';

/** Direction is always relative to the authored edge orientation. */
export type GraphDirection = 'outbound' | 'inbound';

/** A caller-selected relation and direction; there is deliberately no default-all rule. */
export interface GraphProjectionRule {
  /** Relation to traverse. */
  readonly relation: GraphRelation;
  /** Whether traversal follows or reverses the relation's authored orientation. */
  readonly direction: GraphDirection;
}

/** Bounded directed projection request. */
export interface GraphProjectionRequest {
  /** Canonical or explicitly resolvable seeds; every unsafe seed remains visible in the result. */
  readonly seeds: readonly string[];
  /** Explicit finite traversal rules; an omitted rule can never become an undirected walk. */
  readonly rules: readonly GraphProjectionRule[];
  /** Maximum number of relation hops from each seed. */
  readonly maxHops: number;
  /** Maximum materialized nodes, including resolved seeds. */
  readonly maxNodes: number;
  /** Maximum materialized edges. */
  readonly maxEdges: number;
}

/** Exact address-resolution status, including ambiguous and noncanonical spellings. */
export type GraphAddressResolution =
  | {
    readonly state: 'resolved';
    readonly input: string;
    readonly canonical: string;
    readonly via: 'canonical' | 'feature_id' | 'feature_slug' | 'path' | 'anchor';
  }
  | {
    readonly state: 'unresolved';
    readonly input: string;
    readonly form: 'canonical' | 'path' | 'anchor' | 'noncanonical';
    readonly reason: string;
    readonly canonical?: string;
  }
  | {
    readonly state: 'ambiguous';
    readonly input: string;
    readonly candidates: readonly string[];
    readonly reason: string;
  };

/** A result and the reasons that make it anything other than complete. */
export interface GraphQueryResult<T> {
  /** Deterministically sorted records. */
  readonly records: readonly T[];
  /** Explicit status, never inferred from an empty array. */
  readonly completeness: GraphQueryCompleteness;
  /** Stable reasons for an incomplete result. */
  readonly reasons: readonly string[];
  /** Exact resolution results for supplied query input. */
  readonly resolutions: readonly GraphAddressResolution[];
}

/** Result of a finite, caller-directed GraphIR traversal. */
export interface GraphProjection extends Omit<GraphQueryResult<never>, 'records'> {
  /** Nodes selected before a bound would be exceeded. */
  readonly nodes: readonly GraphIrV2Node[];
  /** Edges selected before a bound would be exceeded. */
  readonly edges: readonly GraphIrV2Edge[];
}

/** A runtime source locator intentionally distinct from authored YAML source locations. */
export interface GraphObservationLocator {
  /** Discriminator prevents observed data from pretending to be authored YAML. */
  readonly kind: 'runtime_observation';
  /** Registered future adapter identity. */
  readonly adapter: string;
  /** Adapter-owned stable fact location, such as a receipt digest or runner case id. */
  readonly reference: string;
}

/** A non-YAML source location for an authored or compiler-derived graph fact. */
export interface GraphTextSourceLocator {
  /** Discriminator keeps source-text facts separate from YAML and runtime observations. */
  readonly kind: 'text_source';
  /** Canonical repository-relative text artifact path. */
  readonly path: string;
  /** Exact carrier selector when the source declaration has one. */
  readonly selector?: string;
}

/** A non-YAML structural artifact fact supplied by a static adapter. */
export interface GraphIrV2StructuralArtifactFact {
  /** Canonical artifact address; static adapters cannot introduce a second identity grammar. */
  readonly address: string;
  /** Static facts use the existing physical artifact taxonomy. */
  readonly nodeType: 'artifact';
  /** Roles contributed by this fact without creating kind twins. */
  readonly roles: readonly ArtifactRole[];
  /** Every feature owner contributed by this fact. */
  readonly owners: readonly string[];
  /** Static facts remain authored or derived, never runtime observations. */
  readonly provenance: 'authored' | 'derived';
  /** Typed text-source location for the non-YAML fact. */
  readonly locator: GraphTextSourceLocator;
}

/** A non-YAML structural anchor fact supplied by a static adapter. */
export interface GraphIrV2StructuralAnchorFact {
  /** Canonical anchor address. */
  readonly address: string;
  /** Static facts use the existing physical anchor taxonomy. */
  readonly nodeType: 'anchor';
  /** Canonical artifact address containing this anchor. */
  readonly artifact: string;
  /** Exact stable selector on the artifact. */
  readonly selector: string;
  /** Whether the exact selector is source-authored or adapter-derived. */
  readonly selectorProvenance: 'authored' | 'derived';
  /** Static facts remain authored or derived, never runtime observations. */
  readonly provenance: 'authored' | 'derived';
  /** Typed text-source location for the non-YAML fact. */
  readonly locator: GraphTextSourceLocator;
}

/** A future observed artifact fact using the existing canonical artifact taxonomy. */
export interface GraphIrV2ObservedArtifactFact {
  /** Canonical artifact address; future adapters cannot introduce a second identity grammar. */
  readonly address: string;
  /** The existing physical node category; observation remains fact provenance. */
  readonly nodeType: 'artifact';
  /** Roles retained by a future adapter without kind-twin identities. */
  readonly roles: readonly ArtifactRole[];
  /** Future observed artifacts may have no semantic owner. */
  readonly owners: readonly string[];
  /** F5 facts must remain distinguishable from authored and derived facts. */
  readonly provenance: 'observed';
  /** Typed non-YAML location for the observation. */
  readonly locator: GraphObservationLocator;
}

/** A future observed anchor fact using the existing canonical anchor taxonomy. */
export interface GraphIrV2ObservedAnchorFact {
  /** Canonical anchor address. */
  readonly address: string;
  /** The existing physical node category; observation remains fact provenance. */
  readonly nodeType: 'anchor';
  /** Canonical artifact address that contains this anchor. */
  readonly artifact: string;
  /** Exact stable selector on the artifact. */
  readonly selector: string;
  /** Runtime adapters retain whether their selector was authored or derived. */
  readonly selectorProvenance: 'authored' | 'derived';
  /** F5 facts must remain distinguishable from authored and derived facts. */
  readonly provenance: 'observed';
  /** Typed non-YAML location for the observation. */
  readonly locator: GraphObservationLocator;
}

/** A future observed edge that cannot collapse into an authored carrier edge. */
export interface GraphIrV2ObservationEdge {
  /** Layer-local stable identity; conflicting reuse fails closed. */
  readonly identity: string;
  /** Canonical source endpoint. */
  readonly from: string;
  /** Canonical target endpoint. */
  readonly to: string;
  /** Directed GraphIR relation. */
  readonly relation: GraphRelation;
  /** F5 observations are never rewritten as authored declarations. */
  readonly provenance: 'observed';
  /** Typed non-YAML fact owner. */
  readonly owner: GraphObservationLocator;
  /** Runtime result state. */
  readonly state: GraphState;
  /** Legacy proof channel retained verbatim; it never upgrades the fact's provenance. */
  readonly channel?: LegacyReferenceChannel;
  /** Optional source-carrier detail retained by a future adapter. */
  readonly raw?: string;
  /** Optional canonical target detail retained by a future adapter. */
  readonly normalizedTarget?: string;
  /** Optional exact selector detail retained by a future adapter. */
  readonly selector?: GraphEdge['selector'];
}

/** A non-YAML authored or derived structural relation. */
export interface GraphIrV2StructuralEdge {
  /** Layer-local stable identity; conflicting reuse fails closed. */
  readonly identity: string;
  /** Canonical source endpoint. */
  readonly from: string;
  /** Canonical target endpoint. */
  readonly to: string;
  /** Directed GraphIR relation. */
  readonly relation: GraphRelation;
  /** Structural facts never masquerade as observed runtime results. */
  readonly provenance: 'authored' | 'derived';
  /** Typed non-YAML source owner. */
  readonly owner: GraphTextSourceLocator;
  /** Structural address resolution, never a pass/fail assertion. */
  readonly state: 'resolved' | 'unresolved';
  /** Exact source spelling retained for diagnosis. */
  readonly raw?: string;
  /** Optional canonical target detail retained by a static adapter. */
  readonly normalizedTarget?: string;
  /** Optional exact source selector detail retained by a static adapter. */
  readonly selector?: GraphEdge['selector'];
}

/** One future static or observed fact layer supplied explicitly by an adapter. */
export interface GraphIrV2Augmentation {
  /** Unique adapter/layer identity. */
  readonly layerId: string;
  /** Canonically addressed physical facts supplied by that layer. */
  readonly nodes: readonly GraphIrV2AugmentationNode[];
  /** Provenance-preserving relations supplied by that layer. */
  readonly edges: readonly GraphIrV2AugmentationEdge[];
  /** The adapter's explicit knowledge state. */
  readonly completeness: 'complete' | 'unknown';
  /** Reasons required when the adapter cannot make a complete assertion. */
  readonly unknownReasons: readonly string[];
}

/** One non-compiler physical fact on the existing GraphIR node taxonomies. */
export type GraphIrV2AugmentationNode =
  | GraphIrV2StructuralArtifactFact
  | GraphIrV2StructuralAnchorFact
  | GraphIrV2ObservedArtifactFact
  | GraphIrV2ObservedAnchorFact;

/** One non-compiler relation with explicit static or observed provenance. */
export type GraphIrV2AugmentationEdge = GraphIrV2StructuralEdge | GraphIrV2ObservationEdge;

/** A compiler node or a future fact on the same three node taxonomies. */
export type GraphIrV2Node = GraphNode | GraphIrV2AugmentationNode;

/** A compiler edge or a future static/observed edge. */
export type GraphIrV2Edge = GraphEdge | GraphIrV2AugmentationEdge;

type PrerequisiteRecord = CompilerCorpusView['prerequisites'][number];
type DependentRecord = CompilerCorpusView['dependents'][number];
type ArtifactOwnerRecord = CompilerCorpusView['artifactOwners'][number];

/** Immutable compiler-owned GraphIR query operations. */
export interface GraphIrV2Kernel {
  nodes(): readonly GraphIrV2Node[];
  edges(): readonly GraphIrV2Edge[];
  presentationRecords(): readonly GraphPresentationRecord[];
  aliasRecords(): readonly GraphAliasRecord[];
  resolveAddress(input: string): GraphAddressResolution;
  project(request: GraphProjectionRequest): GraphProjection;
  prerequisites(input: string, maxHops?: number): GraphQueryResult<PrerequisiteRecord>;
  dependents(input: string, maxHops?: number): GraphQueryResult<DependentRecord>;
  artifactOwners(input: string): GraphQueryResult<ArtifactOwnerRecord>;
  criterionProofs(input: string): GraphQueryResult<GraphIrV2Edge>;
  regressions(input: string): GraphQueryResult<CorpusProofRecord>;
  corpusRecords(): CompilerCorpusView;
}

const BASE_INDEX = new WeakMap<SpecCompilation, GraphIrV2Index>();

const ARTIFACT_ROLES: ReadonlySet<ArtifactRole> = new Set([
  'spec', 'doc', 'source', 'test', 'oracle', 'evidence', 'skill', 'generated',
]);

const LEGACY_REFERENCE_CHANNELS: ReadonlySet<LegacyReferenceChannel> = new Set(['test', 'oracle', 'evidence']);

const GRAPH_STATES: ReadonlySet<GraphState> = new Set([
  'resolved', 'unresolved', 'passed', 'failed', 'skipped', 'stale', 'unknown', 'unobserved',
]);

type GraphEndpointTaxonomy =
  | 'artifact'
  | 'anchor'
  | 'feature'
  | 'criterion'
  | 'capability'
  | 'scenario'
  | 'architecture_rule'
  | 'project';

/**
 * The relation vocabulary is directional and closed over the compiler's three
 * node taxonomies. Runtime facts can add evidence, never a new graph grammar.
 *
 * @see docs/design/spec-0.2/graph.md#d17--knowledge-graph-v2-as-compiler-ir
 */
const RELATION_ENDPOINTS: ReadonlyMap<GraphRelation, readonly [
  readonly GraphEndpointTaxonomy[],
  readonly GraphEndpointTaxonomy[],
]> = new Map([
  ['contains', [['feature'], ['criterion']]],
  ['defined_in', [['feature', 'criterion', 'capability', 'scenario', 'architecture_rule', 'project'], ['artifact']]],
  ['contributes_to', [['feature'], ['capability']]],
  ['depends_on', [['feature'], ['feature']]],
  ['participates_in', [['scenario'], ['feature']]],
  ['touches', [['feature'], ['artifact']]],
  ['constrained_by', [['criterion'], ['architecture_rule']]],
  ['covers', [['anchor'], ['criterion']]],
  ['supports', [['criterion'], ['artifact', 'anchor']]],
  ['traces_to', [['anchor'], ['criterion']]],
  ['explains', [['artifact', 'anchor'], ['feature', 'criterion', 'capability', 'scenario', 'architecture_rule', 'project']]],
  ['mentions', [['artifact', 'anchor'], ['feature', 'criterion', 'capability', 'scenario', 'architecture_rule', 'project']]],
  ['links_to', [['artifact', 'anchor'], ['artifact', 'anchor']]],
]);

const RELATIONS: ReadonlySet<GraphRelation> = new Set(RELATION_ENDPOINTS.keys());

/**
 * Returns the compiler-owned, memoized GraphIR v2 query kernel for one compilation.
 *
 * @param compilation - One immutable compiler snapshot; identity scopes base-index memoization.
 * @param augmentations - Future static or observed fact layers, supplied explicitly rather than read from disk.
 * @returns Immutable directed query operations over that snapshot.
 * @throws Error for conflicting future-layer ids, node addresses, or edge identities.
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-4f8c2542
 */
export function graphIrV2(
  compilation: SpecCompilation,
  augmentations: readonly GraphIrV2Augmentation[] = [],
): GraphIrV2Kernel {
  let base = BASE_INDEX.get(compilation);
  if (!base) {
    base = new GraphIrV2Index(compilation.nodes, compilation.edges, compilation.presentations, compilation.aliases, []);
    BASE_INDEX.set(compilation, base);
  }
  return augmentations.length === 0 ? base : base.withAugmentations(augmentations);
}

/** The index owns every join so compiler consumers cannot recreate directed graph views. */
class GraphIrV2Index implements GraphIrV2Kernel {
  private readonly nodeByAddress: ReadonlyMap<string, GraphIrV2Node>;
  private readonly allNodes: readonly GraphIrV2Node[];
  private readonly allEdges: readonly GraphIrV2Edge[];
  private readonly baseNodes: readonly GraphNode[];
  private readonly baseEdges: readonly GraphEdge[];
  private readonly outbound: ReadonlyMap<string, readonly GraphIrV2Edge[]>;
  private readonly inbound: ReadonlyMap<string, readonly GraphIrV2Edge[]>;
  private readonly presentations: readonly GraphPresentationRecord[];
  private readonly aliases: readonly GraphAliasRecord[];
  private readonly aliasTargets: ReadonlyMap<string, readonly GraphAliasRecord[]>;
  private readonly layerUnknownReasons: readonly string[];

  constructor(
    nodes: readonly GraphIrV2Node[],
    edges: readonly GraphIrV2Edge[],
    presentations: readonly GraphPresentationRecord[],
    aliases: readonly GraphAliasRecord[],
    layerUnknownReasons: readonly string[],
    baseNodes: readonly GraphNode[] = nodes.filter(isBaseNode),
    baseEdges: readonly GraphEdge[] = edges.filter(isBaseEdge),
  ) {
    this.nodeByAddress = indexByIdentity(nodes, (node) => node.address, 'node address');
    // Computed once with the index so a full enumeration never re-sorts, and
    // never depends on the caller's supplied array order.
    this.allNodes = freezeRecords(sortBy([...this.nodeByAddress.values()], (node) => node.address));
    this.allEdges = uniqueEdges(edges);
    this.baseNodes = freezeRecords(sortBy([...indexByIdentity(baseNodes, (node) => node.address, 'base node address').values()], (node) => node.address));
    this.baseEdges = freezeRecords(sortBy([...indexByIdentity(baseEdges, (edge) => edge.address, 'base edge identity').values()], (edge) => edge.address));
    this.outbound = edgeIndex(this.allEdges, 'from');
    this.inbound = edgeIndex(this.allEdges, 'to');
    this.presentations = freezeRecords(sortBy(presentations, recordKey));
    this.aliases = freezeRecords(sortBy(aliases, recordKey));
    this.aliasTargets = aliasIndex(this.aliases);
    this.layerUnknownReasons = freezeRecords([...new Set(layerUnknownReasons)].sort());
    Object.freeze(this);
  }

  /** Adds explicit fact layers without allowing them to mutate the memoized base index. */
  withAugmentations(augmentations: readonly GraphIrV2Augmentation[]): GraphIrV2Index {
    const layerIds = new Set<string>();
    const nodes: GraphIrV2AugmentationNode[] = [];
    const edges: GraphIrV2AugmentationEdge[] = [];
    const unknownReasons: string[] = [];
    for (const suppliedLayer of augmentations) {
      const layer = copyFrozen(suppliedLayer);
      assertAugmentationLayer(layer);
      if (layerIds.has(layer.layerId)) throw new Error(`GraphIR augmentation layer id is not unique: ${layer.layerId}`);
      layerIds.add(layer.layerId);
      nodes.push(...layer.nodes);
      edges.push(...layer.edges);
      if (layer.completeness === 'unknown') {
        unknownReasons.push(...layer.unknownReasons.map((reason) => `${layer.layerId}: ${reason}`));
      }
    }
    for (const node of nodes) assertAugmentationNode(node);
    const combinedNodes = mergeAugmentationNodes(this.nodeByAddress, nodes);
    for (const node of nodes) assertAugmentationNodeReferences(node, combinedNodes);
    for (const edge of edges) assertAugmentationEdge(edge, combinedNodes);
    return new GraphIrV2Index(
      [...combinedNodes.values()],
      [...this.allEdges, ...edges],
      this.presentations,
      this.aliases,
      [...this.layerUnknownReasons, ...unknownReasons],
      this.baseNodes,
      this.baseEdges,
    );
  }

  /**
   * Returns every compiler and augmentation node this kernel holds.
   *
   * A traversal from compiler-owned seeds cannot reach an augmentation node
   * that carries no edge to a compiler node, so a caller that needs the whole
   * corpus enumerates it here instead of reporting a walk it cannot complete.
   */
  nodes(): readonly GraphIrV2Node[] {
    return this.allNodes;
  }

  /** Returns every compiler and augmentation edge in deterministic identity order. */
  edges(): readonly GraphIrV2Edge[] {
    return this.allEdges;
  }

  /** Returns compiler records in source-derived deterministic order. */
  presentationRecords(): readonly GraphPresentationRecord[] {
    return this.presentations;
  }

  /** Returns source-derived aliases so external callers can inspect collision candidates. */
  aliasRecords(): readonly GraphAliasRecord[] {
    return this.aliases;
  }

  /** Resolves one canonical address, feature id/slug, normalized path, or exact anchor without guessing. */
  resolveAddress(input: string): GraphAddressResolution {
    // An anchor selector is an exact identity component; trimming would silently
    // convert a distinct selector into a different canonical address.
    const spelling = input;
    // Case-sensitive on purpose: a criterion id is authored `AC-<digits|lowercase hex>`
    // (spec/schema.json), so a lowercase `ac-…` spelling is a feature slug, not a bare
    // criterion id. A case-insensitive test refused real slugs — cladding-self carries
    // `ac-hash-ids` — and a refused slug is a silently missing consumer answer.
    if (/^AC-[^\s/]+$/.test(spelling)) {
      return freeze({state: 'unresolved', input, form: 'noncanonical', reason: 'bare criterion ids are noncanonical and are never guessed'});
    }
    const candidates = new Map<string, GraphAddressResolution['state'] extends never ? never : 'canonical' | 'feature_id' | 'feature_slug' | 'path' | 'anchor'>();
    const addCandidate = (address: string, via: 'canonical' | 'feature_id' | 'feature_slug' | 'path' | 'anchor'): void => {
      if (this.nodeByAddress.has(address)) candidates.set(address, via);
    };

    const canonical = normalizeCanonicalSpelling(spelling);
    if (canonical) addCandidate(canonical.address, canonical.via);
    for (const alias of this.aliasTargets.get(spelling) ?? []) addCandidate(alias.address, alias.kind);
    const rawPhysical = normalizeRawPhysicalSpelling(spelling);
    if (rawPhysical) addCandidate(rawPhysical.address, rawPhysical.via);

    const addresses = [...candidates.keys()].sort();
    if (addresses.length === 1) {
      const address = addresses[0];
      return freeze({state: 'resolved', input, canonical: address, via: candidates.get(address) ?? 'canonical'});
    }
    if (addresses.length > 1) {
      return freeze({state: 'ambiguous', input, candidates: freezeRecords(addresses), reason: 'more than one canonical address matches this spelling'});
    }
    if (canonical) {
      return freeze({state: 'unresolved', input, form: canonical.form, canonical: canonical.address, reason: 'canonical address is absent from this compilation'});
    }
    if (rawPhysical) {
      return freeze({state: 'unresolved', input, form: rawPhysical.form, canonical: rawPhysical.address, reason: 'normalized physical address is absent from this compilation'});
    }
    return freeze({state: 'unresolved', input, form: 'noncanonical', reason: 'input is not a canonical address, feature id, feature slug, path, or exact anchor'});
  }

  /** Returns authored prerequisite edges in feature-to-prerequisite orientation. */
  prerequisites(input: string, maxHops: number = 1): GraphQueryResult<PrerequisiteRecord> {
    validateBound('maxHops', maxHops);
    const resolution = this.resolveAddress(input);
    const address = resolvedAddress(resolution);
    if (!address) return this.unresolvedResult<PrerequisiteRecord>(resolution);
    const walk = this.directedWalk(address, [{relation: 'depends_on', direction: 'outbound'}], maxHops);
    const records = walk.edges
      .filter(isBaseEdge)
      .filter((edge) => edge.provenance === 'authored')
      .map((edge) => ({feature: edge.from, prerequisite: edge.to, source: edge.owner}));
    return this.result(records, [resolution], walk.unknownReasons);
  }

  /** Returns direct dependents by traversing the inverse of feature-to-prerequisite edges. */
  dependents(input: string, maxHops: number = 1): GraphQueryResult<DependentRecord> {
    validateBound('maxHops', maxHops);
    const resolution = this.resolveAddress(input);
    const address = resolvedAddress(resolution);
    if (!address) return this.unresolvedResult<DependentRecord>(resolution);
    const walk = this.directedWalk(address, [{relation: 'depends_on', direction: 'inbound'}], maxHops);
    const records = walk.edges
      .filter(isBaseEdge)
      .filter((edge) => edge.provenance === 'authored')
      .map((edge) => ({feature: edge.to, dependent: edge.from, source: edge.owner}));
    return this.result(records, [resolution], walk.unknownReasons);
  }

  /** Returns every owner of one artifact; an existing unowned artifact is explicitly unknown. */
  artifactOwners(input: string): GraphQueryResult<ArtifactOwnerRecord> {
    const resolution = this.resolveAddress(input);
    const address = resolvedAddress(resolution);
    if (!address) return this.unresolvedResult<ArtifactOwnerRecord>(resolution);
    const node = this.nodeByAddress.get(address);
    if (!node || node.nodeType !== 'artifact') {
      return this.result([], [resolution], ['resolved input is not an artifact']);
    }
    if (node.owners.length === 0) return this.result([], [resolution], [`artifact has no known owner: ${address}`]);
    return this.result([{artifact: address, owners: node.owners}], [resolution], []);
  }

  /** Returns supports and inbound covers without allowing declarations to impersonate observations. */
  criterionProofs(input: string): GraphQueryResult<GraphIrV2Edge> {
    const resolution = this.resolveAddress(input);
    const address = resolvedAddress(resolution);
    if (!address) return this.unresolvedResult<GraphIrV2Edge>(resolution);
    const supports = this.outboundRecords(address, 'supports');
    const covers = this.inboundRecords(address, 'covers');
    const records = uniqueEdges([...supports, ...covers]);
    const reasons = this.edgeReasons(records);
    if (records.length === 0) reasons.push(`criterion has no authored supports or covers: ${address}`);
    if (records.some((edge) => edge.provenance !== 'observed')
      && !records.some((edge) => edge.provenance === 'observed' && (edge.relation === 'covers' || edge.relation === 'supports'))) {
      reasons.push(`criterion has authored proof declarations but no observed proof fact: ${address}`);
    }
    return this.result(records, [resolution], reasons);
  }

  /** Returns authored test-channel supports as regression facts, preserving every reference field. */
  regressions(input: string): GraphQueryResult<CorpusProofRecord> {
    const resolution = this.resolveAddress(input);
    const address = resolvedAddress(resolution);
    if (!address) return this.unresolvedResult<CorpusProofRecord>(resolution);
    const node = this.nodeByAddress.get(address);
    const criterionAddresses = node?.nodeType === 'semantic' && node.kind === 'feature'
      ? this.outboundRecords(address, 'contains').map((edge) => edge.to)
      : node?.nodeType === 'semantic' && node.kind === 'criterion' ? [address] : [];
    if (criterionAddresses.length === 0) {
      return this.result([], [resolution], [`resolved input has no contained criteria: ${address}`]);
    }
    const proofEdges = criterionAddresses.flatMap((criterion) => this.outboundRecords(criterion, 'supports'));
    const records = proofEdges
      .filter(isBaseEdge)
      .filter(isAuthoredProofEdge)
      .filter((edge) => edge.channel === 'test')
      .map(toProofRecord);
    const reasons = this.edgeReasons(proofEdges);
    if (records.length === 0) reasons.push(`input has no authored test regression references: ${address}`);
    return this.result(records, [resolution], reasons);
  }

  /** Performs a finite projection only along caller-selected relation directions. */
  project(request: GraphProjectionRequest): GraphProjection {
    validateProjectionRequest(request);
    const resolutions = request.seeds.map((seed) => this.resolveAddress(seed));
    const unresolved = resolutions.filter((resolution) => resolution.state !== 'resolved');
    if (unresolved.length > 0) {
      return freeze({
        nodes: freezeRecords([]), edges: freezeRecords([]), completeness: 'unresolved',
        reasons: freezeRecords(unresolved.map(resolutionReason).sort()), resolutions: freezeRecords(resolutions),
      });
    }
    const seedAddresses = [...new Set(resolutions.map((resolution) => resolvedAddress(resolution)).filter((address): address is string => address !== undefined))];
    if (request.maxNodes < seedAddresses.length) {
      throw new Error('GraphIR maxNodes cannot exclude a required resolved seed');
    }
    const selectedNodes = new Map<string, GraphIrV2Node>();
    const selectedEdges = new Map<string, GraphIrV2Edge>();
    const queue: Array<{readonly address: string; readonly hops: number}> = [];
    const boundedReasons: string[] = [];
    const unknownReasons: string[] = [];
    let bounded = false;
    for (const resolution of resolutions) {
      const address = resolvedAddress(resolution);
      if (!address) continue;
      const node = this.nodeByAddress.get(address);
      if (!node) {
        unknownReasons.push(`resolved seed has no node: ${address}`);
        continue;
      }
      if (!selectedNodes.has(address)) {
        if (selectedNodes.size >= request.maxNodes) {
          bounded = true;
          boundedReasons.push(`node bound reached before seed: ${address}`);
          continue;
        }
        selectedNodes.set(address, node);
        queue.push({address, hops: 0});
      }
    }
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current.hops >= request.maxHops) continue;
      for (const edge of this.nextEdges(current.address, request.rules)) {
        const rule = request.rules.find((candidate) => {
          if (candidate.relation !== edge.relation) return false;
          return candidate.direction === 'outbound' ? edge.from === current.address : edge.to === current.address;
        });
        if (!rule) continue;
        const identity = edgeIdentity(edge);
        if (selectedEdges.has(identity)) continue;
        if (selectedEdges.size >= request.maxEdges) {
          bounded = true;
          boundedReasons.push(`edge bound reached at ${identity}`);
          continue;
        }
        const next = rule.direction === 'outbound' ? edge.to : edge.from;
        const nextNode = this.nodeByAddress.get(next);
        if (!nextNode) {
          unknownReasons.push(`edge endpoint is absent: ${identity}`);
          continue;
        }
        if (!selectedNodes.has(next)) {
          if (selectedNodes.size >= request.maxNodes) {
            bounded = true;
            boundedReasons.push(`node bound reached at ${next}`);
            continue;
          }
          selectedNodes.set(next, nextNode);
          queue.push({address: next, hops: current.hops + 1});
        }
        selectedEdges.set(identity, edge);
      }
    }
    const completeness = resultCompleteness(unknownReasons, bounded, this.layerUnknownReasons);
    return freeze({
      nodes: freezeRecords(sortBy([...selectedNodes.values()], (node) => node.address)),
      edges: freezeRecords(sortBy([...selectedEdges.values()], edgeIdentity)),
      completeness,
      reasons: freezeRecords([...new Set([...boundedReasons, ...unknownReasons, ...this.layerUnknownReasons])].sort()),
      resolutions: freezeRecords(resolutions),
    });
  }

  /** Reconstructs the legacy parity view solely from this compiler-owned query index. */
  corpusRecords(): CompilerCorpusView {
    const semanticOwners = this.baseNodes
      .filter((node): node is Extract<GraphNode, {readonly nodeType: 'semantic'}> => node.nodeType === 'semantic')
      .map((node) => ({
        address: node.address,
        owner: node.kind === 'criterion' ? `feature:${node.address.slice('criterion:'.length).split('/')[0]}` : node.address,
        source: node.source,
      }));
    const featureAddresses = this.baseNodes
      .filter((node): node is Extract<GraphNode, {readonly nodeType: 'semantic'}> => node.nodeType === 'semantic' && node.kind === 'feature')
      .map((node) => node.address);
    const prerequisiteEdges = uniqueEdges(featureAddresses.flatMap((address) => this.directedWalk(
      address, [{relation: 'depends_on', direction: 'outbound'}], 1,
    ).edges)).filter(isBaseEdge);
    const dependentEdges = uniqueEdges(featureAddresses.flatMap((address) => this.directedWalk(
      address, [{relation: 'depends_on', direction: 'inbound'}], 1,
    ).edges)).filter(isBaseEdge);
    const prerequisites = prerequisiteEdges
      .filter((edge) => edge.provenance === 'authored')
      .map((edge) => ({feature: edge.from, prerequisite: edge.to, source: edge.owner}));
    const dependents = dependentEdges
      .filter((edge) => edge.provenance === 'authored')
      .map((edge) => ({feature: edge.to, dependent: edge.from, source: edge.owner}));
    const artifactOwners = this.baseNodes
      .filter((node): node is Extract<GraphNode, {readonly nodeType: 'artifact'}> => node.nodeType === 'artifact' && node.owners.length > 0)
      .map((node) => ({artifact: node.address, owners: node.owners}));
    const proofs = this.baseEdges.filter(isAuthoredProofEdge).map(toProofRecord);
    return freeze({
      semanticOwners: freezeRecords(sortParityRecords(semanticOwners)),
      prerequisites: freezeRecords(sortParityRecords(prerequisites)),
      dependents: freezeRecords(sortParityRecords(dependents)),
      artifactOwners: freezeRecords(sortParityRecords(artifactOwners)),
      proofs: freezeRecords(sortParityRecords(proofs)),
      regressions: freezeRecords(sortParityRecords(proofs.filter((proof) => proof.channel === 'test'))),
    });
  }

  private unresolvedResult<T>(resolution: GraphAddressResolution): GraphQueryResult<T> {
    return freeze({records: freezeRecords([]), completeness: 'unresolved', reasons: freezeRecords([resolutionReason(resolution)]), resolutions: freezeRecords([resolution])});
  }

  private result<T>(records: readonly T[], resolutions: readonly GraphAddressResolution[], localReasons: readonly string[]): GraphQueryResult<T> {
    const reasons = [...new Set([...localReasons, ...this.layerUnknownReasons])].sort();
    return freeze({
      records: freezeRecords(sortRecords(records)), completeness: resultCompleteness(localReasons, false, this.layerUnknownReasons),
      reasons: freezeRecords(reasons), resolutions: freezeRecords(resolutions),
    });
  }

  private edgeReasons(edges: readonly GraphIrV2Edge[]): string[] {
    return edges
      .filter((edge) => !this.nodeByAddress.has(edge.from) || !this.nodeByAddress.has(edge.to))
      .map((edge) => `edge endpoint is absent: ${edgeIdentity(edge)}`);
  }

  /** Walks one or more explicit directed relations without constructing a second adjacency view. */
  private directedWalk(address: string, rules: readonly GraphProjectionRule[], maxHops: number): {
    readonly edges: readonly GraphIrV2Edge[];
    readonly unknownReasons: readonly string[];
  } {
    const queue: Array<{readonly address: string; readonly hops: number}> = [{address, hops: 0}];
    const visited = new Set<string>([address]);
    const edges = new Map<string, GraphIrV2Edge>();
    const unknownReasons: string[] = [];
    for (let index = 0; index < queue.length; index++) {
      const current = queue[index];
      if (current.hops >= maxHops) continue;
      for (const edge of this.nextEdges(current.address, rules)) {
        edges.set(edgeIdentity(edge), edge);
        const rule = rules.find((candidate) => candidate.relation === edge.relation
          && (candidate.direction === 'outbound' ? edge.from === current.address : edge.to === current.address));
        if (!rule) continue;
        const next = rule.direction === 'outbound' ? edge.to : edge.from;
        if (!this.nodeByAddress.has(next)) {
          unknownReasons.push(`edge endpoint is absent: ${edgeIdentity(edge)}`);
        } else if (!visited.has(next)) {
          visited.add(next);
          queue.push({address: next, hops: current.hops + 1});
        }
      }
    }
    return {edges: uniqueEdges([...edges.values()]), unknownReasons: freezeRecords([...new Set(unknownReasons)].sort())};
  }

  /** Applies the frozen relation orientation to the compiler-owned adjacency indexes. */
  private nextEdges(address: string, rules: readonly GraphProjectionRule[]): readonly GraphIrV2Edge[] {
    return uniqueEdges(rules.flatMap((rule) => rule.direction === 'outbound'
      ? this.outboundRecords(address, rule.relation)
      : this.inboundRecords(address, rule.relation)));
  }

  private outboundRecords(address: string, relation: GraphRelation): readonly GraphIrV2Edge[] {
    return (this.outbound.get(address) ?? []).filter((edge) => edge.relation === relation);
  }

  private inboundRecords(address: string, relation: GraphRelation): readonly GraphIrV2Edge[] {
    return (this.inbound.get(address) ?? []).filter((edge) => edge.relation === relation);
  }
}

function normalizeCanonicalSpelling(input: string): {readonly address: string; readonly via: 'canonical' | 'anchor'; readonly form: 'canonical' | 'anchor'} | undefined {
  if (input === 'project'
    || /^(?:capability|scenario|architecture_rule):[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input)
    || /^feature:F-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input)
    || /^criterion:F-[A-Za-z0-9][A-Za-z0-9._-]*\/AC-[A-Za-z0-9][A-Za-z0-9._-]*$/.test(input)) {
    return {address: input, via: 'canonical', form: 'canonical'};
  }
  if (input.startsWith('artifact:')) {
    try {
      return {address: artifactAddress(input.slice('artifact:'.length)), via: 'canonical', form: 'canonical'};
    } catch {
      return undefined;
    }
  }
  const anchor = parseAnchorAddress(input);
  return anchor ? {address: anchorAddress(anchor.path, anchor.selector), via: 'anchor', form: 'anchor'} : undefined;
}

function normalizeRawPhysicalSpelling(input: string): {readonly address: string; readonly via: 'path' | 'anchor'; readonly form: 'path' | 'anchor'} | undefined {
  if (/^(?:artifact|anchor|capability|feature|criterion|scenario|architecture_rule):/.test(input) || input === 'project') return undefined;
  const separator = input.indexOf('#');
  try {
    if (separator >= 0) {
      const path = input.slice(0, separator);
      const selector = input.slice(separator + 1);
      return selector ? {address: anchorAddress(path, selector), via: 'anchor', form: 'anchor'} : undefined;
    }
    return {address: artifactAddress(input), via: 'path', form: 'path'};
  } catch {
    return undefined;
  }
}

function validateProjectionRequest(request: GraphProjectionRequest): void {
  if (!Array.isArray(request.seeds) || request.seeds.length === 0) throw new Error('GraphIR projection requires at least one explicit seed');
  if (!Array.isArray(request.rules) || request.rules.length === 0) throw new Error('GraphIR projection requires at least one explicit relation-direction rule');
  for (const rule of request.rules) {
    if (!RELATIONS.has(rule.relation) || (rule.direction !== 'outbound' && rule.direction !== 'inbound')) {
      throw new Error('GraphIR projection rules require a known relation and explicit inbound or outbound direction');
    }
  }
  validateBound('maxHops', request.maxHops);
  validateBound('maxNodes', request.maxNodes);
  validateBound('maxEdges', request.maxEdges);
  if (request.maxNodes === 0) throw new Error('GraphIR maxNodes must retain at least one required seed');
  if (request.maxEdges === 0 && request.maxHops > 0) throw new Error('GraphIR maxEdges can be zero only for a depth-zero seed projection');
}

function validateBound(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`GraphIR ${name} must be a finite non-negative integer`);
}

function assertCanonicalAddress(address: unknown): asserts address is string {
  if (!isNonBlankString(address) || normalizeCanonicalSpelling(address)?.address !== address) {
    throw new Error(`GraphIR augmentation address is not canonical: ${String(address)}`);
  }
}

function assertAugmentationLayer(layer: GraphIrV2Augmentation): void {
  if (!isNonBlankString(layer.layerId)) {
    throw new Error('GraphIR augmentation layer id must be nonblank');
  }
  if (!Array.isArray(layer.nodes) || !Array.isArray(layer.edges) || !Array.isArray(layer.unknownReasons)) {
    throw new Error(`GraphIR augmentation layer has an invalid structural shape: ${layer.layerId}`);
  }
  if (layer.completeness !== 'complete' && layer.completeness !== 'unknown') {
    throw new Error(`GraphIR augmentation layer has an invalid completeness state: ${layer.layerId}`);
  }
  if (layer.unknownReasons.some((reason) => !isNonBlankString(reason))) {
    throw new Error(`GraphIR augmentation layer has a blank unknown reason: ${layer.layerId}`);
  }
  if (layer.completeness === 'unknown' && layer.unknownReasons.length === 0) {
    throw new Error(`GraphIR unknown augmentation layer requires a reason: ${layer.layerId}`);
  }
  if (layer.completeness === 'complete' && layer.unknownReasons.length > 0) {
    throw new Error(`GraphIR complete augmentation layer cannot retain unknown reasons: ${layer.layerId}`);
  }
}

function assertAugmentationNode(node: GraphIrV2AugmentationNode): void {
  if (!node || typeof node !== 'object'
    || (node.provenance !== 'authored' && node.provenance !== 'derived' && node.provenance !== 'observed')) {
    throw new Error('GraphIR augmentation node must retain explicit provenance');
  }
  assertCanonicalAddress(node.address);
  assertFactLocator(node.provenance, node.locator, `GraphIR augmentation node ${node.address}`);
  if (node.nodeType === 'artifact') {
    if (!node.address.startsWith('artifact:')) throw new Error(`GraphIR augmentation artifact fact has a non-artifact address: ${node.address}`);
    if (!Array.isArray(node.roles) || node.roles.length === 0 || node.roles.some((role) => !ARTIFACT_ROLES.has(role))) {
      throw new Error(`GraphIR augmentation artifact fact has invalid roles: ${node.address}`);
    }
    if (new Set(node.roles).size !== node.roles.length) {
      throw new Error(`GraphIR augmentation artifact fact repeats a role: ${node.address}`);
    }
    if (!Array.isArray(node.owners)) throw new Error(`GraphIR augmentation artifact fact has invalid owners: ${node.address}`);
    return;
  }
  if ((node as {readonly nodeType?: unknown}).nodeType !== 'anchor') {
    throw new Error(`GraphIR augmentation node has an unsupported taxonomy: ${node.address}`);
  }
  const anchor = parseAnchorAddress(node.address);
  if (!anchor
    || !isNonBlankString(node.selector)
    || node.artifact !== artifactAddress(anchor.path)
    || node.selector !== anchor.selector
    || (node.selectorProvenance !== 'authored' && node.selectorProvenance !== 'derived')) {
    throw new Error(`GraphIR augmentation anchor fact does not match its canonical address: ${node.address}`);
  }
}

function assertAugmentationNodeReferences(
  node: GraphIrV2AugmentationNode,
  combinedNodes: ReadonlyMap<string, GraphIrV2Node>,
): void {
  if (node.nodeType === 'artifact') {
    for (const owner of node.owners) {
      assertCanonicalEndpoint(owner, combinedNodes, `GraphIR augmentation artifact owner for ${node.address}`);
      if (endpointTaxonomy(combinedNodes.get(owner)!) !== 'feature') {
        throw new Error(`GraphIR augmentation artifact owner must be a feature: ${owner}`);
      }
    }
    return;
  }
  assertCanonicalEndpoint(node.artifact, combinedNodes, `GraphIR augmentation anchor artifact for ${node.address}`);
  if (endpointTaxonomy(combinedNodes.get(node.artifact)!) !== 'artifact') {
    throw new Error(`GraphIR augmentation anchor artifact must be an artifact node: ${node.artifact}`);
  }
}

function assertAugmentationEdge(
  edge: GraphIrV2AugmentationEdge,
  combinedNodes: ReadonlyMap<string, GraphIrV2Node>,
): void {
  if (edge.provenance === 'observed') {
    assertObservationEdge(edge, combinedNodes);
  } else {
    assertStructuralEdge(edge, combinedNodes);
  }
}

function assertObservationEdge(
  edge: GraphIrV2ObservationEdge,
  combinedNodes: ReadonlyMap<string, GraphIrV2Node>,
): void {
  if (!edge || typeof edge !== 'object' || edge.provenance !== 'observed') {
    throw new Error('GraphIR observation edge must retain observed provenance');
  }
  if (!isNonBlankString(edge.identity)) throw new Error('GraphIR observation edge identity must be nonblank');
  assertObservationLocator(edge.owner, `GraphIR observation edge ${edge.identity}`);
  assertCanonicalEndpoint(edge.from, combinedNodes, `GraphIR observation edge source for ${edge.identity}`);
  assertCanonicalEndpoint(edge.to, combinedNodes, `GraphIR observation edge target for ${edge.identity}`);
  if (!GRAPH_STATES.has(edge.state)) throw new Error(`GraphIR observation edge has an invalid state: ${edge.identity}`);
  if (edge.channel !== undefined && !LEGACY_REFERENCE_CHANNELS.has(edge.channel)) {
    throw new Error(`GraphIR observation edge has an invalid channel: ${edge.identity}`);
  }
  if (edge.raw !== undefined && typeof edge.raw !== 'string') throw new Error(`GraphIR observation edge has an invalid raw detail: ${edge.identity}`);
  if (edge.normalizedTarget !== undefined) {
    assertCanonicalAddress(edge.normalizedTarget);
    if (edge.state !== 'unresolved' && !combinedNodes.has(edge.normalizedTarget)) {
      throw new Error(`GraphIR observation edge normalized target for ${edge.identity} is absent from the combined GraphIR node set: ${edge.normalizedTarget}`);
    }
  }
  if (edge.selector !== undefined) assertSelector(edge.selector, edge.identity);
  assertRelationEndpoints(edge, combinedNodes);
}

function assertObservationLocator(locator: GraphObservationLocator, label: string): void {
  if (!locator
    || typeof locator !== 'object'
    || locator.kind !== 'runtime_observation'
    || !isNonBlankString(locator.adapter)
    || !isNonBlankString(locator.reference)) {
    throw new Error(`${label} requires a nonblank runtime observation adapter and reference`);
  }
}

function assertTextSourceLocator(locator: GraphTextSourceLocator, label: string): void {
  if (!locator || typeof locator !== 'object' || locator.kind !== 'text_source' || !isNonBlankString(locator.path)) {
    throw new Error(`${label} requires a nonblank text source path`);
  }
  try {
    if (artifactAddress(locator.path).slice('artifact:'.length) !== locator.path) {
      throw new Error('noncanonical path');
    }
  } catch {
    throw new Error(`${label} requires a canonical repository-relative text source path`);
  }
  if (locator.selector !== undefined && !isNonBlankString(locator.selector)) {
    throw new Error(`${label} has a blank text source selector`);
  }
}

function assertFactLocator(
  provenance: GraphIrV2AugmentationNode['provenance'],
  locator: GraphIrV2AugmentationNode['locator'],
  label: string,
): void {
  if (provenance === 'observed') {
    assertObservationLocator(locator as GraphObservationLocator, label);
  } else {
    assertTextSourceLocator(locator as GraphTextSourceLocator, label);
  }
}

function assertStructuralEdge(
  edge: GraphIrV2StructuralEdge,
  combinedNodes: ReadonlyMap<string, GraphIrV2Node>,
): void {
  if (!edge || typeof edge !== 'object' || (edge.provenance !== 'authored' && edge.provenance !== 'derived')) {
    throw new Error('GraphIR structural edge must retain authored or derived provenance');
  }
  if (!isNonBlankString(edge.identity)) throw new Error('GraphIR structural edge identity must be nonblank');
  assertTextSourceLocator(edge.owner, `GraphIR structural edge ${edge.identity}`);
  assertCanonicalEndpoint(edge.from, combinedNodes, `GraphIR structural edge source for ${edge.identity}`);
  if (edge.state !== 'resolved' && edge.state !== 'unresolved') {
    throw new Error(`GraphIR structural edge has a non-structural state: ${edge.identity}`);
  }
  assertCanonicalAddress(edge.to);
  if (edge.state === 'resolved') {
    assertCanonicalEndpoint(edge.to, combinedNodes, `GraphIR structural edge target for ${edge.identity}`);
  }
  if (edge.raw !== undefined && typeof edge.raw !== 'string') throw new Error(`GraphIR structural edge has an invalid raw detail: ${edge.identity}`);
  if (edge.normalizedTarget !== undefined) {
    assertCanonicalAddress(edge.normalizedTarget);
    if (edge.state === 'resolved' && !combinedNodes.has(edge.normalizedTarget)) {
      throw new Error(`GraphIR structural edge normalized target for ${edge.identity} is absent from the combined GraphIR node set: ${edge.normalizedTarget}`);
    }
  }
  if (edge.selector !== undefined) assertSelector(edge.selector, edge.identity);
  assertStructuralRelationEndpoints(edge, combinedNodes);
}

function assertCanonicalEndpoint(address: string, combinedNodes: ReadonlyMap<string, GraphIrV2Node>, label: string): void {
  assertCanonicalAddress(address);
  if (!combinedNodes.has(address)) throw new Error(`${label} is absent from the combined GraphIR node set: ${address}`);
}

function assertSelector(selector: NonNullable<GraphIrV2AugmentationEdge['selector']>, identity: string): void {
  if (selector.precision === 'none' && selector.value === undefined) return;
  if (selector.precision === 'fragment' && isNonBlankString(selector.value)) return;
  throw new Error(`GraphIR augmentation edge has an invalid selector: ${identity}`);
}

function assertRelationEndpoints(edge: GraphIrV2AugmentationEdge, combinedNodes: ReadonlyMap<string, GraphIrV2Node>): void {
  const permitted = RELATION_ENDPOINTS.get(edge.relation);
  if (!permitted) throw new Error(`GraphIR augmentation edge has an unknown relation: ${edge.relation}`);
  const from = endpointTaxonomy(combinedNodes.get(edge.from)!);
  const to = endpointTaxonomy(combinedNodes.get(edge.to)!);
  if (!permitted[0].includes(from) || !permitted[1].includes(to)) {
    throw new Error(`GraphIR augmentation edge has invalid ${edge.relation} endpoint taxonomy: ${from} -> ${to}`);
  }
}

/** Validates an unresolved static target from its canonical address, never an alias guess. */
function assertStructuralRelationEndpoints(edge: GraphIrV2StructuralEdge, combinedNodes: ReadonlyMap<string, GraphIrV2Node>): void {
  const permitted = RELATION_ENDPOINTS.get(edge.relation);
  if (!permitted) throw new Error(`GraphIR augmentation edge has an unknown relation: ${edge.relation}`);
  const from = endpointTaxonomy(combinedNodes.get(edge.from)!);
  const targetNode = combinedNodes.get(edge.to);
  const to = targetNode === undefined ? endpointTaxonomyFromCanonicalAddress(edge.to) : endpointTaxonomy(targetNode);
  if (!permitted[0].includes(from) || !permitted[1].includes(to)) {
    throw new Error(`GraphIR augmentation edge has invalid ${edge.relation} endpoint taxonomy: ${from} -> ${to}`);
  }
}

function endpointTaxonomy(node: GraphIrV2Node): GraphEndpointTaxonomy {
  if (node.nodeType === 'artifact' || node.nodeType === 'anchor') return node.nodeType;
  return node.kind;
}

/** Infers only the closed endpoint taxonomy encoded by an already-canonical address. */
function endpointTaxonomyFromCanonicalAddress(address: string): GraphEndpointTaxonomy {
  if (address.startsWith('artifact:')) return 'artifact';
  if (address.startsWith('anchor:')) return 'anchor';
  if (address === 'project') return 'project';
  return address.slice(0, address.indexOf(':')) as GraphEndpointTaxonomy;
}

/** Merges only physical artifact facts; every other address collision is unsafe. */
function mergeAugmentationNodes(
  existingNodes: ReadonlyMap<string, GraphIrV2Node>,
  augmentationNodes: readonly GraphIrV2AugmentationNode[],
): ReadonlyMap<string, GraphIrV2Node> {
  const merged = new Map(existingNodes);
  for (const node of augmentationNodes) {
    const existing = merged.get(node.address);
    if (!existing) {
      merged.set(node.address, node);
      continue;
    }
    if (existing.nodeType !== node.nodeType) {
      throw new Error(`GraphIR incompatible node taxonomy collision: ${node.address}`);
    }
    if (node.nodeType !== 'artifact' || existing.nodeType !== 'artifact') {
      if (canonicalRecord(existing) !== canonicalRecord(node)) {
        throw new Error(`GraphIR incompatible node collision: ${node.address}`);
      }
      continue;
    }
    merged.set(node.address, mergeArtifactFacts(existing, node));
  }
  return new Map([...merged.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

/**
 * Retains one artifact identity while adding every distinct role and feature owner.
 *
 * Compiler artifacts remain authoritative because their source provenance feeds
 * the independent corpus view. External-only facts instead use the minimum
 * provenance/locator key, so repeated merges are associative and do not depend
 * on adapter-layer order.
 */
function mergeArtifactFacts(
  existing: Extract<GraphIrV2Node, {readonly nodeType: 'artifact'}>,
  incoming: Extract<GraphIrV2AugmentationNode, {readonly nodeType: 'artifact'}>,
): GraphIrV2Node {
  const roles = freezeRecords([...new Set([...existing.roles, ...incoming.roles])].sort());
  const owners = freezeRecords([...new Set([...existing.owners, ...incoming.owners])].sort());
  if (isBaseNode(existing)) return freeze({...existing, roles, owners});
  const representative = externalArtifactRepresentative(existing, incoming);
  return freeze({
    address: representative.address,
    nodeType: 'artifact' as const,
    roles,
    owners,
    provenance: representative.provenance,
    locator: canonicalFactLocator(representative.locator),
  });
}

/** Selects one stable external fact using only metadata that is not unioned. */
function externalArtifactRepresentative(
  existing: Extract<GraphIrV2AugmentationNode, {readonly nodeType: 'artifact'}>,
  incoming: Extract<GraphIrV2AugmentationNode, {readonly nodeType: 'artifact'}>,
): Extract<GraphIrV2AugmentationNode, {readonly nodeType: 'artifact'}> {
  return externalArtifactMetadataKey(existing) <= externalArtifactMetadataKey(incoming) ? existing : incoming;
}

/** Ranks authored declarations above derivations and observations, then canonicalizes the locator tie-break. */
function externalArtifactMetadataKey(
  fact: Extract<GraphIrV2AugmentationNode, {readonly nodeType: 'artifact'}>,
): string {
  const provenanceRank = fact.provenance === 'authored' ? '0' : fact.provenance === 'derived' ? '1' : '2';
  return `${provenanceRank}:${canonicalRecord(fact.locator)}`;
}

/** Rebuilds a selected locator in a stable field order for byte-identical projections. */
function canonicalFactLocator(locator: GraphTextSourceLocator | GraphObservationLocator): GraphTextSourceLocator | GraphObservationLocator {
  if (locator.kind === 'text_source') {
    return freeze({
      kind: 'text_source' as const,
      path: locator.path,
      ...(locator.selector === undefined ? {} : {selector: locator.selector}),
    });
  }
  return freeze({kind: 'runtime_observation' as const, adapter: locator.adapter, reference: locator.reference});
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function indexByIdentity<T>(records: readonly T[], identity: (record: T) => string, label: string): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const record of records) {
    const key = identity(record);
    const existing = index.get(key);
    if (existing === undefined) {
      index.set(key, record);
    } else if (canonicalRecord(existing) !== canonicalRecord(record)) {
      throw new Error(`GraphIR conflicting duplicate ${label}: ${key}`);
    }
  }
  return index;
}

function edgeIndex(edges: readonly GraphIrV2Edge[], endpoint: 'from' | 'to'): ReadonlyMap<string, readonly GraphIrV2Edge[]> {
  const index = new Map<string, GraphIrV2Edge[]>();
  for (const edge of edges) {
    const records = index.get(edge[endpoint]) ?? [];
    records.push(edge);
    index.set(edge[endpoint], records);
  }
  return new Map([...index.entries()].map(([address, records]) => [address, freezeRecords(sortBy(records, edgeIdentity))]));
}

function aliasIndex(aliases: readonly GraphAliasRecord[]): ReadonlyMap<string, readonly GraphAliasRecord[]> {
  const index = new Map<string, GraphAliasRecord[]>();
  for (const alias of aliases) {
    const records = index.get(alias.alias) ?? [];
    records.push(alias);
    index.set(alias.alias, records);
  }
  return new Map([...index.entries()].map(([alias, records]) => [alias, freezeRecords(sortBy(records, recordKey))]));
}

function isBaseNode(node: GraphIrV2Node): node is GraphNode {
  return !('locator' in node);
}

function isBaseEdge(edge: GraphIrV2Edge): edge is GraphEdge {
  return 'address' in edge;
}

type AuthoredProofEdge = GraphEdge & {
  readonly channel: NonNullable<GraphEdge['channel']>;
  readonly raw: string;
  readonly normalizedTarget: string;
  readonly selector: NonNullable<GraphEdge['selector']>;
  readonly state: 'resolved' | 'unresolved';
};

function isAuthoredProofEdge(edge: GraphEdge): edge is AuthoredProofEdge {
  return edge.relation === 'supports'
    && edge.provenance === 'authored'
    && edge.channel !== undefined
    && edge.raw !== undefined
    && edge.normalizedTarget !== undefined
    && edge.selector !== undefined
    && (edge.state === 'resolved' || edge.state === 'unresolved');
}

function toProofRecord(edge: AuthoredProofEdge): CorpusProofRecord {
  return {
    owner: edge.from, channel: edge.channel, raw: edge.raw, normalizedTarget: edge.normalizedTarget,
    selector: edge.selector, resolution: edge.state, source: edge.owner as SourceLocator,
  };
}

function edgeIdentity(edge: GraphIrV2Edge): string {
  return isBaseEdge(edge) ? edge.address : `${edge.provenance}:${edge.identity}`;
}

function uniqueEdges(edges: readonly GraphIrV2Edge[]): readonly GraphIrV2Edge[] {
  return freezeRecords(sortBy([...indexByIdentity(edges, edgeIdentity, 'edge identity').values()], edgeIdentity));
}

function resolvedAddress(resolution: GraphAddressResolution): string | undefined {
  return resolution.state === 'resolved' ? resolution.canonical : undefined;
}

function resolutionReason(resolution: GraphAddressResolution): string {
  return resolution.state === 'resolved' ? '' : resolution.state === 'ambiguous'
    ? `${resolution.reason}: ${resolution.candidates.join(', ')}`
    : resolution.reason;
}

function resultCompleteness(localReasons: readonly string[], bounded: boolean, layerUnknownReasons: readonly string[]): GraphQueryCompleteness {
  if (layerUnknownReasons.length > 0 || localReasons.length > 0) return 'unknown';
  return bounded ? 'bounded' : 'complete';
}

function recordKey(record: object): string {
  return canonicalRecord(record);
}

function sortBy<T>(records: readonly T[], key: (record: T) => string): readonly T[] {
  return [...records].sort((left, right) => key(left).localeCompare(key(right)));
}

function sortRecords<T>(records: readonly T[]): readonly T[] {
  return sortBy(records, (record) => canonicalRecord(record));
}

/** Preserves the committed independent-scanner snapshot's historical record order. */
function sortParityRecords<T>(records: readonly T[]): readonly T[] {
  return sortBy(records, (record) => JSON.stringify(record));
}

function freezeRecords<T>(records: readonly T[]): readonly T[] {
  return Object.freeze([...records]);
}

function freeze<T extends object>(record: T): T {
  return Object.freeze(record);
}

/** Copies and freezes adapter-owned records so later caller mutation cannot affect queries. */
function copyFrozen<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => copyFrozen(entry))) as T;
  if (value !== null && typeof value === 'object') {
    const copy = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyFrozen(entry)]));
    return Object.freeze(copy) as T;
  }
  return value;
}

/** Canonical comparison keeps duplicate handling independent of caller property insertion order. */
function canonicalRecord(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalRecord).join(',')}]`;
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalRecord(record[key])}`).join(',')}}`;
}
