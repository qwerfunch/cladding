// Cladding · Spec 0.2 F8 · GraphIR v2 public wire records and bounded packer.

import type {
  GraphAddressResolution,
  GraphDirection,
  GraphIrV2Edge,
  GraphIrV2Node,
  GraphProjection,
  GraphProjectionRule,
  GraphQueryCompleteness,
} from '../spec/compiler/graph-ir-v2.js';
import type {
  CompilerSchemaVersion,
  GraphPresentationRecord,
  GraphRelation,
} from '../spec/compiler/types.js';
import type {GraphIrV2Workspace, GraphIrV2WorkspaceLayer} from './query.js';

/** Default focused bounds; a caller that supplies nothing still gets a depth-1 read. */
const DEFAULT_MAX_DEPTH = 1;
const DEFAULT_MAX_NODES = 64;
const DEFAULT_MAX_EDGES = 128;

/** Hard request bounds; a caller cannot widen a focused read into a corpus walk. */
const DEPTH_LIMIT = 3;
const NODE_LIMIT = 200;
const EDGE_LIMIT = 400;

/** The D19 observe-profile payload ceiling for a focused response. */
const DEFAULT_BYTE_CEILING = 16_384;

/** Reasons are a diagnosis aid, not the payload; the remainder is counted instead. */
const MAX_REASONS = 8;

/**
 * `payload_utf8_bytes` and `token_estimate.tokens` both widen monotonically as
 * the measured value gains digits, so the remeasure sequence is non-decreasing
 * and converges once neither number changes width. Eight rounds cover every
 * payload below a gigabyte.
 */
const MAX_MEASURE_ROUNDS = 8;

/** The estimator is always named because provider tokenizers differ. */
const TOKEN_ESTIMATOR = 'characters/4';

/** Exact spellings a caller may supply; an unresolved answer repeats them verbatim. */
const ACCEPTED_FORMS: readonly string[] = Object.freeze([
  'canonical address (feature:F-…, criterion:F-…/AC-…, artifact:<path>, anchor:<path>#<selector>)',
  'feature id (F-…)',
  'feature slug',
  'repository path',
]);

/** One public wire node; absent fields are omitted rather than emitted as null. */
export interface WireNodeV2 {
  /** Canonical GraphIR address; the sole identity on the wire. */
  readonly address: string;
  /** Node taxonomy. */
  readonly type: 'semantic' | 'artifact' | 'anchor';
  /** Semantic class, present only for semantic nodes. */
  readonly kind?: string;
  /** Every role a physical artifact holds at once, present only for artifact nodes. */
  readonly roles?: readonly string[];
  /** Containing artifact address, present only for anchor nodes. */
  readonly artifact?: string;
  /** Exact stable selector, present only for anchor nodes. */
  readonly selector?: string;
  /** Whether source, compiler, or runtime established the node. */
  readonly provenance: string;
  /** Runtime truth state when a fact layer supplies one; absence is never success. */
  readonly state?: string;
  /** Navigation hint as `path:line`, or an adapter reference for observed facts. */
  readonly owner?: string;
  /** Authored label; dropped from non-seed nodes when the payload must shrink. */
  readonly title?: string;
  /** Authored legacy feature slug. */
  readonly slug?: string;
  /** Authored lifecycle status. */
  readonly status?: string;
  /** Authored WHY statement; carried only by the full view. */
  readonly purpose?: string;
}

/** One public wire edge; direction is always the authored orientation. */
export interface WireEdgeV2 {
  /** Deterministic edge identity used for sorting and diagnosis. */
  readonly id: string;
  /** Source node address. */
  readonly from: string;
  /** Target node address. */
  readonly to: string;
  /** Directed relation type. */
  readonly relation: GraphRelation;
  /** Whether source, compiler, or runtime established the relation. */
  readonly provenance: string;
  /** Resolution or observation state; an authored declaration is never a pass. */
  readonly state?: string;
  /** Legacy proof channel, retained without upgrading it to an observation. */
  readonly channel?: string;
  /** Exact source spelling, dropped first when the payload must shrink. */
  readonly raw?: string;
  /** Exact authored selector value when the reference carried one. */
  readonly selector?: string;
}

/** One fact layer's explicit knowledge state, repeated on the wire. */
export interface WireLayerV2 {
  /** Adapter/layer identity. */
  readonly id: string;
  /** The layer's own assertion; an empty layer is not automatically complete. */
  readonly completeness: 'complete' | 'unknown';
  /** Stable reasons required when the layer cannot make a complete assertion. */
  readonly reasons: readonly string[];
}

