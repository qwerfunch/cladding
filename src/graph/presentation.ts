// Cladding · Spec 0.2 F8 · GraphIR v2 → presentation graph adapter (the shape renderers and the viewer already consume).
//
// The exporters, the stats pass, the health stage, and the WebGL viewer all read one
// small typed shape: kind-prefixed nodes and seven presentation edge kinds. That shape
// used to be assembled by `buildGraph`, a second traversal of the spec that answered
// "which features touch this file" and "which docs reference this feature" from the
// presentation instead of from the compiler IR — the same second-authority problem F8
// retired everywhere else.
//
// `presentGraph` derives the identical shape from one GraphIR workspace, so the renderers
// keep their contract while the answers come from the kernel. The presentation types
// themselves live here now (`src/graph/model.ts` re-exports them) because they describe
// the VIEW, not the graph: `module` vs `skill` is a display distinction the compiler has
// no opinion about, and `Tier` is an SSoT banner read off the file, not a compiled fact.
//
// WHY doc nodes are derived from EDGES and not from `roles: ['doc']` artifacts: the
// document fact layer materializes an artifact for every enumerated `docs/**.md`,
// including unreadable and edge-free ones. The presentation has always shown only docs
// that carry at least one reference or link, so the edge set — not the artifact set — is
// the predicate that reproduces it.
//
// WHY `covers` reads the workspace presentation's `test_refs` and not the kernel's live
// `covers` facts: under schema 0.2 nothing authors `test_refs`; the presentation derives
// them through the F5 selection (live binding > reviewed carry-forward > exempt legacy)
// and the compiler deliberately keeps historic migration bindings out of GraphIR edges.
// Reading the kernel's strict subset would silently drop every reviewed carry-forward
// citation, and reproducing the remainder here would re-run F5 selection as a second
// authority. Same reasoning as `src/graph/consumers.ts`.
//
// Pure + derived: reads one immutable workspace, reads doc tier banners off disk,
// allocates a fresh graph, mutates nothing.
//
// @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {parseAnchorAddress} from '../spec/compiler/graph-address.js';
import {testRefPath} from '../spec/compiler/legacy-reference.js';
import type {GraphIrV2Kernel} from '../spec/compiler/graph-ir-v2.js';
import type {Spec} from '../spec/types.js';

export type NodeKind = 'feature' | 'module' | 'skill' | 'test' | 'scenario' | 'capability' | 'doc';

/** SSoT tier of a spec/doc artifact (docs/ssot-model.md): A=sealed spec, B=design, C=derived, D=transient. */
export type Tier = 'A' | 'B' | 'C' | 'D';

export type EdgeKind =
  | 'depends_on' // feature → feature
  | 'touches' //    feature → module
  | 'covers' //     feature → test
  | 'binds' //      scenario → feature
  | 'implements' // capability → feature
  | 'references' // doc → feature
  | 'links'; //     doc → doc

export interface GraphNode {
  /** Globally unique, kind-prefixed (e.g. `feature:F-001`, `module:src/a.ts`). */
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly status?: string;
  /** SSoT tier for spec/doc nodes (features/scenarios=A, capabilities=B, docs parsed). Absent for code (module/test). */
  readonly tier?: Tier;
  /** Secondary label for hover/inspect — e.g. a feature's full title when `label` is its slug. */
  readonly detail?: string;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
}

export interface KnowledgeGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/** A skill artifact (skills/<verb>/… incl. plugin mirrors like plugins/codex/skills/…) —
 *  its own node kind so SKILL.md files read distinctly from ordinary code modules. */
function isSkillPath(p: string): boolean {
  return /(?:^|\/)skills\//.test(p);
}

/** node id helpers — kind prefix keeps ids unique across kinds. */
export const nodeId = {
  feature: (id: string) => `feature:${id}`,
  module: (p: string) => `module:${p}`,
  test: (p: string) => `test:${p}`,
  scenario: (id: string) => `scenario:${id}`,
  capability: (id: string) => `capability:${id}`,
  doc: (p: string) => `doc:${p}`,
};

