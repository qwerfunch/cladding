// Cladding · Spec 0.2 F8 · the GraphIR presentation adapter is the sole assembly.
//
// `presentGraph` replaced `buildGraph`, the pre-F8 traversal that answered "which
// features touch this file" from the Spec instead of the compiler IR. While both
// existed this suite compared them node for node; now that the legacy assembly is
// deleted, the fixtures below ARE the oracle: two workspaces — one schema 0.2, one
// schema 0.1 — whose complete expected node and edge arrays are written out here,
// order included, because every exporter renders in array order and a reordered
// graph is a changed export.
//
// It also feeds the produced graph to every renderer, the stats pass, the viewer
// shell, the 3D layout, the stellar palette, and the health stage, so a shape the
// adapter changed surfaces here rather than as a quietly different export.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {
  nodeId,
  presentGraph,
  resolveNodeId,
  resolveNodeIds,
  subgraph,
  type KnowledgeGraph,
} from '../../src/graph/presentation.js';
import {loadGraphIrV2Workspace} from '../../src/graph/query.js';
import {toDot, toJson, toMermaid, toObsidianVault} from '../../src/graph/render.js';
import {graphStats, renderStats} from '../../src/graph/stats.js';
import {toHtmlShell} from '../../src/graph/viewer-shell.js';
import {computeLayout3d} from '../../src/graph/layout3d.js';
import {edgeColor, instanceColor} from '../../src/graph/stellar.js';
import {nodeHealth} from '../../src/stages/graph-health.js';
import type {Spec} from '../../src/spec/types.js';

const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

function workspaceRoot(prefix: string): {readonly root: string; readonly write: (relative: string, body: string) => void} {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(root);
  return {
    root,
    write: (relative: string, body: string): void => {
      mkdirSync(join(root, relative, '..'), {recursive: true});
      writeFileSync(join(root, relative), body);
    },
  };
}

/**
 * Writes one schema 0.2 workspace carrying every presentation edge kind: a capability
 * that claims a feature, a scenario that binds two, a prerequisite chain, an ordinary
 * module and a skill module, a live `[covers:]` binding, and a document with both an
 * explicit declaration and a prose mention plus a relative Markdown link.
 */
