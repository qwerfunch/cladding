// Cladding · graph · stats — F-569f4b37
//
// Node/edge counts by kind + the highest-degree nodes ("hubs"). The hubs are
// what the bright centres in a force-graph represent: the load-bearing
// features/files that everything else hangs off. Surfacing them lets a human —
// and the LLM — know what to touch carefully in a long-lived project.

import type {EdgeKind, KnowledgeGraph, NodeKind} from './presentation.js';

export interface HubEntry {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly degree: number;
}

export interface GraphStats {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly nodesByKind: Readonly<Record<string, number>>;
  readonly edgesByKind: Readonly<Record<string, number>>;
  /** Highest total-degree nodes (in + out), descending. */
  readonly hubs: readonly HubEntry[];
}

/** Computes counts + the top `topN` hubs by total (in+out) degree. */
export function graphStats(graph: KnowledgeGraph, topN: number = 10): GraphStats {
  const nodesByKind: Record<string, number> = {};
  for (const n of graph.nodes) nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1;

  const edgesByKind: Record<string, number> = {};
  const degree = new Map<string, number>();
  for (const e of graph.edges) {
    edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1;
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const hubs: HubEntry[] = graph.nodes
    .map((n) => ({id: n.id, kind: n.kind, label: n.label, degree: degree.get(n.id) ?? 0}))
    // Descending by degree; ties broken by id for determinism.
    .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
    .slice(0, topN);

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodesByKind,
    edgesByKind,
    hubs,
  };
}

/** A compact human-readable rendering of the stats (for `clad graph stats`). */
export function renderStats(stats: GraphStats): string {
  const kinds = (rec: Readonly<Record<string, number>>): string =>
    Object.keys(rec)
      .sort()
      .map((k) => `${k}=${rec[k]}`)
      .join('  ');
  const lines = [
    `nodes: ${stats.nodeCount}  (${kinds(stats.nodesByKind)})`,
    `edges: ${stats.edgeCount}  (${kinds(stats.edgesByKind)})`,
    'hubs (top by degree):',
    ...stats.hubs.map((h, i) => `  ${String(i + 1).padStart(2)}. [${h.kind}] ${h.label} — degree ${h.degree}`),
  ];
  return `${lines.join('\n')}\n`;
}

// EdgeKind is re-exported only to keep the public surface explicit for consumers
// that pattern-match on edge kinds when post-processing stats.
export type {EdgeKind};
