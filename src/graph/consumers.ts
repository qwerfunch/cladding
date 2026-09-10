// Cladding · Spec 0.2 F8 · one consumer contract over GraphIR, with a parity-checked structural projection for latency-bounded lanes.
//
// Every F8-owned consumer (impact slice, iterative slice, working set, measurement,
// dependency inference, the review report, MCP, the live HTTP server, the knowledge
// graph model) used to reach for its own materialized reverse index. That was a second
// graph authority: it answered "who owns this file" and "what depends on this" from the
// presentation instead of from the compiler IR, so a GraphIR fix could not reach the
// consumers and a consumer fix could not reach GraphIR.
//
// This module is the single seam. `GraphConsumerView` is the ONE contract those
// consumers hold; two implementations satisfy it:
//
//   • graphIrConsumerView(workspace, spec) — the canonical lane, reached through
//     `graphIrView(cwd, spec)` in src/graph/query.ts. Owners come from inbound `touches`
//     edges, dependents from the inverse of `depends_on`, and feature resolution from
//     the kernel's canonical address resolver. Measured on cladding-self: one cold
//     workspace read costs ~840 ms (compile 668 ms + live-binding census 150 ms), and
//     every query after that is sub-millisecond. The reader lives in query.ts and not
//     here because src/spec/edit.ts reaches inferDependsOn: a consumer module that
//     imported the workspace reader would close an import cycle the architecture gate
//     rejects.
//   • structuralView(spec) — the same answers projected from the loaded Spec, for lanes
//     with a hard latency budget (the PostToolUse hook fires on every edit and must stay
//     in single-digit milliseconds). It is legitimate ONLY because the parity suite
//     proves the two views identical; see tests/optimizer/graph-ir-consumers.test.ts.
//
// WHY owners read inbound `touches` and not `kernel.artifactOwners`: an artifact node's
// `owners` field carries `defined_in` ownership as well, so a feature's own shard file
// (and, once the live-binding layer joins, its test files) would answer as an owned
// module. Measured on cladding-self that turns 288 shard paths into resolvable module
// queries and changes 6 more — a different question than "which features declare this
// file in `modules`", which is what every consumer means. `touches` is exactly that
// question and matches the structural projection edge for edge (1474 = 1474).
//
// WHY citations and the test-reference ledger read the workspace presentation and not a
// GraphIR relation: under schema 0.2 a shard carries no authored `test_refs` at all. The
// presentation derives them through the F5 selection (live binding > reviewed carry-
// forward > exempt legacy), and the compiler deliberately keeps historic migration
// bindings OUT of GraphIR edges. The kernel's live `covers` facts are therefore a strict
// subset — 22 pairs short on cladding-self at cutover, every one of them a criterion whose
// reference survives only as a reviewed carry-forward — and reproducing the remainder would
// mean re-running F5 selection here, a second authority, which is what F8 retires. So both lanes
// read the same declared-reference fact, the kernel lane from the compiler's own
// presentation snapshot, and the parity suite proves the two snapshots agree.
//
// @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74

import {artifactAddress} from '../spec/compiler/graph-address.js';
import {testRefPath} from '../spec/compiler/legacy-reference.js';
import type {GraphIrV2Kernel} from '../spec/compiler/graph-ir-v2.js';
import type {Feature, Spec} from '../spec/types.js';

/**
 * The reachable dependent set for one query plus its own honesty about the bound.
 *
 * `bounded` means the caller's depth stopped the walk while the frontier still had
 * somewhere to go — the answer is a floor, not the blast radius.
 *
 * @since 0.10.0
 * @internal
 */
export interface GraphDependentsResult {
  /** Feature ids downstream of the seeds; never contains a seed. */
  readonly ids: ReadonlySet<string>;
  /** Whether the walk closed on its own (`complete`) or the depth cut it short. */
  readonly completeness: 'complete' | 'bounded';
}

/** Spec-wide edge counts, the disambiguator for an empty answer on a blank ledger. */
export interface GraphLedgerCounts {
  /** Total authored feature-to-prerequisite edges. */
  readonly depends_on_edges: number;
  /** Total distinct (test file, feature) declared-reference pairs. */
  readonly test_ref_edges: number;
}

/**
 * The single graph contract every F8-owned consumer holds.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @since 0.10.0
 * @internal
 */