/** The exact traversal rule a focused read used. */
export interface WireRuleV2 {
  /** Relation traversed. */
  readonly relation: GraphRelation;
  /** Whether traversal followed or reversed the authored orientation. */
  readonly direction: GraphDirection;
}

/** Effective traversal bounds; `null` marks an intentionally unbounded whole-graph read. */
export interface WireBoundsV2 {
  /** Maximum relation hops from each seed. */
  readonly max_depth: number | null;
  /** Maximum materialized nodes. */
  readonly max_nodes: number | null;
  /** Maximum materialized edges. */
  readonly max_edges: number | null;
}

/** Exact counts of what the packer removed; never an approximation. */
export interface WireOmissionV2 {
  /** Nodes dropped to fit the byte ceiling. */
  readonly nodes: number;
  /** Edges dropped with their endpoints. */
  readonly edges: number;
  /** Reasons beyond the retained head. */
  readonly reasons: number;
  /** Individual optional field values removed from retained records. */
  readonly fields: number;
}

/** Exact serialized size of the response that carries it. */
export interface WireMetaV2 {
  /** Resolved seed addresses; empty for a whole-graph read, which has no focused seed. */
  readonly seeds: readonly string[];
  /** Traversal rules used; empty for a whole-graph read. */
  readonly rules: readonly WireRuleV2[];
  /** Effective traversal bounds. */
  readonly bounds: WireBoundsV2;
  /** Emitted record counts. */
  readonly counts: {readonly nodes: number; readonly edges: number};
  /** Exact omission counts. */
  readonly omitted: WireOmissionV2;
  /** True when required seed facts alone exceed the ceiling; nothing is silently dropped. */
  readonly required_overflow: boolean;
  /** Exact UTF-8 bytes of the complete serialized envelope, measured to a fixed point. */
  readonly payload_utf8_bytes: number;
  /** The ceiling the packer honored, or `null` when the caller asked for no ceiling. */
  readonly byte_ceiling: number | null;
  /** Token figure that always names its estimator. */
  readonly token_estimate: {readonly estimator: string; readonly tokens: number};
}

/** An explicit non-answer for a query that no canonical address matches. */
export interface WireResolutionV2 {
  /** Whether the spelling matched nothing or more than one address. */
  readonly state: 'unresolved' | 'ambiguous';
  /** Exact caller spelling, unmodified. */
  readonly input: string;
  /** Stable explanation from the address resolver. */
  readonly reason: string;
  /** Every canonical address an ambiguous spelling matched. */
  readonly candidates?: readonly string[];
  /** Spellings the resolver accepts, so a caller can retry without guessing. */
  readonly accepted_forms: readonly string[];
}

/** Deterministic corpus counts for a no-query graph read. */
export interface WireStatisticsV2 {
  /** Node totals by taxonomy and by semantic class. */
  readonly nodes: {
    readonly total: number;
    readonly by_type: Readonly<Record<string, number>>;
    readonly by_kind: Readonly<Record<string, number>>;
  };
  /** Edge totals by relation and by truth state; `unobserved` names an absent observation. */
  readonly edges: {
    readonly total: number;
    readonly by_relation: Readonly<Record<string, number>>;
    readonly by_state: Readonly<Record<string, number>>;
  };
  /** The ten artifacts with the most feature owners, ties broken by address. */
  readonly artifact_hubs: readonly {readonly artifact: string; readonly owners: number}[];
}

/** One public GraphIR v2 response; every variant carries the same measured `meta`. */
export interface WireEnvelopeV2 {
  /** Graph wire version, independent of the frozen `clad_get_context` version. */
  readonly schema_version: 2;
  /** Which response the caller received; an empty projection is never a silent success. */
  readonly kind: 'export' | 'projection' | 'statistics' | 'unresolved' | 'rejected';
  /** Source schema the workspace compiled from. */
  readonly workspace_schema: CompilerSchemaVersion;
  /** Explicit knowledge state of every fact layer behind this answer. */
  readonly layers: readonly WireLayerV2[];
  /** Explicit result status, never inferred from an empty record set. */
  readonly completeness: GraphQueryCompleteness;
  /** Retained head of the reasons this answer is anything but complete. */
  readonly reasons: readonly string[];
  /** Emitted nodes, absent for statistics, unresolved, and rejected responses. */
  readonly nodes?: readonly WireNodeV2[];
  /** Emitted edges, absent for statistics, unresolved, and rejected responses. */
  readonly edges?: readonly WireEdgeV2[];
  /** Corpus counts, present only for a statistics response. */
  readonly statistics?: WireStatisticsV2;
  /** Address-resolution detail, present only for an unresolved response. */
  readonly resolution?: WireResolutionV2;
  /** Measured size and omission metadata for exactly this serialization. */
  readonly meta: WireMetaV2;
}