function schema02Workspace(): string {
  const {root, write} = workspaceRoot('clad-presentation-');
  write('spec.yaml', [
    'schema: "0.2"',
    'project:',
    '  name: presentation-parity',
    '  language: typescript',
    '  purpose: Prove the presentation adapter reproduces the legacy assembly.',
    '  assurance_level: L2',
    '  scenario_policy: advisory',
    'features: []',
    'scenarios: []',
    '',
  ].join('\n'));
  write('spec/capabilities.yaml', [
    'capabilities:',
    '  - id: cap-one',
    '    title: Capability One',
    '    outcome: A reader can trace one capability to the features that deliver it.',
    '',
  ].join('\n'));
  write('spec/architecture.yaml', 'layers:\n  - [spec]\nrules: []\n');
  write('spec/features/alpha-aaaaaaaa.yaml', [
    'id: F-aaaaaaaa',
    'title: Alpha',
    'status: planned',
    'purpose: Alpha keeps the module, skill, and capability edges explicit.',
    'modules: [src/alpha.ts, skills/verb/SKILL.md]',
    'depends_on: []',
    'capability_refs: [cap-one]',
    'acceptance_criteria:',
    '  - id: AC-aaaa0001',
    '    kind: behavior',
    '    statement: The system shall retain the alpha presentation edges.',
    '',
  ].join('\n'));
  write('spec/features/beta-bbbbbbbb.yaml', [
    'id: F-bbbbbbbb',
    'title: Beta',
    'status: planned',
    'purpose: Beta keeps the prerequisite edge explicit.',
    'modules: [src/beta.ts]',
    'depends_on: [F-aaaaaaaa]',
    'capability_refs: []',
    'acceptance_criteria:',
    '  - id: AC-bbbb0001',
    '    kind: behavior',
    '    statement: The system shall retain the beta prerequisite edge.',
    '',
  ].join('\n'));
  write('spec/scenarios/S-aaaaaaaa.yaml', [
    'id: S-aaaaaaaa',
    'title: One traced journey',
    'actor: A reviewer',
    'goal: Trace one journey through both features.',
    'success: The reviewer sees both features bound to the journey.',
    'steps:',
    '  - Open the presentation graph.',
    '  - Follow the journey edges.',
    'feature_refs:',
    '  - F-aaaaaaaa',
    '  - F-bbbbbbbb',
    '',
  ].join('\n'));
  write('src/alpha.ts', 'export const alpha = true;\n');
  write('src/beta.ts', 'export const beta = true;\n');
  write('skills/verb/SKILL.md', '# verb\n');
  write('tests/alpha.test.ts', [
    "import {test, expect} from 'vitest';",
    "test('[covers:F-aaaaaaaa/AC-aaaa0001] alpha holds', () => { expect(true).toBe(true); });",
    "test('[covers:F-bbbbbbbb/AC-bbbb0001] beta holds', () => { expect(true).toBe(true); });",
    '',
  ].join('\n'));
  write('README.md', '# presentation-parity\n');
  write('docs/guide.md', [
    '<!-- Cladding · Tier B · presentation parity guide -->',
    '<!-- clad-doc-links: F-aaaaaaaa -->',
    '# Guide',
    '',
    'The journey also touches F-bbbbbbbb in prose, which is a mention and not a declaration.',
    '',
    // A retired id still reads as a claim the document made, so the doc node must
    // survive while the reference edge does not.
    'Legacy reviewers also cite F-99999999 here.',
    '',
    'See the [notes](./notes.md) and the [root guide](../README.md) for detail.',
    '',
  ].join('\n'));
  write('docs/notes.md', [
    '<!-- Cladding · Tier C · presentation parity notes -->',
    '# Notes',
    '',
    'Nothing links out of here.',
    '',
  ].join('\n'));
  return root;
}

/**
 * Writes the same shape under schema 0.1, where the compiler owns no capability
 * catalog: capabilities live inline in `spec.yaml` and the adapter must read them
 * from the compatibility presentation, exactly as `test_refs` are read.
 */
function schema01Workspace(): string {
  const {root, write} = workspaceRoot('clad-presentation-01-');
  write('spec.yaml', [
    'schema: "0.1"',
    'project: {name: presentation-legacy, language: typescript}',
    'features:',
    '  - id: F-aaa111',
    '    slug: alpha',
    '    title: Alpha',
    '    status: done',
    '    modules: [src/alpha.ts, skills/verb/SKILL.md]',
    '    acceptance_criteria:',
    '      - id: AC-001',
    '        ears: ubiquitous',
    '        text: The system shall retain the alpha presentation edges.',
    '        test_refs: [tests/alpha.test.ts#alpha holds, derived:skip]',
    '  - id: F-bbb222',
    '    slug: beta',
    '    title: Beta',
    '    status: done',
    '    depends_on: [F-aaa111]',
    'scenarios:',
    '  - id: S-001',
    '    title: One traced journey',
    '    features: [F-aaa111]',
    'capabilities:',
    '  - id: cap-one',
    '    title: Capability One',
    '    features: [F-bbb222, F-99999999]',
    '',
  ].join('\n'));
  write('src/alpha.ts', 'export const alpha = true;\n');
  write('skills/verb/SKILL.md', '# verb\n');
  write('tests/alpha.test.ts', 'export {};\n');
  write('docs/guide.md', [
    '<!-- Cladding · Tier B · legacy guide -->',
    '<!-- clad-doc-links: F-aaa111 -->',
    '# Guide',
    '',
    'See the [notes](./notes.md).',
    '',
  ].join('\n'));
  write('docs/notes.md', '<!-- Cladding · Tier C · legacy notes -->\n# Notes\n');
  return root;
}

