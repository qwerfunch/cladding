// Cladding · graph · self-contained HTML viewer shell — F-02343cd1
//
// toHtmlShell(graph) returns ONE offline HTML string: the graph data + a
// dependency-free canvas force-directed viewer (src/graph/viewer/{app.js,styles.css}
// inlined as text — no CDN, no <script src>, no build step). Hand-rolled instead of
// vendoring a 50-80KB lib: truest to the zero-dep ethos, full aesthetic control,
// ~40KB output. Tier color (SSoT A/B/C/D) + slug labels + status opacity come from
// the model; the legend + palette are embedded for the client.
//
// The viewer assets are read at runtime relative to this module — dev resolves
// src/graph/viewer/, the esbuild bundle resolves dist/viewer/ (build.mjs copies them,
// the same pattern as dist/schema.json + dist/agents/).

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {KnowledgeGraph} from './model.js';
import {CODE_COLOR, getTierLegend, TIER_META} from './render.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Reads a viewer asset (dev: src/graph/viewer/, bundled: dist/viewer/). */
function asset(name: string): string {
  for (const p of [join(here, 'viewer', name), join(here, '..', 'graph', 'viewer', name)]) {
    try {
      return readFileSync(p, 'utf8');
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`cladding: viewer asset not found: ${name}`);
}

/** `</` → `</` so embedded JSON can never break out of the <script> tag. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Renders the complete single-file, offline, self-contained HTML viewer for a graph.
 * Deterministic: assets are static, the payload derives from the pre-sorted graph,
 * and no timestamps/random ids are emitted (so the same graph yields identical bytes).
 */
export function toHtmlShell(graph: KnowledgeGraph): string {
  const styles = asset('styles.css');
  const app = asset('app.js');
  const payload = safeJson({
    nodes: graph.nodes,
    edges: graph.edges,
    legend: getTierLegend(graph),
    tierMeta: TIER_META,
    codeColor: CODE_COLOR,
  });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>cladding · knowledge graph</title>
<style>${styles}</style>
</head>
<body>
<div id="stage"><canvas id="g"></canvas></div>
<button id="burger" title="menu" aria-label="toggle sidebar">☰</button>
<aside id="side">
  <h1>cladding · knowledge graph</h1>
  <div class="sub">${graph.nodes.length} nodes · ${graph.edges.length} edges · spec ↔ code ↔ doc</div>
  <input id="search" placeholder="search slug / id / title…" autocomplete="off" spellcheck="false">
  <h2>view</h2>
  <div class="toggles">
    <button id="mode">✦ Live</button>
    <button id="labels">labels</button>
    <button id="theme">light</button>
    <button id="reset">reset</button>
  </div>
  <h2>SSoT tiers</h2>
  <div id="tiers"></div>
  <h2>kinds</h2>
  <div id="kinds"></div>
</aside>
<div id="tip"></div>
<div id="hint">scroll = zoom · drag = pan · click node = pin · hover = focus</div>
<script>window.__CLADDING_GRAPH=${payload};</script>
<script>${app}</script>
</body>
</html>
`;
}