/** A caller-supplied focused graph request before validation. */
export interface FocusedGraphRequestV2 {
  /** Any accepted spelling of one seed address. */
  readonly query: string;
  /** Relation hops from the seed; 1 to 3. */
  readonly max_depth?: number;
  /** Maximum materialized nodes; 1 to 200. */
  readonly max_nodes?: number;
  /** Maximum materialized edges; 1 to 400. */
  readonly max_edges?: number;
  /** `compact` omits authored purpose; `full` retains it. */
  readonly view?: 'compact' | 'full';
}

/** Packing options owned by the calling surface rather than by the caller. */
export interface WirePackOptionsV2 {
  /** Byte ceiling to honor; `null` disables trimming for an export path. */
  readonly byteCeiling?: number | null;
}

/**
 * Selects the traversal rules that suit one seed's taxonomy.
 *
 * Traversal is relation-aware by design: an omitted rule can never become an
 * undirected walk, and containment adds a parent for orientation without
 * expanding every sibling.
 *
 * @param seedAddress - Canonical seed address whose grammar selects the rule set.
 * @returns Frozen, deterministically ordered traversal rules for that seed.
 * @example
 * ```ts
 * defaultRulesFor('feature:F-208eaa79');
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b61f6aa5
 * @see docs/design/spec-0.2/graph.md#edges-ownership-and-truth-status
 * @since 0.10.0
 */
export function defaultRulesFor(seedAddress: string): readonly GraphProjectionRule[] {
  if (seedAddress.startsWith('feature:')) {
    return rules([
      ['contains', 'outbound'],
      ['depends_on', 'outbound'],
      ['depends_on', 'inbound'],
      ['touches', 'outbound'],
      ['contributes_to', 'outbound'],
      ['participates_in', 'inbound'],
    ]);
  }
  if (seedAddress.startsWith('criterion:')) {
    // A criterion reads as proof: its parent feature for orientation, the
    // constraints it answers to, and every carrier that claims to prove it.
    return rules([
      ['contains', 'inbound'],
      ['constrained_by', 'outbound'],
      ['supports', 'outbound'],
      ['covers', 'inbound'],
      ['traces_to', 'inbound'],
    ]);
  }
  if (seedAddress.startsWith('artifact:')) {
    return rules([
      ['touches', 'inbound'],
      ['defined_in', 'inbound'],
      ['supports', 'inbound'],
    ]);
  }
  if (seedAddress.startsWith('anchor:')) {
    return rules([
      ['covers', 'outbound'],
      ['supports', 'inbound'],
      ['traces_to', 'outbound'],
    ]);
  }
  // capability, scenario, architecture_rule, and project each match exactly one
  // of these structural relations; the others contribute nothing for that seed.
  return rules([
    ['contributes_to', 'inbound'],
    ['participates_in', 'outbound'],
    ['constrained_by', 'inbound'],
    ['defined_in', 'outbound'],
  ]);
}

/**
 * Builds one bounded, byte-measured focused graph response.
 *
 * The response never throws for caller input: invalid bounds return a rejected
 * envelope and an unmatched spelling returns an unresolved envelope, so an
 * empty node list always means an empty graph rather than a failed request.
 *
 * @param workspace - One coherent presentation, compiler, and GraphIR snapshot.
 * @param request - Caller-supplied seed spelling, bounds, and view.
 * @param options - Surface-owned packing options; the default ceiling is the D19 observe profile.
 * @returns One frozen envelope whose `meta.payload_utf8_bytes` equals its own serialized size.
 * @example
 * ```ts
 * focusedProjectionV2(loadGraphIrV2Workspace('.'), {query: 'F-208eaa79'});
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-b61f6aa5
 * AC-1f6fd7fe AC-4ce9a97d AC-98be095b AC-286cc0a8 AC-a0d60a0b AC-d183d625
 * AC-cf399eba AC-945363a4
 * @see docs/design/spec-0.2/context-and-orchestration.md#packing-and-reuse
 * @since 0.10.0
 */
