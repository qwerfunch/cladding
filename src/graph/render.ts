// Cladding · graph · renderers — F-569f4b37
//
// One graph model, several best-in-class viewers (the explicit decision NOT to
// build a bespoke web UI):
//   • mermaid — GitHub/markdown-native, for a focused neighbourhood in a PR;
//   • dot     — Graphviz / any DOT viewer;
//   • json    — Cytoscape / d3 / programmatic consumers;
//   • obsidian — a vault of markdown notes with [[wikilinks]] + Backlinks, so
//                opening the folder in Obsidian renders the whole spec↔code↔doc
//                graph navigably, in a tool the user already has.
// All renderers are pure and deterministic (the model is pre-sorted).

import type {EdgeKind, GraphNode, KnowledgeGraph} from './model.js';

/** A mermaid/DOT-safe identifier derived from a node id. */
function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '_');
}

/** A unique Obsidian note basename (kind-prefixed, filesystem-safe). */
function noteName(node: GraphNode): string {
  return `${node.kind}__${node.id.slice(node.kind.length + 1).replace(/[\\/]/g, '_')}`;
}

const SHAPE: Record<GraphNode['kind'], [string, string]> = {
  feature: ['[', ']'], //      rectangle
  module: ['[(', ')]'], //     cylinder (code on disk)
  test: ['([', '])'], //       stadium
  scenario: ['{{', '}}'], //   hexagon
  capability: ['((', '))'], // circle (high-level)
  doc: ['>', ']'], //          asymmetric (a note)
};

/** Mermaid `graph LR` of the (sub)graph. */
export function toMermaid(graph: KnowledgeGraph): string {
  const lines: string[] = ['graph LR'];
  for (const n of graph.nodes) {
    const [open, close] = SHAPE[n.kind];
    const text = `${n.label}`.replace(/"/g, "'");
    lines.push(`  ${safeId(n.id)}${open}"${text}"${close}`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${safeId(e.from)} -->|${e.kind}| ${safeId(e.to)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Graphviz DOT digraph. */
export function toDot(graph: KnowledgeGraph): string {
  const lines: string[] = ['digraph cladding {', '  rankdir=LR;', '  node [shape=box];'];
  for (const n of graph.nodes) {
    lines.push(`  "${n.id}" [label="${n.label.replace(/"/g, '\\"')}"];`);
  }
  for (const e of graph.edges) {
    lines.push(`  "${e.from}" -> "${e.to}" [label="${e.kind}"];`);
  }
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** Plain graph JSON ({nodes, edges}) for any programmatic / 3rd-party viewer. */
export function toJson(graph: KnowledgeGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

/**
 * Renders an Obsidian-compatible vault: a map of relative file path → markdown.
 * Each node becomes one note carrying its kind/status, its outgoing edges as
 * [[wikilinks]], and a Backlinks section listing incoming edges.
 */
export function toObsidianVault(graph: KnowledgeGraph): Map<string, string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdgeView[]>();
  const inc = new Map<string, GraphEdgeView[]>();
  for (const e of graph.edges) {
    (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push({other: e.to, kind: e.kind});
    (inc.get(e.to) ?? inc.set(e.to, []).get(e.to)!).push({other: e.from, kind: e.kind});
  }

  const link = (id: string): string => {
    const n = byId.get(id);
    return n ? `[[${noteName(n)}|${n.label}]]` : `[[${id}]]`;
  };

  const vault = new Map<string, string>();
  for (const n of graph.nodes) {
    const lines: string[] = [
      '---',
      `kind: ${n.kind}`,
      ...(n.status ? [`status: ${n.status}`] : []),
      `id: ${JSON.stringify(n.id)}`,
      '---',
      `# ${n.label}`,
      '',
    ];
    const outs = (out.get(n.id) ?? []).slice().sort(byEdgeView);
    if (outs.length > 0) {
      lines.push('## Links');
      for (const e of outs) lines.push(`- ${e.kind} → ${link(e.other)}`);
      lines.push('');
    }
    const ins = (inc.get(n.id) ?? []).slice().sort(byEdgeView);
    if (ins.length > 0) {
      lines.push('## Backlinks');
      for (const e of ins) lines.push(`- ${link(e.other)} → ${e.kind}`);
      lines.push('');
    }
    vault.set(`${n.kind}/${noteName(n)}.md`, `${lines.join('\n')}`);
  }
  return vault;
}

interface GraphEdgeView {
  readonly other: string;
  readonly kind: EdgeKind;
}
function byEdgeView(a: GraphEdgeView, b: GraphEdgeView): number {
  return a.kind.localeCompare(b.kind) || a.other.localeCompare(b.other);
}
