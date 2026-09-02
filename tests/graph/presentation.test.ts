// Cladding · Spec 0.2 F8 · GraphIR → presentation adapter parity with the legacy assembly.
//
// `presentGraph` may only replace `buildGraph` while it produces the SAME graph. This suite
// is that proof: it compares both assemblies node for node and edge for edge — order
// included — on the self corpus and on a fixture that exercises every presentation edge
// kind, then feeds both graphs to every renderer, the stats pass, the viewer shell, and the
// health stage so a divergence surfaces here rather than as a quietly different export.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {buildGraph} from '../../src/graph/model.js';
import {presentGraph} from '../../src/graph/presentation.js';
import {loadGraphIrV2Workspace} from '../../src/graph/query.js';
import {toDot, toJson, toMermaid, toObsidianVault} from '../../src/graph/render.js';
import {graphStats, renderStats} from '../../src/graph/stats.js';
import {toHtmlShell} from '../../src/graph/viewer-shell.js';
import {computeLayout3d} from '../../src/graph/layout3d.js';
import {edgeColor, instanceColor} from '../../src/graph/stellar.js';
import {nodeHealth} from '../../src/stages/graph-health.js';
import {loadSpec} from '../../src/spec/load.js';
import type {KnowledgeGraph} from '../../src/graph/presentation.js';

const temporary: string[] = [];

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

/**
 * Writes one schema 0.2 workspace carrying every presentation edge kind: a capability
 * that claims a feature, a scenario that binds two, a prerequisite chain, an ordinary
 * module and a skill module, a live `[covers:]` binding, and a document with both an
 * explicit declaration and a prose mention plus a relative Markdown link.
 */
function parityWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-presentation-'));
  temporary.push(root);
  const write = (relative: string, body: string): void => {
    mkdirSync(join(root, relative, '..'), {recursive: true});
    writeFileSync(join(root, relative), body);
  };
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

describe('GraphIR presentation adapter', () => {
  test('[covers:F-208eaa79/AC-531afee4] presents the self corpus exactly as the legacy assembly does', () => {
    const legacy = buildGraph(loadSpec('.'), '.');
    const presented = presentGraph(loadGraphIrV2Workspace('.'), {cwd: '.'});

    // Compared as whole arrays so ORDER is part of the contract: every exporter
    // renders in array order, so a reordered graph is a changed export.
    expect(presented.nodes).toEqual(legacy.nodes);
    expect(presented.edges).toEqual(legacy.edges);
    expect(JSON.stringify(presented)).toBe(JSON.stringify(legacy));
    // A parity assertion between two empty graphs would prove nothing.
    expect(presented.nodes.length).toBeGreaterThan(100);
    expect(new Set(presented.edges.map((edge) => edge.kind))).toEqual(
      new Set(['depends_on', 'touches', 'covers', 'binds', 'implements', 'references', 'links']),
    );
  });

  test('[covers:F-208eaa79/AC-531afee4] presents every edge kind of a fixture workspace exactly as the legacy assembly does', () => {
    const root = parityWorkspace();

    const legacy = buildGraph(loadSpec(root), root);
    const presented = presentGraph(loadGraphIrV2Workspace(root), {cwd: root});

    expect(presented.nodes).toEqual(legacy.nodes);
    expect(presented.edges).toEqual(legacy.edges);
    expect(JSON.stringify(presented)).toBe(JSON.stringify(legacy));
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

  test('[covers:F-208eaa79/AC-616e6e74] answers from the workspace alone, reading nothing but doc tier banners', () => {
    const root = parityWorkspace();
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
    const workspace = loadGraphIrV2Workspace(parityWorkspace());

    const first = presentGraph(workspace);
    const second = presentGraph(workspace);

    expect(first).not.toBe(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('[covers:F-208eaa79/AC-531afee4] feeds every renderer, the stats pass, the viewer shell, and the health stage identically', () => {
    const root = parityWorkspace();
    const legacy = buildGraph(loadSpec(root), root);
    const presented = presentGraph(loadGraphIrV2Workspace(root), {cwd: root});

    expect(toMermaid(presented)).toBe(toMermaid(legacy));
    expect(toDot(presented)).toBe(toDot(legacy));
    expect(toJson(presented)).toBe(toJson(legacy));
    expect([...toObsidianVault(presented)]).toEqual([...toObsidianVault(legacy)]);
    expect(graphStats(presented)).toEqual(graphStats(legacy));
    expect(renderStats(graphStats(presented))).toBe(renderStats(graphStats(legacy)));
    expect(toHtmlShell(presented)).toBe(toHtmlShell(legacy));
    expect(nodeHealth(presented, root)).toEqual(nodeHealth(legacy, root));

    // The 3D layout and the stellar palette read the same node/edge shape; both
    // must accept the adapter's output without a translation step.
    const layoutOf = (graph: KnowledgeGraph) => computeLayout3d(graph.nodes, graph.edges);
    const paletteOf = (graph: KnowledgeGraph) => graph.nodes.map((node) =>
      instanceColor({node, deg: 1, maxDeg: 4}));
    expect(layoutOf(presented)).toEqual(layoutOf(legacy));
    expect(paletteOf(presented)).toEqual(paletteOf(legacy));
    expect(presented.edges.map((edge) => edgeColor(edge.kind))).toEqual(legacy.edges.map((edge) => edgeColor(edge.kind)));

    // Renderers that returned nothing would satisfy every equality above.
    expect(toMermaid(presented)).toContain('Capability One');
    expect(graphStats(presented).hubs.length).toBeGreaterThan(0);
    expect(toHtmlShell(presented)).toContain('doc:docs/guide.md');
  });
});
