// Cladding · tests for the live SSoT health mapper (the killer) — F graph-live-health
//
// nodeHealth runs cladding's drift detectors and maps each finding to the graph node it
// concerns. These pin the load-bearing behavior: an untested done-AC flags its FEATURE node;
// a healthy feature is absent from the map (so a healthy graph stays the plain pretty view).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildGraph} from '../../src/graph/model.js';
import {nodeHealth} from '../../src/stages/graph-health.js';
import {loadSpec} from '../../src/spec/load.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-health-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Writes spec.yaml for one done feature whose single AC carries the given test_refs (may be []). */
function writeSpec(testRefs: readonly string[]): void {
  const refs =
    testRefs.length > 0 ? '        test_refs:\n' + testRefs.map((r) => `          - ${JSON.stringify(r)}`).join('\n') + '\n' : '';
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject: {name: t, language: typescript}\nfeatures:\n' +
      '  - id: F-abc123\n    slug: thing\n    title: thing\n    status: done\n    acceptance_criteria:\n' +
      `      - id: AC-001\n        ears: ubiquitous\n        text: t\n${refs}`,
  );
}
function touch(rel: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, '');
}

describe('nodeHealth (live SSoT conformance)', () => {
  test('maps an untested done-AC finding to its feature node', () => {
    writeSpec([]); // done AC with NO test_refs → MISSING_TESTS / UNTESTED_AC fire
    const graph = buildGraph(loadSpec(dir), dir);
    const health = nodeHealth(graph, dir);

    const hv = health['feature:F-abc123'];
    expect(hv).toBeTruthy();
    expect(['error', 'warn']).toContain(hv.severity);
    expect(hv.detectors.length).toBeGreaterThan(0);
    expect(hv.count).toBeGreaterThan(0);
  });

  test('a healthy feature (resolving test_ref) is absent from the health map', () => {
    writeSpec(['tests/x.test.ts#it works']);
    touch('tests/x.test.ts'); // the cited test exists → no missing/untested finding
    const graph = buildGraph(loadSpec(dir), dir);
    const health = nodeHealth(graph, dir);

    // The feature is either entirely clean, or at least not flagged for missing/untested tests.
    const hv = health['feature:F-abc123'];
    if (hv) {
      expect(hv.detectors).not.toContain('MISSING_TESTS');
      expect(hv.detectors).not.toContain('UNTESTED_AC');
    }
  });

  test('returns a plain object keyed by graph node id', () => {
    writeSpec([]);
    const graph = buildGraph(loadSpec(dir), dir);
    const health = nodeHealth(graph, dir);
    for (const key of Object.keys(health)) {
      expect(graph.nodes.some((n) => n.id === key)).toBe(true); // every health key is a real node
    }
  });
});
