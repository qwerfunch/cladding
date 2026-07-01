import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {buildGraph, subgraph, resolveNodeId, nodeId} from '../../src/graph/model.js';
import type {Spec} from '../../src/spec/types.js';

describe('graph model (F-569f4b37)', () => {
  let cwd: string;

  beforeEach(() => {
    // Empty temp dir: no docs/ subdir, so no doc nodes appear.
    cwd = mkdtempSync(join(tmpdir(), 'clad-graph-'));
  });

  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  test('assembles nodes and edges from spec, reverse-index, and doc links', () => {
    const spec = {
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [
        {
          id: 'A',
          title: 'feature A',
          status: 'done',
          modules: ['src/a.ts'],
          acceptance_criteria: [
            {id: 'A1', test_refs: ['tests/a.test.ts#x', 'derived:skip']},
          ],
        },
        {
          id: 'B',
          title: 'feature B',
          status: 'done',
          depends_on: ['A'],
        },
      ],
      scenarios: [{id: 'S1', title: 'scenario one', features: ['A']}],
      capabilities: [{id: 'cap1', title: 'capability one', features: ['B']}],
    } as unknown as Spec;

    const g = buildGraph(spec, cwd);

    const hasNode = (id: string): boolean => g.nodes.some((n) => n.id === id);
    const hasEdge = (from: string, to: string, kind: string): boolean =>
      g.edges.some((e) => e.from === from && e.to === to && e.kind === kind);

    // node ids include the expected feature/module/test/scenario/capability ids.
    expect(hasNode('feature:A')).toBe(true);
    expect(hasNode('feature:B')).toBe(true);
    expect(hasNode('module:src/a.ts')).toBe(true);
    expect(hasNode('test:tests/a.test.ts')).toBe(true);
    expect(hasNode('scenario:S1')).toBe(true);
    expect(hasNode('capability:cap1')).toBe(true);

    // kind / status of specific nodes.
    const moduleNode = g.nodes.find((n) => n.id === 'module:src/a.ts');
    expect(moduleNode?.kind).toBe('module');
    const featureANode = g.nodes.find((n) => n.id === 'feature:A');
    expect(featureANode?.kind).toBe('feature');
    expect(featureANode?.status).toBe('done');

    // edges: depends_on, touches, covers, binds, implements.
    expect(hasEdge('feature:B', 'feature:A', 'depends_on')).toBe(true);
    expect(hasEdge('feature:A', 'module:src/a.ts', 'touches')).toBe(true);
    expect(hasEdge('feature:A', 'test:tests/a.test.ts', 'covers')).toBe(true);
    expect(hasEdge('scenario:S1', 'feature:A', 'binds')).toBe(true);
    expect(hasEdge('capability:cap1', 'feature:B', 'implements')).toBe(true);

    // pseudo-ref 'derived:skip' produced NO test node and NO covers edge.
    const testNodes = g.nodes.filter((n) => n.id.startsWith('test:'));
    expect(testNodes.map((n) => n.id)).toEqual(['test:tests/a.test.ts']);
    const coversToNonExistentTest = g.edges.some(
      (e) => e.kind === 'covers' && e.to !== 'test:tests/a.test.ts',
    );
    expect(coversToNonExistentTest).toBe(false);
    // no node id derived from the pseudo-ref.
    expect(hasNode('test:derived:skip')).toBe(false);
    expect(hasNode('test:skip')).toBe(false);

    // anchor stripped: test node id has no '#x'.
    expect(hasNode('test:tests/a.test.ts#x')).toBe(false);

    // determinism.
    expect(JSON.stringify(buildGraph(spec, cwd))).toBe(
      JSON.stringify(buildGraph(spec, cwd)),
    );
  });

  test('subgraph restricts to the focus node neighborhood within depth', () => {
    const spec = {
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [
        {id: 'A', title: 'A', status: 'done'},
        {id: 'B', title: 'B', status: 'done', depends_on: ['A']},
        {id: 'C', title: 'C', status: 'done', depends_on: ['B']},
        {id: 'D', title: 'D', status: 'done', depends_on: ['C']},
      ],
      scenarios: [],
      capabilities: [],
    } as unknown as Spec;

    const g = buildGraph(spec, cwd);

    const ids = (graph: {nodes: readonly {id: string}[]}): string[] =>
      graph.nodes.map((n) => n.id).sort();

    // depth 1: A + 1-hop neighbor B (edges undirected).
    expect(ids(subgraph(g, nodeId.feature('A'), 1))).toEqual([
      'feature:A',
      'feature:B',
    ]);

    // depth 2: include A, B, C but NOT D.
    const d2 = ids(subgraph(g, nodeId.feature('A'), 2));
    expect(d2).toContain('feature:A');
    expect(d2).toContain('feature:B');
    expect(d2).toContain('feature:C');
    expect(d2).not.toContain('feature:D');

    // unknown focus -> empty.
    expect(subgraph(g, 'feature:NOPE', 2)).toEqual({nodes: [], edges: []});
  });

  test('resolveNodeId resolves by id, slug, and null on miss', () => {
    const spec = {
      schema: '0.1',
      project: {name: 'x', language: 'typescript'},
      features: [
        {id: 'A', title: 'A', status: 'done'},
        {id: 'F-z', slug: 'zed', title: 'z', status: 'done'},
      ],
      scenarios: [],
      capabilities: [],
    } as unknown as Spec;

    const g = buildGraph(spec, cwd);

    expect(resolveNodeId(spec, g, 'A')).toBe('feature:A');
    expect(resolveNodeId(spec, g, 'zed')).toBe('feature:F-z');
    expect(resolveNodeId(spec, g, 'nope')).toBeNull();
  });
});