export function focusedProjectionV2(
  workspace: GraphIrV2Workspace,
  request: FocusedGraphRequestV2,
  options: WirePackOptionsV2 = {},
): WireEnvelopeV2 {
  const ceiling = options.byteCeiling === undefined ? DEFAULT_BYTE_CEILING : options.byteCeiling;
  const layers = wireLayers(workspace.layers);
  const rejections = boundRejections(request);
  if (rejections.length > 0) {
    return packEnvelope({
      kind: 'rejected',
      workspace,
      layers,
      completeness: 'unknown',
      reasons: rejections,
      seeds: [],
      rules: [],
      bounds: requestedBounds(request),
    }, undefined, ceiling);
  }

  const resolution = workspace.kernel.resolveAddress(request.query);
  if (resolution.state !== 'resolved') {
    return packEnvelope({
      kind: 'unresolved',
      workspace,
      layers,
      completeness: 'unresolved',
      reasons: [resolution.reason],
      seeds: [],
      rules: [],
      bounds: requestedBounds(request),
      resolution: wireResolution(resolution),
    }, undefined, ceiling);
  }

  const seed = resolution.canonical;
  const maxDepth = request.max_depth ?? DEFAULT_MAX_DEPTH;
  const maxNodes = request.max_nodes ?? DEFAULT_MAX_NODES;
  const maxEdges = request.max_edges ?? DEFAULT_MAX_EDGES;
  const projectionRules = defaultRulesFor(seed);
  const projection = workspace.kernel.project({
    seeds: [seed], rules: projectionRules, maxHops: maxDepth, maxNodes, maxEdges,
  });
  const selection = selectRecords(workspace, projection, new Set([seed]), maxDepth);
  return packEnvelope({
    kind: 'projection',
    workspace,
    layers,
    completeness: projection.completeness,
    reasons: [...projection.reasons],
    seeds: [seed],
    rules: projectionRules.map((rule) => ({relation: rule.relation, direction: rule.direction})),
    bounds: {max_depth: maxDepth, max_nodes: maxNodes, max_edges: maxEdges},
  }, {selection, view: request.view ?? 'compact'}, ceiling);
}

/**
 * Emits every node and edge the kernel can reach from its compiler-owned seeds.
 *
 * A full export is an explicit operation, never a default focused response.
 *
 * @param workspace - One coherent presentation, compiler, and GraphIR snapshot.
 * @returns One frozen, deterministic export envelope with no byte ceiling.
 * @example
 * ```ts
 * exportGraphV2(loadGraphIrV2Workspace('.'));
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-945363a4
 * AC-e4a233ae
 * @see docs/design/spec-0.2/graph.md#edges-ownership-and-truth-status
 * @since 0.10.0
 */
export function exportGraphV2(workspace: GraphIrV2Workspace): WireEnvelopeV2 {
  const projection = wholeGraph(workspace);
  const selection = selectRecords(workspace, projection, new Set(), 1);
  return packEnvelope({
    kind: 'export',
    workspace,
    layers: wireLayers(workspace.layers),
    completeness: projection.completeness,
    reasons: [...projection.reasons],
    seeds: [],
    rules: [],
    bounds: {max_depth: null, max_nodes: null, max_edges: null},
  }, {selection, view: 'full'}, null);
}

/**
 * Reports deterministic corpus counts for a graph read that carried no query.
 *
 * @param workspace - One coherent presentation, compiler, and GraphIR snapshot.
 * @returns One frozen statistics envelope with no node or edge records.
 * @example
 * ```ts
 * statisticsV2(loadGraphIrV2Workspace('.')).statistics?.nodes.total;
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-f7f39bb9
 * @see docs/design/spec-0.2/graph.md#public-wire-boundary
 * @since 0.10.0
 */
export function statisticsV2(workspace: GraphIrV2Workspace): WireEnvelopeV2 {
  const projection = wholeGraph(workspace);
  return packEnvelope({
    kind: 'statistics',
    workspace,
    layers: wireLayers(workspace.layers),
    completeness: projection.completeness,
    reasons: [...projection.reasons],
    seeds: [],
    rules: [],
    bounds: {max_depth: null, max_nodes: null, max_edges: null},
    statistics: corpusStatistics(workspace, projection),
  }, undefined, null);
}