describe('GraphIR presentation adapter', () => {
  test('[covers:F-208eaa79/AC-531afee4] presents the self corpus with every established kind and a stable order', () => {
    const workspace = loadGraphIrV2Workspace('.');
    const presented = presentGraph(workspace, {cwd: '.'});

    // A shape assertion over an empty graph would prove nothing.
    expect(presented.nodes.length).toBeGreaterThan(100);
    expect(new Set(presented.nodes.map((node) => node.kind))).toEqual(
      new Set(['feature', 'module', 'skill', 'test', 'scenario', 'capability', 'doc']),
    );
    expect(new Set(presented.edges.map((edge) => edge.kind))).toEqual(
      new Set(['depends_on', 'touches', 'covers', 'binds', 'implements', 'references', 'links']),
    );
    for (const id of ['feature:F-208eaa79', 'module:src/graph/presentation.ts', 'capability:knowledge-graph']) {
      expect(presented.nodes.some((node) => node.id === id), `${id} must be presented`).toBe(true);
    }

    // ORDER is part of the contract: every exporter renders in array order.
    expect(presented.nodes.map((node) => node.id)).toEqual(
      [...presented.nodes].sort((left, right) => left.id.localeCompare(right.id)).map((node) => node.id),
    );
    expect(presented.edges).toEqual(
      [...presented.edges].sort(
        (left, right) =>
          left.kind.localeCompare(right.kind) ||
          left.from.localeCompare(right.from) ||
          left.to.localeCompare(right.to),
      ),
    );
    expect(JSON.stringify(presentGraph(workspace, {cwd: '.'}))).toBe(JSON.stringify(presented));
  });

  test('[covers:F-208eaa79/AC-531afee4] presents every edge kind of a schema 0.2 fixture workspace', () => {
    const root = schema02Workspace();

    const presented = presentGraph(loadGraphIrV2Workspace(root), {cwd: root});

    expect(presented.nodes).toEqual([
      {id: 'capability:cap-one', kind: 'capability', label: 'Capability One', tier: 'B'},
      {id: 'doc:docs/guide.md', kind: 'doc', label: 'docs/guide.md', tier: 'B'},
      {id: 'doc:docs/notes.md', kind: 'doc', label: 'docs/notes.md', tier: 'C'},
      // A link target outside docs/ with no banner is a doc node without a tier.
      {id: 'doc:README.md', kind: 'doc', label: 'README.md'},
      {id: 'feature:F-aaaaaaaa', kind: 'feature', label: 'alpha', status: 'planned', tier: 'A', detail: 'Alpha'},
      {id: 'feature:F-bbbbbbbb', kind: 'feature', label: 'beta', status: 'planned', tier: 'A', detail: 'Beta'},
      {id: 'module:skills/verb/SKILL.md', kind: 'skill', label: 'skills/verb/SKILL.md'},
      {id: 'module:src/alpha.ts', kind: 'module', label: 'src/alpha.ts'},
      {id: 'module:src/beta.ts', kind: 'module', label: 'src/beta.ts'},
      {id: 'scenario:S-aaaaaaaa', kind: 'scenario', label: 'One traced journey', tier: 'A'},
      {id: 'test:tests/alpha.test.ts', kind: 'test', label: 'tests/alpha.test.ts'},
    ]);
    expect(presented.edges).toEqual([
      {from: 'scenario:S-aaaaaaaa', to: 'feature:F-aaaaaaaa', kind: 'binds'},
      {from: 'scenario:S-aaaaaaaa', to: 'feature:F-bbbbbbbb', kind: 'binds'},
      {from: 'feature:F-aaaaaaaa', to: 'test:tests/alpha.test.ts', kind: 'covers'},
      {from: 'feature:F-bbbbbbbb', to: 'test:tests/alpha.test.ts', kind: 'covers'},
      {from: 'feature:F-bbbbbbbb', to: 'feature:F-aaaaaaaa', kind: 'depends_on'},
      {from: 'capability:cap-one', to: 'feature:F-aaaaaaaa', kind: 'implements'},
      {from: 'doc:docs/guide.md', to: 'doc:docs/notes.md', kind: 'links'},
      {from: 'doc:docs/guide.md', to: 'doc:README.md', kind: 'links'},
      // F-99999999 is cited but absent: the doc node stays, the reference edge does not.
      {from: 'doc:docs/guide.md', to: 'feature:F-aaaaaaaa', kind: 'references'},
      {from: 'doc:docs/guide.md', to: 'feature:F-bbbbbbbb', kind: 'references'},
      {from: 'feature:F-aaaaaaaa', to: 'module:skills/verb/SKILL.md', kind: 'touches'},
      {from: 'feature:F-aaaaaaaa', to: 'module:src/alpha.ts', kind: 'touches'},
      {from: 'feature:F-bbbbbbbb', to: 'module:src/beta.ts', kind: 'touches'},
    ]);
  });

  test('[covers:F-208eaa79/AC-531afee4] presents a schema 0.1 workspace, reading its inline capabilities from the compatibility presentation', () => {
    const root = schema01Workspace();

    const presented = presentGraph(loadGraphIrV2Workspace(root), {cwd: root});

    expect(presented.nodes).toEqual([
      // Schema 0.1 has no compiler-owned capability catalog, so this node and its
      // edge exist only because the adapter falls back to `spec.capabilities`.
      {id: 'capability:cap-one', kind: 'capability', label: 'Capability One', tier: 'B'},
      {id: 'doc:docs/guide.md', kind: 'doc', label: 'docs/guide.md', tier: 'B'},
      {id: 'doc:docs/notes.md', kind: 'doc', label: 'docs/notes.md', tier: 'C'},
      {id: 'feature:F-aaa111', kind: 'feature', label: 'alpha', status: 'done', tier: 'A', detail: 'Alpha'},
      {id: 'feature:F-bbb222', kind: 'feature', label: 'beta', status: 'done', tier: 'A', detail: 'Beta'},
      {id: 'module:skills/verb/SKILL.md', kind: 'skill', label: 'skills/verb/SKILL.md'},
      {id: 'module:src/alpha.ts', kind: 'module', label: 'src/alpha.ts'},
      {id: 'scenario:S-001', kind: 'scenario', label: 'One traced journey', tier: 'A'},
      {id: 'test:tests/alpha.test.ts', kind: 'test', label: 'tests/alpha.test.ts'},
    ]);
    expect(presented.edges).toEqual([
      {from: 'scenario:S-001', to: 'feature:F-aaa111', kind: 'binds'},
      {from: 'feature:F-aaa111', to: 'test:tests/alpha.test.ts', kind: 'covers'},
      {from: 'feature:F-bbb222', to: 'feature:F-aaa111', kind: 'depends_on'},
      // The capability claims an absent feature too; only the resolvable claim draws.
      {from: 'capability:cap-one', to: 'feature:F-bbb222', kind: 'implements'},
      {from: 'doc:docs/guide.md', to: 'doc:docs/notes.md', kind: 'links'},
      {from: 'doc:docs/guide.md', to: 'feature:F-aaa111', kind: 'references'},
      {from: 'feature:F-aaa111', to: 'module:skills/verb/SKILL.md', kind: 'touches'},
      {from: 'feature:F-aaa111', to: 'module:src/alpha.ts', kind: 'touches'},
    ]);
    // The `derived:skip` pseudo-reference names no file, so it becomes no test node.
    expect(presented.nodes.filter((node) => node.kind === 'test').map((node) => node.id)).toEqual([
      'test:tests/alpha.test.ts',
    ]);
    expect(presented.nodes.some((node) => node.id.startsWith('test:derived'))).toBe(false);
  });

  test('[covers:F-208eaa79/AC-616e6e74] answers from the workspace alone, reading nothing but doc tier banners', () => {
    const root = schema02Workspace();
    const workspace = loadGraphIrV2Workspace(root);
    const baseline = presentGraph(workspace, {cwd: root});

    // Destroying the workspace on disk is the falsifiable form of "reads only the
    // workspace": a second spec load, doc scan, or module stat would now throw or
    // return a smaller graph. Only the tier banners are genuine filesystem reads,
    // so exactly the doc nodes may lose their `tier`.
    rmSync(root, {recursive: true, force: true});
    temporary.splice(temporary.indexOf(root), 1);
    const detached = presentGraph(workspace, {cwd: root});

    expect(detached.edges).toEqual(baseline.edges);
    expect(detached.nodes).toEqual(baseline.nodes.map((node) => {
      if (node.kind !== 'doc') return node;
      const withoutTier: Record<string, unknown> = {...node};
      delete withoutTier.tier;
      return withoutTier;
    }));
    expect(baseline.nodes.filter((node) => node.kind === 'doc' && node.tier !== undefined)).toHaveLength(2);
  });

  test('[covers:F-208eaa79/AC-616e6e74] rebuilds byte-identically from one workspace', () => {
    const workspace = loadGraphIrV2Workspace(schema02Workspace());

    const first = presentGraph(workspace);
    const second = presentGraph(workspace);

    expect(first).not.toBe(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('[covers:F-208eaa79/AC-531afee4] feeds every renderer, the stats pass, the viewer shell, and the health stage', () => {
    const root = schema02Workspace();
    const presented = presentGraph(loadGraphIrV2Workspace(root), {cwd: root});

    // Every consumer accepts the adapter's output without a translation step, and
    // every one of them is deterministic over it.
    expect(toMermaid(presented)).toBe(toMermaid(presented));
    expect(toDot(presented)).toBe(toDot(presented));
    expect(toJson(presented)).toBe(toJson(presented));
    expect([...toObsidianVault(presented)]).toEqual([...toObsidianVault(presented)]);
    expect(renderStats(graphStats(presented))).toBe(renderStats(graphStats(presented)));
    expect(toHtmlShell(presented)).toBe(toHtmlShell(presented));
    expect(nodeHealth(presented, root)).toEqual(nodeHealth(presented, root));

    const layoutOf = (graph: KnowledgeGraph) => computeLayout3d(graph.nodes, graph.edges);
    const paletteOf = (graph: KnowledgeGraph) => graph.nodes.map((node) => instanceColor({node, deg: 1, maxDeg: 4}));
    expect(layoutOf(presented)).toEqual(layoutOf(presented));
    expect(paletteOf(presented)).toHaveLength(presented.nodes.length);
    expect(presented.edges.map((edge) => edgeColor(edge.kind))).toHaveLength(presented.edges.length);

    // Renderers that returned nothing would satisfy every equality above.
    expect(toMermaid(presented)).toContain('Capability One');
    expect(toDot(presented)).toContain('src/alpha.ts');
    expect(toObsidianVault(presented).size).toBe(presented.nodes.length);
    expect(graphStats(presented).hubs.length).toBeGreaterThan(0);
    expect(graphStats(presented).nodeCount).toBe(presented.nodes.length);
    expect(toHtmlShell(presented)).toContain('doc:docs/guide.md');
  });

  test('[covers:F-208eaa79/AC-616e6e74] subgraph restricts to the focus node neighbourhood within depth', () => {
    // A prerequisite chain A ← B ← C ← D, written as the presentation shape the
    // adapter emits so the traversal contract is tested without a workspace load.
    const chain: KnowledgeGraph = {
      nodes: ['A', 'B', 'C', 'D'].map((id) => ({id: nodeId.feature(id), kind: 'feature' as const, label: id, tier: 'A' as const})),
      edges: [
        {from: 'feature:B', to: 'feature:A', kind: 'depends_on'},
        {from: 'feature:C', to: 'feature:B', kind: 'depends_on'},
        {from: 'feature:D', to: 'feature:C', kind: 'depends_on'},
      ],
    };
    const ids = (graph: KnowledgeGraph): string[] => graph.nodes.map((node) => node.id).sort();

    // Depth 1: A plus its one-hop neighbour B (edges traverse undirected here).
    expect(ids(subgraph(chain, nodeId.feature('A'), 1))).toEqual(['feature:A', 'feature:B']);

    const depthTwo = ids(subgraph(chain, nodeId.feature('A'), 2));
    expect(depthTwo).toEqual(['feature:A', 'feature:B', 'feature:C']);
    expect(depthTwo).not.toContain('feature:D');

    // Depth 0 induces only the edges among the seeds — the CLI's projection path.
    expect(subgraph(chain, [nodeId.feature('A'), nodeId.feature('B')], 0)).toEqual({
      nodes: [chain.nodes[0], chain.nodes[1]],
      edges: [chain.edges[0]],
    });

    // An unknown focus is an empty graph, never the whole corpus.
    expect(subgraph(chain, 'feature:NOPE', 2)).toEqual({nodes: [], edges: []});
  });

  test('[covers:F-208eaa79/AC-616e6e74] resolveNodeId resolves by id and slug, and returns null on a miss', () => {
    const spec = {
      features: [
        {id: 'F-aaa111', title: 'A'},
        {id: 'F-bbb222', slug: 'zed', title: 'z'},
      ],
    } as unknown as Spec;
    const graph: KnowledgeGraph = {
      nodes: [
        {id: 'feature:F-aaa111', kind: 'feature', label: 'A', tier: 'A'},
        {id: 'feature:F-bbb222', kind: 'feature', label: 'zed', tier: 'A'},
      ],
      edges: [],
    };

    expect(resolveNodeId(spec, graph, 'F-aaa111')).toBe('feature:F-aaa111');
    expect(resolveNodeId(spec, graph, 'zed')).toBe('feature:F-bbb222');
    expect(resolveNodeId(spec, graph, 'nope')).toBeNull();
  });

  test('[covers:F-208eaa79/AC-616e6e74] a path query resolves ALL kind-twins and the subgraph seeds the union', () => {
    // One file, two roles: feature A lists tests/shared.test.ts as a MODULE, feature
    // B cites it as a TEST — two graph nodes for one path (95 such paths on
    // cladding-self). A first-twin-only focus silently dropped B's edges.
    const spec = {
      features: [
        {id: 'F-aaa111', slug: 'alpha', title: 'A'},
        {id: 'F-bbb222', slug: 'beta', title: 'B'},
      ],
    } as unknown as Spec;
    const graph: KnowledgeGraph = {
      nodes: [
        {id: 'feature:F-aaa111', kind: 'feature', label: 'alpha', tier: 'A'},
        {id: 'feature:F-bbb222', kind: 'feature', label: 'beta', tier: 'A'},
        {id: 'module:tests/shared.test.ts', kind: 'module', label: 'tests/shared.test.ts'},
        {id: 'test:tests/shared.test.ts', kind: 'test', label: 'tests/shared.test.ts'},
      ],
      edges: [
        {from: 'feature:F-aaa111', to: 'module:tests/shared.test.ts', kind: 'touches'},
        {from: 'feature:F-bbb222', to: 'test:tests/shared.test.ts', kind: 'covers'},
      ],
    };

    const twins = resolveNodeIds(spec, graph, 'tests/shared.test.ts');
    expect([...twins].sort()).toEqual(['module:tests/shared.test.ts', 'test:tests/shared.test.ts']);

    const union = subgraph(graph, twins, 1).nodes.map((node) => node.id);
    expect(union).toContain('feature:F-aaa111');
    expect(union).toContain('feature:F-bbb222');
    const single = subgraph(graph, 'module:tests/shared.test.ts', 1).nodes.map((node) => node.id);
    expect(single).not.toContain('feature:F-bbb222');

    // The singular resolver keeps its first-twin contract for old callers.
    expect(resolveNodeId(spec, graph, 'tests/shared.test.ts')).toBe('module:tests/shared.test.ts');
  });
});