export interface GraphConsumerView {
  /** Which implementation answered — carried into consumer payloads, never inferred. */
  readonly authority: 'graph-ir' | 'spec-structural';
  /** Feature ids that declare `path` in `modules`; many-to-many by design. */
  owners(path: string): readonly string[];
  /** Transitive dependents of the seeds, seeds excluded, bounded to `depth` hops. */
  dependents(featureIds: readonly string[], depth: number): GraphDependentsResult;
  /** Feature ids whose criteria declare a reference to `testPath`. */
  citations(testPath: string): readonly string[];
  /** Spec-wide edge counts. */
  ledger(): GraphLedgerCounts;
  /** Resolves a feature id or slug; an ambiguous spelling resolves to nothing. */
  resolveFeature(query: string): Feature | undefined;
  /** Why this view is degraded, empty when it is not. */
  readonly reasons: readonly string[];
}

/** How a consumer selects its lane without having to know which one it got. */
export interface GraphViewOptions {
  /** An already-built view. Lane selection is ALWAYS explicit: a `cwd` shortcut would
   *  make the hook lane (which passes a cwd for code excerpts) silently pay the ~840 ms
   *  canonical workspace read, and would force this module to import that reader. */
  readonly graph?: GraphConsumerView;
}

// ─── structural projection ───

interface StructuralIndex {
  readonly dependents: ReadonlyMap<string, ReadonlySet<string>>;
  readonly moduleOwners: ReadonlyMap<string, ReadonlySet<string>>;
  readonly testRefCitations: ReadonlyMap<string, ReadonlySet<string>>;
  readonly featureById: ReadonlyMap<string, Feature>;
  /** Spelling (id or slug) → the one feature it names, or null when several claim it. */
  readonly featureBySpelling: ReadonlyMap<string, Feature | null>;
}

/** Appends `value` to the set stored at `key`, creating the set on first use. */
function addEdge(map: Map<string, Set<string>>, key: string, value: string): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  set.add(value);
}

/** Inverts one Spec's forward edges. Pure: reads the spec, allocates, mutates nothing. */
function buildStructuralIndex(spec: Spec): StructuralIndex {
  const dependents = new Map<string, Set<string>>();
  const moduleOwners = new Map<string, Set<string>>();
  const testRefCitations = new Map<string, Set<string>>();
  const featureById = new Map<string, Feature>();
  // A spelling claimed by two features resolves to NOTHING, matching the canonical
  // resolver: guessing which of two same-slug features was meant is the ambiguity the
  // address authority refuses, and a projection that guesses anyway is not a projection.
  const spellingOwners = new Map<string, Set<string>>();

  for (const feature of spec.features ?? []) {
    const fid = feature.id;
    if (!featureById.has(fid)) featureById.set(fid, feature);
    addEdge(spellingOwners, fid, fid);
    const slug = (feature as {slug?: string}).slug;
    if (slug) addEdge(spellingOwners, slug, fid);
    for (const dep of feature.depends_on ?? []) addEdge(dependents, dep, fid);
    for (const modulePath of feature.modules ?? []) addEdge(moduleOwners, modulePath, fid);
    for (const criterion of feature.acceptance_criteria ?? []) {
      for (const ref of criterion.test_refs ?? []) {
        const path = testRefPath(ref);
        if (path) addEdge(testRefCitations, path, fid);
      }
    }
  }
  const featureBySpelling = new Map<string, Feature | null>();
  for (const [spelling, ids] of spellingOwners) {
    const only = ids.size === 1 ? featureById.get([...ids][0]) : undefined;
    featureBySpelling.set(spelling, only ?? null);
  }
  return {dependents, moduleOwners, testRefCitations, featureById, featureBySpelling};
}

// Memoized by Spec identity. The run-scoped spec cache holds one Spec object per gate
// run, so the index is computed once per run and is collected with the spec it keys —
// it can never serve a stale answer.
const STRUCTURAL_INDEX = new WeakMap<Spec, StructuralIndex>();

function structuralIndexOf(spec: Spec): StructuralIndex {
  let index = STRUCTURAL_INDEX.get(spec);
  if (!index) {
    index = buildStructuralIndex(spec);
    STRUCTURAL_INDEX.set(spec, index);
  }
  return index;
}

