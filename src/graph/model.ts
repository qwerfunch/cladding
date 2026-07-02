// Cladding · graph · knowledge-graph model — F-569f4b37
//
// The edges already exist, scattered: forward in the shards (depends_on,
// modules, test_refs), backward in the reverse-index, doc edges in
// _doc-links. buildGraph is the ONE place that materialises them into a single
// typed graph every exporter (mermaid / Obsidian / DOT / JSON) and the LLM read.
// Pure + derived: reads the spec, allocates a fresh graph, mutates nothing.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {extractDocReferences} from '../spec/doc-references.js';
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

const PSEUDO_REF_PREFIXES = ['derived:', 'fixture:', 'script:', 'self-dogfood:'];

/** A skill artifact (skills/<verb>/… incl. plugin mirrors like plugins/codex/skills/…) —
 *  its own node kind so SKILL.md files read distinctly from ordinary code modules. */
function isSkillPath(p: string): boolean {
  return /(?:^|\/)skills\//.test(p);
}

/** Strips a test_ref to its file path, or null for pseudo-refs. */
function testRefPath(ref: string): string | null {
  if (PSEUDO_REF_PREFIXES.some((p) => ref.startsWith(p))) return null;
  const hash = ref.indexOf('#');
  const path = (hash >= 0 ? ref.slice(0, hash) : ref).trim();
  return path.length > 0 ? path : null;
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

/**
 * Assembles the deterministic knowledge graph from the spec, plus the doc-link
 * index read from `cwd`. Nodes are deduped; nodes + edges are sorted for
 * byte-stable output. Feature/scenario nodes are tier A, capabilities tier B,
 * docs tier-classified from their banner; modules/tests carry no tier (code).
 */
export function buildGraph(spec: Spec, cwd: string = '.'): KnowledgeGraph {
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

  for (const f of spec.features ?? []) {
    addNode({
      id: nodeId.feature(f.id),
      kind: 'feature',
      label: f.slug ?? f.title ?? f.id, // show the human slug, not the F-id
      status: f.status,
      tier: 'A',
      ...(f.title ? {detail: f.title} : {}),
    });
  }
  // Edges need both endpoints to be feature nodes that exist; emit after all features are nodes.
  for (const f of spec.features ?? []) {
    const fromId = nodeId.feature(f.id);
    for (const dep of f.depends_on ?? []) {
      if (nodes.has(nodeId.feature(dep))) addEdge(fromId, nodeId.feature(dep), 'depends_on');
    }
    for (const m of f.modules ?? []) {
      addNode({id: nodeId.module(m), kind: isSkillPath(m) ? 'skill' : 'module', label: m});
      addEdge(fromId, nodeId.module(m), 'touches');
    }
    for (const ac of f.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        const path = testRefPath(ref);
        if (!path) continue;
        addNode({id: nodeId.test(path), kind: 'test', label: path});
        addEdge(fromId, nodeId.test(path), 'covers');
      }
    }
  }

  for (const s of spec.scenarios ?? []) {
    addNode({id: nodeId.scenario(s.id), kind: 'scenario', label: s.title ?? s.id, tier: 'A'});
    for (const fid of s.features ?? []) {
      if (nodes.has(nodeId.feature(fid))) addEdge(nodeId.scenario(s.id), nodeId.feature(fid), 'binds');
    }
  }

  for (const c of spec.capabilities ?? []) {
    addNode({id: nodeId.capability(c.id), kind: 'capability', label: c.title ?? c.id, tier: 'B'});
    for (const fid of c.features ?? []) {
      if (nodes.has(nodeId.feature(fid))) addEdge(nodeId.capability(c.id), nodeId.feature(fid), 'implements');
    }
  }

  for (const d of extractDocReferences(cwd).docs) {
    const docNode = nodeId.doc(d.doc);
    if (d.features.length === 0 && d.doc_links.length === 0) continue;
    const docTier = extractTierFromDoc(d.doc, cwd);
    addNode({id: docNode, kind: 'doc', label: d.doc, ...(docTier ? {tier: docTier} : {})});
    for (const fid of d.features) {
      if (nodes.has(nodeId.feature(fid))) addEdge(docNode, nodeId.feature(fid), 'references');
    }
    for (const target of d.doc_links) {
      const targetTier = extractTierFromDoc(target, cwd);
      addNode({id: nodeId.doc(target), kind: 'doc', label: target, ...(targetTier ? {tier: targetTier} : {})});
      addEdge(docNode, nodeId.doc(target), 'links');
    }
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