/** One node kept by the traversal, with the hop distance the packer drops by. */
interface SelectedNode {
  readonly address: string;
  readonly seed: boolean;
  readonly hops: number;
  readonly node: GraphIrV2Node;
}

interface Selection {
  readonly nodes: readonly SelectedNode[];
  readonly edges: readonly GraphIrV2Edge[];
  readonly presentations: ReadonlyMap<string, GraphPresentationRecord>;
}

interface EnvelopeBase {
  readonly kind: WireEnvelopeV2['kind'];
  readonly workspace: GraphIrV2Workspace;
  readonly layers: readonly WireLayerV2[];
  readonly completeness: GraphQueryCompleteness;
  readonly reasons: readonly string[];
  readonly seeds: readonly string[];
  readonly rules: readonly WireRuleV2[];
  readonly bounds: WireBoundsV2;
  readonly statistics?: WireStatisticsV2;
  readonly resolution?: WireResolutionV2;
}

interface Payload {
  readonly selection: Selection;
  readonly view: 'compact' | 'full';
}

interface TrimState {
  readonly kept: ReadonlySet<string>;
  readonly fieldsTrimmed: boolean;
  readonly requiredOverflow: boolean;
}

function rules(pairs: readonly (readonly [GraphRelation, GraphDirection])[]): readonly GraphProjectionRule[] {
  return Object.freeze(pairs.map(([relation, direction]) => Object.freeze({relation, direction})));
}

function wireLayers(layers: readonly GraphIrV2WorkspaceLayer[]): readonly WireLayerV2[] {
  return layers.map((layer) => ({
    id: layer.id,
    completeness: layer.completeness,
    reasons: [...layer.reasons],
  }));
}

function requestedBounds(request: FocusedGraphRequestV2): WireBoundsV2 {
  return {
    max_depth: request.max_depth ?? DEFAULT_MAX_DEPTH,
    max_nodes: request.max_nodes ?? DEFAULT_MAX_NODES,
    max_edges: request.max_edges ?? DEFAULT_MAX_EDGES,
  };
}

function boundRejections(request: FocusedGraphRequestV2): readonly string[] {
  return [
    boundRejection('max_depth', request.max_depth, DEPTH_LIMIT),
    boundRejection('max_nodes', request.max_nodes, NODE_LIMIT),
    boundRejection('max_edges', request.max_edges, EDGE_LIMIT),
  ].filter((reason): reason is string => reason !== undefined);
}

function boundRejection(field: string, value: number | undefined, limit: number): string | undefined {
  if (value === undefined) return undefined;
  if (Number.isInteger(value) && value >= 1 && value <= limit) return undefined;
  return `${field} must be an integer between 1 and ${limit}`;
}

function wireResolution(resolution: GraphAddressResolution): WireResolutionV2 {
  if (resolution.state === 'ambiguous') {
    return {
      state: 'ambiguous',
      input: resolution.input,
      reason: resolution.reason,
      candidates: [...resolution.candidates],
      accepted_forms: ACCEPTED_FORMS,
    };
  }
  return {
    state: 'unresolved',
    input: resolution.input,
    reason: resolution.state === 'resolved' ? 'address resolved' : resolution.reason,
    accepted_forms: ACCEPTED_FORMS,
  };
}

/**
 * Enumerates the kernel's complete node and edge set for a whole-graph read.
 *
 * A traversal from compiler-owned seeds can never reach an augmentation node
 * that carries no edge to a compiler node, so a corpus read asks the kernel for
 * what it holds. The answer is then complete unless a fact layer said it was
 * unknown or an edge names an endpoint the corpus does not carry.
 */
function wholeGraph(workspace: GraphIrV2Workspace): GraphProjection {
  const nodes = workspace.kernel.nodes();
  const edges = workspace.kernel.edges();
  const addresses = new Set(nodes.map((node) => node.address));
  const reasons = [
    ...workspace.layers
      .filter((layer) => layer.completeness === 'unknown')
      .flatMap((layer) => layer.reasons.map((reason) => `${layer.id}: ${reason}`)),
    ...edges
      .filter((edge) => !addresses.has(edge.from) || !addresses.has(edge.to))
      .map((edge) => `edge endpoint is absent: ${edgeId(edge)}`),
  ];
  return Object.freeze({
    nodes,
    edges,
    completeness: reasons.length === 0 ? 'complete' : 'unknown',
    reasons: Object.freeze([...new Set(reasons)].sort()),
    resolutions: Object.freeze([]),
  });
}