/**
 * The one hop budget both lanes read.
 *
 * A depth arrives from a CLI flag (`Number(opts.depth)`), so it can be fractional or NaN.
 * Normalizing in one place is what keeps the lanes identical off the integers: a raw
 * `hop < 2.5` walks three rings while a kernel bound of `trunc(2.5)` walks two, and a raw
 * `hop < NaN` walks none while a non-finite kernel bound would walk the whole closure.
 *
 * @param depth - Caller-supplied hop bound; may be fractional, negative, NaN, or Infinity.
 * @returns An integer hop count, or `saturate` for an explicitly unbounded walk.
 */
function normalizeDepth(depth: number): number | 'saturate' {
  if (Number.isNaN(depth)) return 0;
  if (!Number.isFinite(depth)) return depth > 0 ? 'saturate' : 0;
  return Math.max(0, Math.trunc(depth));
}

/**
 * Multi-source reverse walk with one ring size per hop.
 *
 * The per-ring sizes are what makes `completeness` decidable identically in both
 * lanes: the walk closed when the last executed ring added no new node, which is the
 * same statement as `|reached(depth)| === |reached(depth - 1)|` — the only form the
 * GraphIR lane can also compute, since the kernel answers per depth, not per ring.
 */
function structuralWalk(
  seedIds: Iterable<string>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
  depth: number,
): {readonly ids: Set<string>; readonly closed: boolean} {
  const ids = new Set<string>();
  const seen = new Set<string>(seedIds);
  let frontier = [...seen];
  let hop = 0;
  let closed = depth <= 0;
  while (frontier.length > 0 && hop < depth) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const dependent of edges.get(id) ?? []) {
        if (seen.has(dependent)) continue;
        seen.add(dependent);
        ids.add(dependent);
        next.push(dependent);
      }
    }
    frontier = next;
    hop++;
    closed = next.length === 0;
  }
  return {ids, closed};
}

const STRUCTURAL_VIEW = new WeakMap<Spec, GraphConsumerView>();

/**
 * Projects the graph answers a consumer needs straight from a loaded Spec.
 *
 * Legitimate only while the parity suite proves it identical to the GraphIR lane;
 * it exists for the PostToolUse hook, which fires on every edit and cannot pay the
 * measured ~840 ms cold workspace read.
 *
 * @param spec - One loaded presentation Spec.
 * @returns The structural view, memoized for that Spec object's lifetime.
 * @example
 * ```ts
 * structuralView(spec).owners('src/spec/load.ts');
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @since 0.10.0
 * @internal
 */
export function structuralView(spec: Spec): GraphConsumerView {
  const cached = STRUCTURAL_VIEW.get(spec);
  if (cached) return cached;
  const index = structuralIndexOf(spec);
  const view: GraphConsumerView = Object.freeze({
    authority: 'spec-structural',
    reasons: Object.freeze([]),
    owners(path: string): readonly string[] {
      return [...(index.moduleOwners.get(path) ?? [])].sort();
    },
    dependents(featureIds: readonly string[], depth: number): GraphDependentsResult {
      const bound = normalizeDepth(depth);
      const walk = structuralWalk(featureIds, index.dependents, bound === 'saturate' ? Infinity : bound);
      return {ids: walk.ids, completeness: walk.closed ? 'complete' : 'bounded'};
    },
    citations(testPath: string): readonly string[] {
      return [...(index.testRefCitations.get(testPath) ?? [])].sort();
    },
    ledger(): GraphLedgerCounts {
      let dependsOn = 0;
      for (const set of index.dependents.values()) dependsOn += set.size;
      let testRefs = 0;
      for (const set of index.testRefCitations.values()) testRefs += set.size;
      return {depends_on_edges: dependsOn, test_ref_edges: testRefs};
    },
    resolveFeature(query: string): Feature | undefined {
      return index.featureBySpelling.get(query) ?? undefined;
    },
  });
  STRUCTURAL_VIEW.set(spec, view);
  return view;
}

// ─── GraphIR lane ───

const FEATURE_PREFIX = 'feature:';

/** Reads a feature id out of a canonical GraphIR feature address. */
function featureIdOf(address: string): string | undefined {
  return address.startsWith(FEATURE_PREFIX) ? address.slice(FEATURE_PREFIX.length) : undefined;
}

