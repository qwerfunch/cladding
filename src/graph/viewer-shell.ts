// Cladding · graph · self-contained HTML viewer shell — F-02343cd1 / F webgl-stellar-viewer
//
// toHtmlShell(graph) returns ONE offline HTML string: the graph data + the WebGL stellar
// galaxy viewer (the esbuild-bundled dist/viewer/app.js — three.js + jsm addons + the
// stellar/layout cores — plus styles.css, inlined as text). No CDN, no <script src>: the
// exported file renders with zero network. Tier color (SSoT A/B/C/D) + kind hue + slug
// labels come from the model; the legend + palette are embedded for the client.
//
// The viewer assets are read at runtime relative to this module — the esbuild bundle
// resolves dist/viewer/ (its import.meta.url dir is dist/); dev (tsx) falls back to the
// repo's dist/viewer/ for app.js and to src/graph/viewer/ for live-edited styles.css.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

import type {KnowledgeGraph} from './presentation.js';
import {CODE_COLOR, getTierLegend, TIER_META} from './render.js';

const here = dirname(fileURLToPath(import.meta.url));

/** Reads a viewer asset (dev: src/graph/viewer/, bundled: dist/viewer/). */
function asset(name: string): string {
  for (const p of [join(here, 'viewer', name), join(here, '..', 'graph', 'viewer', name), join(here, '..', '..', 'dist', 'viewer', name)]) {
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
export function toHtmlShell(graph: KnowledgeGraph, health?: Readonly<Record<string, unknown>>): string {
  const styles = asset('styles.css');
  const app = asset('app.js');
  const payload = safeJson({
    nodes: graph.nodes,
    edges: graph.edges,
    legend: getTierLegend(graph),
    tierMeta: TIER_META,
    codeColor: CODE_COLOR,
  });
  // Static export: embed a point-in-time SSoT-health snapshot (live in `clad graph serve`).
  const healthScript =
    health && Object.keys(health).length > 0
      ? `<script>window.__CLADDING_HEALTH=${safeJson(health)};</script>\n`
      : '';
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
<div id="impact"></div>
<aside id="side">
  <h1>cladding · knowledge graph</h1>
  <div class="sub">${graph.nodes.length} nodes · ${graph.edges.length} edges · spec ↔ code ↔ doc</div>
  <input id="search" placeholder="search slug / id / title…" autocomplete="off" spellcheck="false">
  <h2>view</h2>
  <div class="toggles">
    <button id="labels">labels</button>
    <button id="health">health</button>
    <button id="theme">light</button>
    <button id="reset">reset</button>
  </div>
  <h2>kinds</h2>
  <div class="zone"><h3>spec</h3><div id="kinds-spec"></div></div>
  <div class="zone"><h3>code</h3><div id="kinds-code"></div></div>
  <div class="zone"><h3>test</h3><div id="kinds-test"></div></div>
  <div class="zone"><h3>docs</h3><div id="kinds-docs"></div></div>
  <h2>SSoT layer <span class="hint-inline">(filter)</span></h2>
  <div id="tiers"></div>
</aside>
<div id="tip"></div>
<div id="hint">drag = orbit · scroll = zoom · click node = focus · hover = details</div>
<script>window.__CLADDING_GRAPH=${payload};</script>
${healthScript}<script>${app}</script>
</body>
</html>
`;
}