/**
 * Keeps only the edges the requested depth can justify, then measures hop
 * distance over exactly those edges. At depth 1 every retained edge touches a
 * seed, so a neighbour of a neighbour can never appear.
 */
function selectRecords(
  workspace: GraphIrV2Workspace,
  projection: GraphProjection,
  seeds: ReadonlySet<string>,
  maxDepth: number,
): Selection {
  const addresses = new Set(projection.nodes.map((node) => node.address));
  // Both endpoints must be materialized either way, so a bound the kernel
  // applied can never masquerade as a byte-ceiling omission by the packer.
  const edges = projection.edges.filter((edge) => addresses.has(edge.from) && addresses.has(edge.to)
    && (maxDepth > 1 || seeds.size === 0 || seeds.has(edge.from) || seeds.has(edge.to)));
  const hops = hopDistances(seeds, edges, addresses);
  const nodes = projection.nodes
    .map((node) => ({
      address: node.address,
      seed: seeds.has(node.address),
      hops: hops.get(node.address) ?? Number.MAX_SAFE_INTEGER,
      node,
    }))
    .sort(compareSelectedNode);
  const presentations = new Map<string, GraphPresentationRecord>();
  for (const record of workspace.kernel.presentationRecords()) {
    if (addresses.has(record.address)) presentations.set(record.address, record);
  }
  return {
    nodes,
    edges: [...edges].sort((left, right) => edgeId(left).localeCompare(edgeId(right))),
    presentations,
  };
}

function hopDistances(
  seeds: ReadonlySet<string>,
  edges: readonly GraphIrV2Edge[],
  addresses: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const neighbours = new Map<string, string[]>();
  for (const edge of edges) {
    if (!addresses.has(edge.from) || !addresses.has(edge.to)) continue;
    (neighbours.get(edge.from) ?? neighbours.set(edge.from, []).get(edge.from)!).push(edge.to);
    (neighbours.get(edge.to) ?? neighbours.set(edge.to, []).get(edge.to)!).push(edge.from);
  }
  const distances = new Map<string, number>();
  let frontier = [...seeds].filter((address) => addresses.has(address));
  for (const address of frontier) distances.set(address, 0);
  let depth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const address of frontier) {
      for (const neighbour of neighbours.get(address) ?? []) {
        if (distances.has(neighbour)) continue;
        distances.set(neighbour, depth);
        next.push(neighbour);
      }
    }
    frontier = next;
  }
  return distances;
}

function compareSelectedNode(left: SelectedNode, right: SelectedNode): number {
  if (left.seed !== right.seed) return left.seed ? -1 : 1;
  return left.address.localeCompare(right.address);
}

/**
 * Serializes, measures, and — while the payload exceeds the ceiling — trims in
 * a fixed order, remeasuring to a byte fixed point after every step. Required
 * seed facts are never silently truncated; when they alone overflow, the
 * response says so and keeps them.
 */
function packEnvelope(
  base: EnvelopeBase,
  payload: Payload | undefined,
  ceiling: number | null,
): WireEnvelopeV2 {
  const selection = payload?.selection;
  let state: TrimState = {
    kept: new Set(selection?.nodes.map((node) => node.address) ?? []),
    fieldsTrimmed: false,
    requiredOverflow: false,
  };
  const dropOrder = (selection?.nodes ?? [])
    .filter((node) => !node.seed)
    .sort((left, right) => right.hops - left.hops || right.address.localeCompare(left.address))
    .map((node) => node.address);
  let dropped = 0;
  for (;;) {
    const measured = measureToFixedPoint(base, payload, state, ceiling);
    if (ceiling === null || measured.bytes <= ceiling) return measured.envelope;
    if (!state.fieldsTrimmed && payload !== undefined) {
      state = {...state, fieldsTrimmed: true};
      continue;
    }
    if (dropped < dropOrder.length) {
      const kept = new Set(state.kept);
      kept.delete(dropOrder[dropped]!);
      dropped += 1;
      state = {...state, kept};
      continue;
    }
    return measureToFixedPoint(base, payload, {...state, requiredOverflow: true}, ceiling).envelope;
  }
}