// First-line tier banner: `# Cladding · Tier B …` (YAML) or `<!-- Cladding · Tier C …` (markdown).
const TIER_BANNER_RE = /^\s*(?:#|<!--)\s*Cladding\s*·\s*Tier\s+([A-D])\b/;
// Fallback for managed artifacts that may lack a banner (docs/ssot-model.md registry).
const KNOWN_DOC_TIERS = new Map<string, Tier>([
  ['spec/architecture.yaml', 'B'],
  ['spec/capabilities.yaml', 'B'],
  ['docs/project-context.md', 'B'],
  ['docs/conventions.md', 'C'],
  ['docs/glossary.md', 'C'],
  ['spec/index.yaml', 'C'],
  ['spec/_doc-links.yaml', 'C'],
]);

/**
 * Classifies a doc/spec file into its SSoT tier: the first-line `Cladding · Tier X`
 * banner wins; else a known-filename fallback; else undefined (unmanaged doc).
 */
export function extractTierFromDoc(relPath: string, cwd: string = '.'): Tier | undefined {
  try {
    const firstLine = readFileSync(join(cwd, relPath), 'utf8').split('\n', 1)[0] ?? '';
    const m = TIER_BANNER_RE.exec(firstLine);
    if (m) return m[1] as Tier;
  } catch {
    /* unreadable → fall through to the fallback map */
  }
  return KNOWN_DOC_TIERS.get(relPath);
}

// ─── GraphIR → presentation ───

const FEATURE_PREFIX = 'feature:';
const SCENARIO_PREFIX = 'scenario:';
const CAPABILITY_PREFIX = 'capability:';
const ARTIFACT_PREFIX = 'artifact:';

/** Reads the identifier out of a canonical semantic address, or undefined for another kind. */
function idAfter(address: string, prefix: string): string | undefined {
  return address.startsWith(prefix) ? address.slice(prefix.length) : undefined;
}

/** One coherent GraphIR read. Structural so this module never imports the workspace reader. */
export interface PresentableWorkspace {
  /** The memoized GraphIR kernel for one compilation. */
  readonly kernel: GraphIrV2Kernel;
  /** The compatibility presentation from the SAME snapshot, the only source of `test_refs`. */
  readonly spec: Spec;
}

/** How the adapter resolves doc tier banners. */
export interface PresentGraphOptions {
  /** Workspace root the doc paths are relative to; the only filesystem this adapter reads. */
  readonly cwd?: string;
}

/**
 * Projects one GraphIR workspace into the presentation graph every exporter reads.
 *
 * Nodes are deduped; nodes + edges are sorted for byte-stable output. Feature/scenario
 * nodes are tier A, capabilities tier B, docs tier-classified from their banner;
 * modules/tests carry no tier (code).
 *
 * @param workspace - One immutable GraphIR kernel plus the compatibility presentation from the same snapshot.
 * @param options - Workspace root for doc tier banners; defaults to the process directory.
 * @returns A fresh, deterministically ordered presentation graph.
 * @example
 * ```ts
 * presentGraph(loadGraphIrV2Workspace(cwd), {cwd});
 * ```
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-616e6e74
 * @since 0.10.0
 * @internal
 */
export function presentGraph(workspace: PresentableWorkspace, options: PresentGraphOptions = {}): KnowledgeGraph {
  const cwd = options.cwd ?? '.';
  const nodes = new Map<string, GraphNode>();
  const edgeSet = new Set<string>();
  const edges: GraphEdge[] = [];

  const addNode = (n: GraphNode): void => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  const addEdge = (from: string, to: string, kind: EdgeKind): void => {
    const key = `${kind}\u0000${from}\u0000${to}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({from, to, kind});
  };

  // Semantic nodes come from the compiler's presentation records — the authored display
  // fields it retained, never a second read of the source documents.
  const featureAddresses = new Set<string>();
  for (const record of workspace.kernel.presentationRecords()) {
    switch (record.kind) {
      case 'feature': {
        const id = record.address.slice(FEATURE_PREFIX.length);
        featureAddresses.add(record.address);
        addNode({
          id: nodeId.feature(id),
          kind: 'feature',
          label: record.slug ?? record.title ?? id, // show the human slug, not the F-id
          ...(record.status === undefined ? {} : {status: record.status}),
          tier: 'A',
          ...(record.title ? {detail: record.title} : {}),
        });
        break;
      }
      case 'scenario': {
        const id = record.address.slice(SCENARIO_PREFIX.length);
        addNode({id: nodeId.scenario(id), kind: 'scenario', label: record.title ?? id, tier: 'A'});
        break;
      }
      case 'capability': {
        const id = record.address.slice(CAPABILITY_PREFIX.length);
        addNode({id: nodeId.capability(id), kind: 'capability', label: record.title ?? id, tier: 'B'});
        break;
      }
      default:
        // Criteria, architecture rules, and the project node have never been presented:
        // the exporters draw the feature-level graph a human reads, and 1238 criterion
        // nodes would bury it. They stay addressable in GraphIR for consumers that ask.
        break;
    }
  }

  // Structural edges. A `depends_on`/`participates_in` naming an absent feature still
  // compiles to an edge (the compiler keeps the dangling declaration visible), so every
  // endpoint is checked against the materialized node set rather than assumed.
  const docFeatureRefs: {readonly doc: string; readonly feature: string}[] = [];
  const docLinks: {readonly doc: string; readonly target: string}[] = [];
  for (const edge of workspace.kernel.edges()) {
    switch (edge.relation) {
      case 'depends_on': {
        if (edge.provenance !== 'authored') break;
        if (!featureAddresses.has(edge.from) || !featureAddresses.has(edge.to)) break;
        addEdge(
          nodeId.feature(edge.from.slice(FEATURE_PREFIX.length)),
          nodeId.feature(edge.to.slice(FEATURE_PREFIX.length)),
          'depends_on',
        );
        break;
      }
      case 'touches': {
        const feature = idAfter(edge.from, FEATURE_PREFIX);
        const path = idAfter(edge.to, ARTIFACT_PREFIX);
        if (feature === undefined || path === undefined || !featureAddresses.has(edge.from)) break;
        addNode({id: nodeId.module(path), kind: isSkillPath(path) ? 'skill' : 'module', label: path});
        addEdge(nodeId.feature(feature), nodeId.module(path), 'touches');
        break;
      }
      case 'participates_in': {
        const scenario = idAfter(edge.from, SCENARIO_PREFIX);
        if (scenario === undefined || !featureAddresses.has(edge.to)) break;
        addEdge(nodeId.scenario(scenario), nodeId.feature(edge.to.slice(FEATURE_PREFIX.length)), 'binds');
        break;
      }
      case 'contributes_to': {
        // Authored as feature → capability; the presentation has always drawn the
        // capability as the owner that implements its features.
        const capability = idAfter(edge.to, CAPABILITY_PREFIX);
        if (capability === undefined || !featureAddresses.has(edge.from)) break;
        addEdge(nodeId.capability(capability), nodeId.feature(edge.from.slice(FEATURE_PREFIX.length)), 'implements');
        break;
      }
      case 'explains':
      case 'mentions': {
        // Both provenances are one presentation edge: a declared binding and a prose
        // mention were never distinguishable in the exported graph.
        const anchor = parseAnchorAddress(edge.from);
        const feature = idAfter(edge.to, FEATURE_PREFIX);
        if (!anchor || feature === undefined) break;
        docFeatureRefs.push({doc: anchor.path, feature: edge.to});
        break;
      }
      case 'links_to': {
        const anchor = parseAnchorAddress(edge.from);
        const target = idAfter(edge.to, ARTIFACT_PREFIX);
        if (!anchor || target === undefined) break;
        docLinks.push({doc: anchor.path, target});
        break;
      }
      default:
        // `contains`, `defined_in`, `covers`, `supports`, `constrained_by`, and
        // `traces_to` have no presentation edge kind — they address criteria, shard
        // files, anchors, and rules the exported graph does not draw.
        break;
    }
  }

  // Declared references. See the module header for why this is the presentation's
  // ledger and not the kernel's live `covers` facts.
  for (const feature of workspace.spec.features ?? []) {
    const fromId = nodeId.feature(feature.id);
    if (!nodes.has(fromId)) continue;
    for (const criterion of feature.acceptance_criteria ?? []) {
      for (const ref of criterion.test_refs ?? []) {
        const path = testRefPath(ref);
        if (!path) continue;
        addNode({id: nodeId.test(path), kind: 'test', label: path});
        addEdge(fromId, nodeId.test(path), 'covers');
      }
    }
  }

  // Documents. A doc that names only absent features still appears — the presentation
  // shows that the document made a claim, and hiding it would read as "no reference".
  const docNode = (path: string): string => {
    const id = nodeId.doc(path);
    if (!nodes.has(id)) {
      const tier = extractTierFromDoc(path, cwd);
      addNode({id, kind: 'doc', label: path, ...(tier ? {tier} : {})});
    }
    return id;
  };
  for (const reference of docFeatureRefs) {
    const from = docNode(reference.doc);
    if (featureAddresses.has(reference.feature)) {
      addEdge(from, nodeId.feature(reference.feature.slice(FEATURE_PREFIX.length)), 'references');
    }
  }
  for (const link of docLinks) {
    const from = docNode(link.doc);
    addEdge(from, docNode(link.target), 'links');
  }

  const sortedNodes = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = edges.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  return {nodes: sortedNodes, edges: sortedEdges};
}

/**
 * Restricts the graph to the N-hop neighbourhood of `focus` (one node id or a
 * seed SET — e.g. a path's kind-twins from resolveNodeIds), treating edges as
 * UNDIRECTED for reachability (so a focus feature pulls in both what it depends
 * on AND what depends on it). Returns the induced subgraph. An unknown focus
 * yields an empty graph.
 */
export function subgraph(
  graph: KnowledgeGraph,
  focus: string | readonly string[],
  depth: number = Infinity,
): KnowledgeGraph {
  const present = new Set(graph.nodes.map((n) => n.id));
  const seeds = (typeof focus === 'string' ? [focus] : focus).filter((id) => present.has(id));
  if (seeds.length === 0) return {nodes: [], edges: []};
  const adj = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    (adj.get(e.from) ?? adj.set(e.from, new Set()).get(e.from)!).add(e.to);
    (adj.get(e.to) ?? adj.set(e.to, new Set()).get(e.to)!).add(e.from);
  }
  const keep = new Set<string>(seeds);
  let frontier = [...seeds];
  let hop = 0;
  while (frontier.length > 0 && hop < depth) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
    hop++;
  }
  return {
    nodes: graph.nodes.filter((n) => keep.has(n.id)),
    edges: graph.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
  };
}

/**
 * Resolves a user query to EVERY graph node it denotes. A feature id/slug is one
 * node; a path query returns ALL its kind-twins — the same file materialises as
 * up to three nodes (module:/test:/doc:, 95 such paths on cladding-self), and a
 * focus query that picked only the first twin silently dropped the others'
 * edges. Empty when nothing matches.
 */
export function resolveNodeIds(spec: Spec, graph: KnowledgeGraph, query: string): string[] {
  const features = spec.features ?? [];
  const byIdOrSlug =
    features.find((f) => f.id === query) ?? features.find((f) => (f as {slug?: string}).slug === query);
  if (byIdOrSlug) return [nodeId.feature(byIdOrSlug.id)];
  const candidates = [nodeId.module(query), nodeId.doc(query), nodeId.test(query), nodeId.scenario(query), query];
  const present = new Set(graph.nodes.map((n) => n.id));
  return candidates.filter((id) => present.has(id));
}

/** Resolves a user query (feature id/slug, or module path) to ONE graph node id, or null.
 *  Prefer resolveNodeIds — this keeps the pre-0.7.1 first-twin contract for callers
 *  that need exactly one id. */
export function resolveNodeId(spec: Spec, graph: KnowledgeGraph, query: string): string | null {
  return resolveNodeIds(spec, graph, query)[0] ?? null;
}
