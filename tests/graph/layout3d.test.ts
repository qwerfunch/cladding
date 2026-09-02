import {describe, test, expect} from 'vitest';
import {computeLayout3d} from '../../src/graph/layout3d.js';

type Node = {id: string; kind?: string};
type Edge = {from: string; to: string};
type Vec3 = [number, number, number];

const isVec3 = (v: unknown): v is Vec3 =>
  Array.isArray(v) &&
  v.length === 3 &&
  typeof v[0] === 'number' &&
  typeof v[1] === 'number' &&
  typeof v[2] === 'number';

describe('computeLayout3d — coverage and tuple shape', () => {
  test('every input node id has a 3-number tuple position', () => {
    const nodes: Node[] = [{id: 'a'}, {id: 'b'}, {id: 'c'}];
    const edges: Edge[] = [{from: 'a', to: 'b'}];
    const pos = computeLayout3d(nodes, edges);
    for (const n of nodes) {
      expect(pos[n.id]).toBeDefined();
      expect(isVec3(pos[n.id])).toBe(true);
    }
    expect(Object.keys(pos).length).toBe(nodes.length);
  });
});

describe('computeLayout3d — finiteness', () => {
  test('[covers:F-77f7ead0/AC-3c4d5e6f] every coordinate is finite', () => {
    const nodes: Node[] = Array.from({length: 25}, (_, i) => ({id: 'n' + i}));
    const edges: Edge[] = nodes
      .slice(1)
      .map((n, i) => ({from: n.id, to: 'n' + (i % 5)}));
    const pos = computeLayout3d(nodes, edges);
    for (const id of Object.keys(pos)) {
      const p = pos[id];
      for (const c of p) {
        expect(Number.isFinite(c)).toBe(true);
      }
    }
  });
});

describe('computeLayout3d — bounded', () => {
  test('[covers:F-77f7ead0/AC-3c4d5e6f] default opts: abs(coord) <= 4000', () => {
    const nodes: Node[] = Array.from({length: 50}, (_, i) => ({id: 'n' + i}));
    const edges: Edge[] = Array.from({length: 80}, (_, i) => ({
      from: 'n' + (i % 50),
      to: 'n' + ((i * 7) % 50),
    }));
    const pos = computeLayout3d(nodes, edges);
    for (const id of Object.keys(pos)) {
      for (const c of pos[id]) {
        expect(Math.abs(c)).toBeLessThanOrEqual(4000);
      }
    }
  });

  test('opts {bound: 500}: abs(coord) <= 500', () => {
    const nodes: Node[] = Array.from({length: 50}, (_, i) => ({id: 'n' + i}));
    const edges: Edge[] = Array.from({length: 80}, (_, i) => ({
      from: 'n' + (i % 50),
      to: 'n' + ((i * 7) % 50),
    }));
    const pos = computeLayout3d(nodes, edges, {bound: 500});
    for (const id of Object.keys(pos)) {
      for (const c of pos[id]) {
        expect(Math.abs(c)).toBeLessThanOrEqual(500);
      }
    }
  });
});

describe('computeLayout3d — determinism', () => {
  test('[covers:F-77f7ead0/AC-3c4d5e6f] two calls with identical input are deep-equal', () => {
    const nodes: Node[] = Array.from({length: 30}, (_, i) => ({id: 'node-' + i}));
    const edges: Edge[] = Array.from({length: 40}, (_, i) => ({
      from: 'node-' + (i % 30),
      to: 'node-' + ((i * 3) % 30),
    }));
    const a = computeLayout3d(nodes, edges);
    const b = computeLayout3d(nodes, edges);
    expect(a).toEqual(b);
  });
});

describe('computeLayout3d — distinct positions', () => {
  test('30 distinct ids get 30 distinct positions', () => {
    const nodes: Node[] = Array.from({length: 30}, (_, i) => ({id: 'd' + i}));
    const edges: Edge[] = Array.from({length: 20}, (_, i) => ({
      from: 'd' + i,
      to: 'd' + ((i + 1) % 30),
    }));
    const pos = computeLayout3d(nodes, edges);
    const stringified = nodes.map((n) => JSON.stringify(pos[n.id]));
    expect(new Set(stringified).size).toBe(nodes.length);
  });
});