/**
 * A memoized reader over one immutable kernel.
 *
 * The kernel is immutable for the life of its compilation, so caching a query answer
 * cannot go stale, and the iterative slice asks the same question at ten depths in a
 * row — without this the measurement pass would re-walk the same seeds thousands of
 * times.
 */
class GraphIrConsumerView implements GraphConsumerView {
  readonly authority = 'graph-ir' as const;

  private readonly ownersByPath = new Map<string, readonly string[]>();
  private readonly reachedBySeed = new Map<string, ReadonlySet<string>>();
  private readonly citationsByPath: ReadonlyMap<string, readonly string[]>;
  private readonly featureById: ReadonlyMap<string, Feature>;
  private readonly resolvedIds = new Map<string, string | undefined>();
  private readonly saturatingDepth: number;
  private readonly ledgerCounts: GraphLedgerCounts;

  constructor(
    private readonly kernel: GraphIrV2Kernel,
    presentation: Spec,
    callerSpec: Spec,
    readonly reasons: readonly string[],
  ) {
    const index = structuralIndexOf(presentation);
    this.citationsByPath = new Map(
      [...index.testRefCitations].map(([path, owners]) => [path, Object.freeze([...owners].sort())]),
    );
    this.featureById = structuralIndexOf(callerSpec).featureById;
    // A reverse walk over a finite feature graph visits every node at most once, so
    // the node count is a bound that can never truncate an unbounded request. The
    // kernel refuses a non-finite bound, and cladding-self already carries 41-hop
    // chains, so a small fixed cap would silently shorten a real blast radius.
    this.saturatingDepth = kernel.nodes().filter((node) => node.address.startsWith(FEATURE_PREFIX)).length + 1;
    let testRefs = 0;
    for (const owners of index.testRefCitations.values()) testRefs += owners.size;
    // Counted off the authored edges rather than `corpusRecords().dependents`, which is
    // built by walking inbound from every FEATURE node: a `depends_on` naming a feature
    // that does not exist still emits an edge, but its target is no node to walk from, so
    // the record view silently drops it. On a freshly adopted project whose only edges are
    // dangling that would report an empty ledger — the exact "unknown, not safe" signal the
    // count exists to distinguish.
    const declared = new Set<string>();
    for (const edge of kernel.edges()) {
      if (edge.relation === 'depends_on' && edge.provenance === 'authored') declared.add(`${edge.from}\u0000${edge.to}`);
    }
    this.ledgerCounts = Object.freeze({depends_on_edges: declared.size, test_ref_edges: testRefs});
  }

  owners(path: string): readonly string[] {
    const cached = this.ownersByPath.get(path);
    if (cached) return cached;
    let owners: readonly string[] = [];
    let address: string | undefined;
    try {
      address = artifactAddress(path);
    } catch {
      address = undefined; // not a repository-relative path — it owns nothing
    }
    if (address !== undefined) {
      const projection = this.kernel.project({
        seeds: [address],
        rules: [{relation: 'touches', direction: 'inbound'}],
        maxHops: 1,
        maxNodes: this.kernel.nodes().length,
        maxEdges: this.kernel.edges().length,
      });
      owners = Object.freeze([...new Set(projection.edges
        .filter((edge) => edge.relation === 'touches' && edge.to === address)
        .map((edge) => featureIdOf(edge.from))
        .filter((id): id is string => id !== undefined))].sort());
    }
    this.ownersByPath.set(path, owners);
    return owners;
  }

  dependents(featureIds: readonly string[], depth: number): GraphDependentsResult {
    const normalized = normalizeDepth(depth);
    const bound = normalized === 'saturate' ? this.saturatingDepth : normalized;
    const seeds = new Set(featureIds);
    const at = (hops: number): Set<string> => {
      const union = new Set<string>();
      if (hops <= 0) return union;
      for (const seed of seeds) for (const id of this.reachedAt(seed, hops)) union.add(id);
      for (const seed of seeds) union.delete(seed);
      return union;
    };
    const reached = at(bound);
    // Same closure rule as the structural walk: the last ring added nothing new.
    const closed = bound >= this.saturatingDepth || reached.size === at(bound - 1).size;
    return {ids: reached, completeness: closed ? 'complete' : 'bounded'};
  }

  citations(testPath: string): readonly string[] {
    return this.citationsByPath.get(testPath) ?? [];
  }