function measureToFixedPoint(
  base: EnvelopeBase,
  payload: Payload | undefined,
  state: TrimState,
  ceiling: number | null,
): {readonly envelope: WireEnvelopeV2; readonly bytes: number} {
  let bytes = 0;
  for (let round = 0; round < MAX_MEASURE_ROUNDS; round++) {
    const envelope = buildEnvelope(base, payload, state, ceiling, bytes);
    const measured = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
    if (measured === bytes) return {envelope, bytes};
    bytes = measured;
  }
  throw new Error('GraphIR wire packing did not reach a serialized byte fixed point.');
}

function buildEnvelope(
  base: EnvelopeBase,
  payload: Payload | undefined,
  state: TrimState,
  ceiling: number | null,
  payloadBytes: number,
): WireEnvelopeV2 {
  const rendered = payload === undefined ? undefined : renderPayload(payload, state);
  // The packer's own actions lead the list. A corpus query can carry more
  // traversal-bound reasons than the retained head holds, and an envelope that
  // trimmed itself must always be able to say so.
  const packerReasons: string[] = [];
  if (rendered && rendered.omittedNodes > 0) {
    packerReasons.push(`packer: dropped ${rendered.omittedNodes} node(s) and ${rendered.omittedEdges} edge(s) to fit the byte ceiling`);
  }
  if (rendered && rendered.omittedFields > 0) {
    packerReasons.push(`packer: dropped ${rendered.omittedFields} optional field value(s) to fit the byte ceiling`);
  }
  if (state.requiredOverflow) {
    packerReasons.push('packer: required seed facts exceed the byte ceiling and were retained in full');
  }
  const reasons = [...packerReasons, ...base.reasons];
  const completeness = degradeCompleteness(base.completeness, rendered);
  return {
    schema_version: 2,
    kind: base.kind,
    workspace_schema: base.workspace.compilation.schemaVersion,
    layers: base.layers,
    completeness,
    reasons: reasons.slice(0, MAX_REASONS),
    ...(rendered ? {nodes: rendered.nodes, edges: rendered.edges} : {}),
    ...(base.statistics ? {statistics: base.statistics} : {}),
    ...(base.resolution ? {resolution: base.resolution} : {}),
    meta: {
      seeds: base.seeds,
      rules: base.rules,
      bounds: base.bounds,
      counts: {nodes: rendered?.nodes.length ?? 0, edges: rendered?.edges.length ?? 0},
      omitted: {
        nodes: rendered?.omittedNodes ?? 0,
        edges: rendered?.omittedEdges ?? 0,
        reasons: Math.max(0, reasons.length - MAX_REASONS),
        fields: rendered?.omittedFields ?? 0,
      },
      required_overflow: state.requiredOverflow,
      payload_utf8_bytes: payloadBytes,
      byte_ceiling: ceiling,
      token_estimate: {estimator: TOKEN_ESTIMATOR, tokens: Math.ceil(payloadBytes / 4)},
    },
  };
}

function degradeCompleteness(
  completeness: GraphQueryCompleteness,
  rendered: RenderedPayload | undefined,
): GraphQueryCompleteness {
  if (completeness === 'unknown' || completeness === 'unresolved') return completeness;
  if (rendered && (rendered.omittedNodes > 0 || rendered.omittedEdges > 0)) return 'bounded';
  return completeness;
}

interface RenderedPayload {
  readonly nodes: readonly WireNodeV2[];
  readonly edges: readonly WireEdgeV2[];
  readonly omittedNodes: number;
  readonly omittedEdges: number;
  readonly omittedFields: number;
}

function renderPayload(payload: Payload, state: TrimState): RenderedPayload {
  const {selection, view} = payload;
  let omittedFields = 0;
  const nodes: WireNodeV2[] = [];
  for (const selected of selection.nodes) {
    if (!state.kept.has(selected.address)) continue;
    const strip = state.fieldsTrimmed && !selected.seed;
    const record = wireNode(selected, selection.presentations.get(selected.address), view, strip);
    omittedFields += record.omitted;
    nodes.push(record.node);
  }
  const edges: WireEdgeV2[] = [];
  for (const edge of selection.edges) {
    if (!state.kept.has(edge.from) || !state.kept.has(edge.to)) continue;
    const record = wireEdge(edge, state.fieldsTrimmed);
    omittedFields += record.omitted;
    edges.push(record.edge);
  }
  return {
    nodes,
    edges,
    omittedNodes: selection.nodes.length - nodes.length,
    omittedEdges: selection.edges.length - edges.length,
    omittedFields,
  };
}

