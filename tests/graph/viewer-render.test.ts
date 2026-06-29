// Cladding · headless render smoke for the graph viewer client — F graph-viewer-obsidian
//
// The viewer's canvas code (src/graph/viewer/app.js) can't be pixel-tested, but the
// regressions that bite ARE deterministically catchable headless: blank canvas (drew
// nothing), a thrown error aborting the IIFE, NaN/Infinity force blow-up, the hover-pause
// / drag-reheat interaction contract, and the node-color separation. We stub a minimal
// canvas/document/window, run the REAL app.js over a synthetic graph, and drive the
// interaction via the window.__CLADDING_DEBUG seam while the stub env is live.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

const APP = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'graph', 'viewer', 'app.js'), 'utf8');

interface DebugNode {id: string; deg: number; x: number; y: number}
interface Debug {
  nodes: DebugNode[];
  force: {center: number; repel: number; linkForce: number; linkDist: number};
  nodeColor: (n: {tier?: string; kind?: string}) => string;
  readonly alpha: number;
  readonly alphaTarget: number;
  setHover: (id: string | null) => void;
  setDrag: (id: string | null) => void;
  tick: (a: number) => void;
  frame: () => void;
}
interface Api {
  debug: Debug;
  arcs: () => number;
  rafCalls: () => number;
  drain: (n: number) => void;
}

const G_KEYS = ['window', 'document', 'getComputedStyle', 'localStorage', 'requestAnimationFrame', 'fetch', 'EventSource'] as const;

/** One hub + 24 leaves + a module — enough to exercise layout, color, interaction. */
function synthGraph(): unknown {
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
    legend: [{key: 'A', label: 'Spec', color: '#3b82f6', count: 25}, {key: 'code', label: 'Code', color: '#9ca3af', count: 1}],
    tierMeta: {A: {label: 'Spec', color: '#3b82f6'}, B: {label: 'Design', color: '#a855f7'}, C: {label: 'Derived', color: '#14b8a6'}, D: {label: 'Audit', color: '#f59e0b'}},
    codeColor: '#9ca3af',
  };
}

/** Sets up the stub env, runs app.js, drains a few frames, then calls fn while env is live. */
function withViewer(fn: (api: Api) => void): void {
  const rec = {arcs: 0};
  const ctx = new Proxy(
    {},
    {
      get(_t, p) {
        if (p === 'arc') return () => void rec.arcs++;
        return () => undefined;
      },
      set: () => true,
    },
  );
  const canvas = {
    clientWidth: 1400, clientHeight: 900, width: 0, height: 0,
    classList: {add() {}, remove() {}, toggle() {}},
    getContext: () => ctx,
    getBoundingClientRect: () => ({left: 0, top: 0}),
    addEventListener() {},
  };
  const stubEl = () => ({
    className: '', style: {}, textContent: '', checked: false, innerHTML: '', value: '', min: 0, max: 0, step: 0, type: '', htmlFor: '', id: '',
    onchange: null, onclick: null, appendChild() {}, addEventListener() {},
    classList: {add() {}, remove() {}, toggle() {}, contains: () => false},
  });
  const els: Record<string, unknown> = {g: canvas};
  ['side', 'search', 'kinds', 'tiers', 'forces', 'tip', 'impact', 'labels', 'health', 'theme', 'reset', 'burger'].forEach((id) => {
    els[id] = stubEl();
  });

  const queue: Array<() => void> = [];
  let rafCalls = 0;
  const raf = (f: () => void): number => {
    rafCalls++;
    if (queue.length < 400) queue.push(f);
    return rafCalls;
  };
  const drain = (n: number): void => {
    let guard = 0;
    while (queue.length > 0 && guard++ < n) {
      const f = queue.shift();
      if (f) f();
    }
  };

  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  for (const k of G_KEYS) saved[k] = g[k];
  const win: Record<string, unknown> = {innerWidth: 1400, devicePixelRatio: 2, addEventListener() {}, __CLADDING_GRAPH: synthGraph()};
  g.window = win;
  g.requestAnimationFrame = raf;
  g.getComputedStyle = () => ({getPropertyValue: () => '#888'});
  g.localStorage = {getItem: () => null, setItem() {}, removeItem() {}};
  g.document = {
    getElementById: (id: string) => els[id] ?? null,
    createElement: () => stubEl(),
    documentElement: {classList: {add() {}, remove() {}, toggle() {}, contains: () => false}},
  };
  g.fetch = undefined; // not serve mode (static) — liveWire stays inert
  g.EventSource = undefined;

  try {
    new Function(APP)();
    drain(60); // let the initial settle run
    const debug = win.__CLADDING_DEBUG as Debug;
    fn({debug, arcs: () => rec.arcs, rafCalls: () => rafCalls, drain});
  } finally {
    for (const k of G_KEYS) g[k] = saved[k];
  }
}

