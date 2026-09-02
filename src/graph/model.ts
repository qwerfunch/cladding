// Cladding · graph · knowledge-graph model — F-569f4b37
//
// The presentation shape itself now lives in `src/graph/presentation.ts`, beside the
// GraphIR adapter that produces it; this module re-exports it unchanged so every
// importer keeps its path while the authority moves. What remains here is `buildGraph`,
// the pre-F8 assembly that walked the Spec directly — retained only until the exporters
// and the viewer read `presentGraph`, and proved equivalent to it by the parity suite in
// tests/graph/presentation.test.ts.

import {extractDocReferences} from '../spec/doc-references.js';
import {testRefPath} from '../spec/compiler/legacy-reference.js';
import type {Spec} from '../spec/types.js';
import {
  extractTierFromDoc,
  nodeId,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  type KnowledgeGraph,
} from './presentation.js';

export {
  extractTierFromDoc,
  nodeId,
  resolveNodeId,
  resolveNodeIds,
  subgraph,
} from './presentation.js';
export type {
  EdgeKind,
  GraphEdge,
  GraphNode,
  KnowledgeGraph,
  NodeKind,
  Tier,
} from './presentation.js';

/** A skill artifact (skills/<verb>/… incl. plugin mirrors like plugins/codex/skills/…) —
 *  its own node kind so SKILL.md files read distinctly from ordinary code modules.
 *  Private to the legacy assembly; `presentation.ts` owns the rule the adapter applies. */
function isSkillPath(p: string): boolean {
  return /(?:^|\/)skills\//.test(p);
}

/**
 * Assembles the deterministic knowledge graph from the spec, plus the doc-link
 * index read from `cwd`. Nodes are deduped; nodes + edges are sorted for
 * byte-stable output. Feature/scenario nodes are tier A, capabilities tier B,
 * docs tier-classified from their banner; modules/tests carry no tier (code).
 *
 * @deprecated Pre-F8 second authority — reads the Spec instead of the compiler IR.
 *   Use `presentGraph` from `./presentation.js`, which the parity suite proves identical.
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