function wireNode(
  selected: SelectedNode,
  presentation: GraphPresentationRecord | undefined,
  view: 'compact' | 'full',
  strip: boolean,
): {readonly node: WireNodeV2; readonly omitted: number} {
  const node = selected.node;
  const owner = nodeOwner(node);
  const state = nodeState(node);
  const title = presentation?.title;
  const slug = presentation?.slug;
  const status = presentation?.status;
  const purpose = view === 'full' ? presentation?.purpose : undefined;
  const dropped = strip ? [owner, title, slug, status, purpose].filter((value) => value !== undefined).length : 0;
  return {
    node: {
      address: node.address,
      type: node.nodeType,
      ...(node.nodeType === 'semantic' ? {kind: node.kind} : {}),
      ...(node.nodeType === 'artifact' ? {roles: [...node.roles]} : {}),
      ...(node.nodeType === 'anchor' ? {artifact: node.artifact, selector: node.selector} : {}),
      provenance: node.provenance,
      ...(state === undefined ? {} : {state}),
      ...(strip || owner === undefined ? {} : {owner}),
      ...(strip || title === undefined ? {} : {title}),
      ...(strip || slug === undefined ? {} : {slug}),
      ...(strip || status === undefined ? {} : {status}),
      ...(strip || purpose === undefined ? {} : {purpose}),
    },
    omitted: dropped,
  };
}

function wireEdge(edge: GraphIrV2Edge, strip: boolean): {readonly edge: WireEdgeV2; readonly omitted: number} {
  const channel = 'channel' in edge ? edge.channel : undefined;
  const selector = edge.selector?.value;
  const raw = edge.raw;
  const dropped = strip ? [channel, raw, selector].filter((value) => value !== undefined).length : 0;
  return {
    edge: {
      id: edgeId(edge),
      from: edge.from,
      to: edge.to,
      relation: edge.relation,
      provenance: edge.provenance,
      ...(edge.state === undefined ? {} : {state: edge.state}),
      ...(strip || channel === undefined ? {} : {channel}),
      ...(strip || raw === undefined ? {} : {raw}),
      ...(strip || selector === undefined ? {} : {selector}),
    },
    omitted: dropped,
  };
}

function edgeId(edge: GraphIrV2Edge): string {
  return 'address' in edge ? edge.address : edge.identity;
}

function nodeOwner(node: GraphIrV2Node): string | undefined {
  if ('source' in node && node.source) return `${node.source.path}:${node.source.range.line}`;
  if ('locator' in node) {
    return node.locator.kind === 'text_source'
      ? node.locator.path
      : `${node.locator.adapter}:${node.locator.reference}`;
  }
  return undefined;
}

/**
 * Reads an observed truth state when a fact layer supplies one. No compiler
 * node carries a state today; the read stays defensive so a future observed
 * node layer surfaces its state instead of silently losing it.
 */
function nodeState(node: GraphIrV2Node): string | undefined {
  const state = (node as {readonly state?: unknown}).state;
  return typeof state === 'string' ? state : undefined;
}

function corpusStatistics(workspace: GraphIrV2Workspace, projection: GraphProjection): WireStatisticsV2 {
  const byType = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const node of projection.nodes) {
    increment(byType, node.nodeType);
    if (node.nodeType === 'semantic') increment(byKind, node.kind);
  }
  const byRelation = new Map<string, number>();
  const byState = new Map<string, number>();
  for (const edge of projection.edges) {
    increment(byRelation, edge.relation);
    // A compiler edge that carries no truth claim at all is distinct from an
    // observation adapter reporting `unobserved`; conflating them would read as
    // a missing runner result for every structural relation in the corpus.
    increment(byState, edge.state ?? 'none');
  }
  const hubs = [...workspace.kernel.corpusRecords().artifactOwners]
    .map((record) => ({artifact: record.artifact, owners: record.owners.length}))
    .sort((left, right) => right.owners - left.owners || left.artifact.localeCompare(right.artifact))
    .slice(0, 10);
  return {
    nodes: {total: projection.nodes.length, by_type: sortedCounts(byType), by_kind: sortedCounts(byKind)},
    edges: {total: projection.edges.length, by_relation: sortedCounts(byRelation), by_state: sortedCounts(byState)},
    artifact_hubs: hubs,
  };
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function sortedCounts(counts: ReadonlyMap<string, number>): Readonly<Record<string, number>> {
  const sorted: Record<string, number> = {};
  for (const key of [...counts.keys()].sort()) sorted[key] = counts.get(key)!;
  return sorted;
}