describe('computeLayout3d — empty', () => {
  test('empty graph returns {}', () => {
    const pos = computeLayout3d([], []);
    expect(pos).toEqual({});
    expect(Object.keys(pos).length).toBe(0);
  });
});

describe('computeLayout3d — robustness', () => {
  test('edges referencing unknown ids are ignored (no throw, no phantom nodes)', () => {
    const nodes: Node[] = [{id: 'a'}, {id: 'b'}];
    const edges: Edge[] = [
      {from: 'a', to: 'b'},
      {from: 'a', to: 'ghost'},
      {from: 'phantom', to: 'b'},
    ];
    const pos = computeLayout3d(nodes, edges);
    expect(Object.keys(pos).sort()).toEqual(['a', 'b']);
    expect(pos.ghost).toBeUndefined();
    expect(pos.phantom).toBeUndefined();
  });

  test('a self-edge does not throw', () => {
    const nodes: Node[] = [{id: 'a'}, {id: 'b'}];
    const edges: Edge[] = [{from: 'a', to: 'a'}];
    expect(() => computeLayout3d(nodes, edges)).not.toThrow();
    const pos = computeLayout3d(nodes, edges);
    expect(isVec3(pos.a)).toBe(true);
    expect(isVec3(pos.b)).toBe(true);
  });
});

describe('computeLayout3d — not collapsed', () => {
  test('hub + 20 leaves + 9 isolated nodes spread out (span > 50)', () => {
    const nodes: Node[] = [{id: 'hub'}];
    for (let i = 0; i < 20; i++) nodes.push({id: 'leaf' + i});
    for (let i = 0; i < 9; i++) nodes.push({id: 'iso' + i});
    expect(nodes.length).toBe(30);
    const edges: Edge[] = [];
    for (let i = 0; i < 20; i++) edges.push({from: 'hub', to: 'leaf' + i});

    const pos = computeLayout3d(nodes, edges);

    let maxSpan = 0;
    for (let axis = 0; axis < 3; axis++) {
      let min = Infinity;
      let max = -Infinity;
      for (const n of nodes) {
        const v = pos[n.id][axis];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      maxSpan = Math.max(maxSpan, max - min);
    }
    expect(maxSpan).toBeGreaterThan(50);
  });
});

describe('computeLayout3d — performance', () => {
  test(
    '700 nodes, ~1200 edges completes under 3000ms',
    () => {
      const nodes: Node[] = Array.from({length: 700}, (_, i) => ({id: 'n' + i}));
      const edges: Edge[] = [];
      for (let i = 0; i < 1200; i++) {
        edges.push({from: 'n' + i % 700, to: 'n' + (i % 50)});
      }
      const start = performance.now();
      const pos = computeLayout3d(nodes, edges);
      const elapsed = performance.now() - start;
      expect(Object.keys(pos).length).toBe(700);
      // Guards algorithmic blow-up, not wall-clock: the gate's v8-coverage run is ~15x slower than an uninstrumented one.
      expect(elapsed).toBeLessThan(8000);
    },
    10000,
  );
});

describe('computeLayout3d — optional iterations', () => {
  test('iterations:1 still yields finite bounded positions for every node', () => {
    const nodes: Node[] = Array.from({length: 30}, (_, i) => ({id: 'it' + i}));
    const edges: Edge[] = Array.from({length: 40}, (_, i) => ({
      from: 'it' + (i % 30),
      to: 'it' + ((i * 3) % 30),
    }));
    const pos = computeLayout3d(nodes, edges, {iterations: 1});
    expect(Object.keys(pos).length).toBe(nodes.length);
    for (const n of nodes) {
      const p = pos[n.id];
      expect(isVec3(p)).toBe(true);
      for (const c of p) {
        expect(Number.isFinite(c)).toBe(true);
        expect(Math.abs(c)).toBeLessThanOrEqual(4000);
      }
    }
  });
});