  ledger(): GraphLedgerCounts {
    return this.ledgerCounts;
  }

  resolveFeature(query: string): Feature | undefined {
    let id = this.resolvedIds.get(query);
    if (id === undefined && !this.resolvedIds.has(query)) {
      const resolution = this.kernel.resolveAddress(query);
      id = resolution.state === 'resolved' ? featureIdOf(resolution.canonical) : undefined;
      this.resolvedIds.set(query, id);
    }
    return id === undefined ? undefined : this.featureById.get(id);
  }

  /** Feature ids reachable from ONE seed within `hops`, memoized per (seed, hops). */
  private reachedAt(seed: string, hops: number): ReadonlySet<string> {
    const key = `${seed}\u0000${hops}`;
    const cached = this.reachedBySeed.get(key);
    if (cached) return cached;
    const result = this.kernel.dependents(`${FEATURE_PREFIX}${seed}`, hops);
    const ids = new Set<string>();
    for (const record of result.records) {
      const id = featureIdOf(record.dependent);
      if (id !== undefined) ids.add(id);
    }
    ids.delete(seed);
    this.reachedBySeed.set(key, ids);
    return ids;
  }
}

/**
 * Wraps one already-built GraphIR workspace as the canonical consumer view.
 *
 * The workspace is taken as a parameter rather than read here so this module never
 * imports the workspace reader: `src/spec/edit.ts` reaches `inferDependsOn`, so a
 * consumer module that pulled `graph/query` would close an import cycle the
 * architecture gate rejects. `graphIrView` in `src/graph/query.ts` is the reader-side
 * entry point, including its degrade-with-a-reason path.
 *
 * @param workspace - One coherent presentation, compilation, and kernel snapshot.
 * @param spec - The caller's own presentation, so resolved features stay its objects.
 * @returns The canonical view over that workspace.
 * @example
 * ```ts
 * graphIrConsumerView(loadGraphIrV2Workspace(cwd), spec).owners('src/spec/load.ts');
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @since 0.10.0
 * @internal
 */
export function graphIrConsumerView(
  workspace: {
    readonly kernel: GraphIrV2Kernel;
    readonly spec: Spec;
    readonly layers: readonly {readonly id: string; readonly reasons: readonly string[]}[];
  },
  spec: Spec,
): GraphConsumerView {
  const reasons = Object.freeze(workspace.layers.flatMap((layer) =>
    layer.reasons.map((reason) => `${layer.id}: ${reason}`)));
  return new GraphIrConsumerView(workspace.kernel, workspace.spec, spec, reasons);
}

/**
 * Wraps the structural projection as an explicitly degraded view.
 *
 * A caller that asked for the canonical authority and could not have it must be told
 * why; a silent structural answer would read as the kernel's answer.
 *
 * @param spec - The caller's loaded presentation.
 * @param reason - Why the canonical workspace was unavailable.
 * @returns The structural projection, labelled with the reason.
 * @example
 * ```ts
 * degradedConsumerView(spec, 'graph-ir workspace unavailable: …');
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-d452908b
 * @since 0.10.0
 * @internal
 */
export function degradedConsumerView(spec: Spec, reason: string): GraphConsumerView {
  const degraded = structuralView(spec);
  return Object.freeze({
    authority: 'spec-structural' as const,
    reasons: Object.freeze([reason]),
    owners: (path: string) => degraded.owners(path),
    dependents: (ids: readonly string[], depth: number) => degraded.dependents(ids, depth),
    citations: (testPath: string) => degraded.citations(testPath),
    ledger: () => degraded.ledger(),
    resolveFeature: (query: string) => degraded.resolveFeature(query),
  });
}

/**
 * Selects the lane for one consumer call without the consumer knowing which it got.
 *
 * An explicit view always wins, so a command builds the canonical view once and threads
 * it through every nested call. No view leaves the structural projection, which is what
 * a latency-bounded caller wants.
 *
 * @param spec - The caller's loaded presentation.
 * @param opts - An explicit view, if the caller built one.
 * @returns The selected consumer view.
 * @example
 * ```ts
 * const view = viewFor(spec, {graph: opts.graph});
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @since 0.10.0
 * @internal
 */
export function viewFor(spec: Spec, opts: GraphViewOptions = {}): GraphConsumerView {
  return opts.graph ?? structuralView(spec);
}
