// Cladding · headless render smoke for the graph viewer client — F-8234ec3c
//
// The viewer's canvas code (src/graph/viewer/app.js) can't be pixel-tested in the
// gate, but the regressions that actually bite ARE deterministically catchable:
// "the canvas drew nothing" (the unsized-canvas bug), a thrown error that aborts
// the IIFE, an unstable force loop that diverges to NaN/Infinity, and the ambient
// animation never starting. We stub a minimal canvas/document/window, run the real
// app.js over a synthetic galaxy (one hub + leaves), drain animation frames, and
// assert on the recorded draw calls + the layout it produced (via window.__CLADDING_DEBUG).

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, describe, expect, test} from 'vitest';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'graph', 'viewer', 'app.js'), 'utf8');

interface DebugNode {
  id: string;
  deg: number;
  x: number;
  y: number;
}

interface Harness {
  arcs: number;
  fills: number;
  rafCalls: number;
  debug: () => {nodes: DebugNode[]} | undefined;
}

const G_KEYS = ['window', 'document', 'getComputedStyle', 'localStorage', 'requestAnimationFrame'] as const;

/** Builds a stubbed browser env, runs app.js, drains up to `maxFrames` rAF callbacks. */
function run(maxFrames: number): Harness {
  const rec = {arcs: 0, fills: 0, strokes: 0};
  const ctx = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === 'arc') return () => void rec.arcs++;
        if (p === 'fill') return () => void rec.fills++;
        if (p === 'stroke') return () => void rec.strokes++;
        // every other ctx method is a harmless no-op
        return () => undefined;
      },
      set: () => true, // fillStyle / globalAlpha / lineWidth / font / … assigned freely
    },
  );
  const canvas = {
    clientWidth: 1400,
    clientHeight: 900,
    width: 0,
    height: 0,
    classList: {add() {}, remove() {}, toggle() {}},
    getContext: () => ctx,
    getBoundingClientRect: () => ({left: 0, top: 0}),
    addEventListener() {},
  };
  const stubEl = () => ({
    className: '',
    style: {},
    textContent: '',
    checked: false,
    innerHTML: '',
    onchange: null,
    onclick: null,
    appendChild() {},
    addEventListener() {},
    classList: {add() {}, remove() {}, toggle() {}, contains: () => false},
  });
  const els: Record<string, unknown> = {g: canvas};
  ['side', 'search', 'kinds', 'tiers', 'tip', 'mode', 'labels', 'theme', 'reset', 'burger'].forEach((id) => {
    els[id] = stubEl();
  });

  const queue: Array<() => void> = [];
  let rafCalls = 0;
  const raf = (fn: () => void): number => {
    rafCalls++;
    if (queue.length < maxFrames * 2) queue.push(fn);
    return rafCalls;
  };

  const payload = synthGalaxy();
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of G_KEYS) saved[k] = g[k];

  const win: Record<string, unknown> = {innerWidth: 1400, devicePixelRatio: 2, addEventListener() {}, __CLADDING_GRAPH: payload};
  g.window = win;
  g.requestAnimationFrame = raf;
  g.getComputedStyle = () => ({getPropertyValue: () => '#888'});
  g.localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
  g.document = {
    getElementById: (id: string) => els[id] ?? null,
    createElement: () => stubEl(),
    documentElement: {classList: {add() {}, remove() {}, toggle() {}, contains: () => false}},
  };

  let debugVal: unknown;
  try {
    new Function(APP)();
    let guard = 0;
    while (queue.length > 0 && guard++ < maxFrames) {
      const fn = queue.shift();
      if (fn) fn();
    }
    debugVal = win.__CLADDING_DEBUG; // app.js sets window.__CLADDING_DEBUG (window===globalThis in a browser)
  } finally {
    // restore globals so we don't leak into other tests
    for (const k of G_KEYS) g[k] = saved[k];
  }
  return {
    arcs: rec.arcs,
    fills: rec.fills,
    rafCalls,
    debug: () => debugVal as {nodes: DebugNode[]} | undefined,
  };
}

/** One hub (high degree) + 24 leaves + a couple modules — exercises the radial galaxy. */
function synthGalaxy(): unknown {
  const nodes: Array<Record<string, unknown>> = [{id: 'feature:F-hub', kind: 'feature', label: 'hub', tier: 'A', status: 'done'}];
  const edges: Array<Record<string, unknown>> = [];
  for (let i = 0; i < 24; i++) {
    const id = 'feature:F-leaf' + i;
    nodes.push({id, kind: 'feature', label: 'leaf' + i, tier: 'A', status: 'done'});
    edges.push({from: id, to: 'feature:F-hub', kind: 'depends_on'});
  }
  nodes.push({id: 'module:src/a.ts', kind: 'module', label: 'src/a.ts'});
  edges.push({from: 'feature:F-hub', to: 'module:src/a.ts', kind: 'touches'});
  return {
    nodes,
    edges,
    legend: [{key: 'A', label: 'Spec', color: '#0066cc', count: 25}, {key: 'code', label: 'Code', color: '#9ca3af', count: 1}],
    tierMeta: {A: {label: 'Spec', color: '#0066cc'}, B: {label: 'Design', color: '#7c3aed'}, C: {label: 'Derived', color: '#64748b'}, D: {label: 'Audit', color: '#f59e0b'}},
    codeColor: '#9ca3af',
  };
}

describe('graph viewer render (F-8234ec3c)', () => {
  afterEach(() => {
    /* run() restores globals in its finally */
  });

  test('draws every visible node to the canvas', () => {
    const h = run(40);
    // 26 nodes; with the bloom pass + solid pass each visible node arcs ≥2×.
    expect(h.arcs).toBeGreaterThan(26);
    expect(h.fills).toBeGreaterThan(26);
  });

  test('runs an ambient animation loop when idle', () => {
    const h = run(80);
    // The settle burst is ~47 frames; ambient keeps re-scheduling after it, so the
    // loop must still be alive well past the burst.
    expect(h.rafCalls).toBeGreaterThan(60);
  });

  test('settles into finite bounded positions with hubs pulled toward the center', () => {
    const h = run(120);
    const dbg = h.debug();
    expect(dbg).toBeTruthy();
    const ns = (dbg as {nodes: DebugNode[]}).nodes;
    expect(ns.length).toBe(26);
    // No NaN / Infinity blow-up.
    for (const n of ns) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
    // Hub (max degree) sits more central than a typical (median) node.
    const dist = (n: DebugNode) => Math.hypot(n.x, n.y);
    const hub = ns.reduce((a, b) => (b.deg > a.deg ? b : a));
    const dists = ns.map(dist).sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)];
    expect(dist(hub)).toBeLessThan(median);
  });
});