describe('graph viewer render (F graph-viewer-obsidian)', () => {
  test('draws every visible node to the canvas', () => {
    withViewer(({debug, arcs}) => {
      debug.frame();
      // 26 nodes; bloom pass + solid pass arc each ≥2×.
      expect(arcs()).toBeGreaterThan(26);
      for (const n of debug.nodes) {
        expect(Number.isFinite(n.x)).toBe(true);
        expect(Number.isFinite(n.y)).toBe(true);
      }
    });
  });

  test('hover pauses the simulation and drag reheats it', () => {
    withViewer(({debug}) => {
      // Drag reheats: alphaTarget rises to 0.3.
      debug.setDrag('feature:F-hub');
      debug.frame();
      expect(debug.alphaTarget).toBeGreaterThan(0.2);
      debug.setDrag(null);

      // Hover pauses: alphaTarget 0 AND positions frozen across a frame.
      debug.setHover('feature:F-hub');
      debug.frame(); // settle any residual
      const before = debug.nodes.map((n) => n.x + ',' + n.y);
      debug.frame();
      debug.frame();
      const after = debug.nodes.map((n) => n.x + ',' + n.y);
      expect(debug.alphaTarget).toBe(0);
      expect(after).toEqual(before); // hover froze the sim — no motion
    });
  });

  test('force sliders retune live simulation coefficients', () => {
    withViewer(({debug}) => {
      // The 4 Obsidian-style force params are live + numeric (sliders mutate these).
      expect(typeof debug.force.center).toBe('number');
      expect(typeof debug.force.repel).toBe('number');
      expect(typeof debug.force.linkForce).toBe('number');
      expect(typeof debug.force.linkDist).toBe('number');
      // Changing a coefficient changes the simulation: stronger repel pushes nodes apart.
      const spread = () => {
        let s = 0;
        for (const n of debug.nodes) s += Math.hypot(n.x, n.y);
        return s / debug.nodes.length;
      };
      debug.force.repel = -2000; // much stronger repulsion than the default
      for (let i = 0; i < 40; i++) debug.tick(0.6);
      const wide = spread();
      debug.force.repel = -20; // weak
      for (let i = 0; i < 40; i++) debug.tick(0.6);
      expect(Number.isFinite(wide)).toBe(true);
      expect(spread()).toBeLessThan(wide); // weaker repel → tighter cluster
    });
  });

  test('nodeColor separates tiers and code/test/doc', () => {
    withViewer(({debug}) => {
      const c = debug.nodeColor;
      const tierA = c({tier: 'A', kind: 'feature'});
      const tierB = c({tier: 'B', kind: 'capability'});
      const tierC = c({tier: 'C', kind: 'doc'});
      const mod = c({kind: 'module'});
      const test = c({kind: 'test'});
      const doc = c({kind: 'doc'});
      const all = [tierA, tierB, tierC, mod, test, doc];
      // every class resolves to a color, and code/test/doc are mutually distinct
      for (const col of all) expect(col).toMatch(/^#?[0-9a-fA-F]{3,8}$/);
      expect(new Set([mod, test, doc]).size).toBe(3);
      expect(new Set([tierA, tierB, tierC]).size).toBe(3); // tiers distinct
      expect(mod).not.toBe(test);
    });
  });
});
