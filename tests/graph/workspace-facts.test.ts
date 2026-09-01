// Cladding · Spec 0.2 F8 · authored live-test GraphIR workspace facts.

import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {documentFactAugmentation, workspaceFactAugmentation} from '../../src/graph/workspace-facts.js';
import {graphIrV2, type GraphIrV2Augmentation} from '../../src/spec/compiler/graph-ir-v2.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import type {ArtifactRole, GraphNode} from '../../src/spec/compiler/types.js';
import {scanDocumentFacts} from '../../src/spec/doc-references.js';
import * as documentReferences from '../../src/spec/doc-references.js';
import {currentSafeBindingCensus} from '../../src/proof/current-bindings.js';
import * as currentBindings from '../../src/proof/current-bindings.js';
import {knownCriteriaFromCompilerView} from '../../src/proof/vitest-jest.js';
import {loadGraphIrV2Workspace} from '../../src/graph/query.js';

const roots: string[] = [];

function workspace(schema: '0.1' | '0.2' = '0.1'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-workspace-facts-'));
  roots.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  if (schema === '0.1') {
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.1"', 'project: {name: workspace-facts, language: typescript}', 'features: []', 'scenarios: []', '',
    ].join('\n'));
  } else {
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: workspace-facts', '  language: typescript',
      '  purpose: Keep static GraphIR facts in the compiler kernel.', '  assurance_level: L2',
      '  scenario_policy: advisory', 'features: []', 'scenarios: []', '',
    ].join('\n'));
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  }
  return root;
}

function writeSchema01Features(root: string): void {
  writeFileSync(join(root, 'spec', 'features', 'alpha-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned', 'modules: [tests/live.test.ts]', 'acceptance_criteria:',
    '  - id: AC-11111111', '    text: The system shall retain the alpha test declaration.',
    '    test_refs: [tests/live.test.ts#legacy alpha]', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'beta-bbbbbbbb.yaml'), [
    'id: F-bbbbbbbb', 'slug: beta', 'title: Beta', 'status: planned', 'modules: []', 'acceptance_criteria:',
    '  - id: AC-22222222', '    text: The system shall retain the beta test declaration.', '',
  ].join('\n'));
}

function writeSchema02Feature(root: string): void {
  writeFileSync(join(root, 'spec', 'features', 'alpha-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: Alpha', 'status: in_progress',
    'purpose: Keep the consumer projection on the same source scan.', 'modules: []', 'depends_on: []', 'capability_refs: []',
    'acceptance_criteria:', '  - id: AC-11111111', '    kind: behavior',
    '    statement: The system shall preserve one live-test scan.', '',
  ].join('\n'));
}

function liveCensus(root: string) {
  const compilation = compileSpecWorkspace(root);
  return {
    compilation,
    census: currentSafeBindingCensus(root, knownCriteriaFromCompilerView(compilation.nodes)),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('GraphIR workspace authored covers facts', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] adds exact authored covers without artifact twins and unions every feature owner', () => {
    const root = workspace();
    writeSchema01Features(root);
    writeFileSync(join(root, 'tests', 'live.test.ts'), [
      "it('[covers:F-aaaaaaaa/AC-11111111] alpha live', () => {});",
      "it('[covers:F-bbbbbbbb/AC-22222222] beta live', () => {});", '',
    ].join('\n'));
    const {compilation, census} = liveCensus(root);
    const facts = workspaceFactAugmentation(compilation, census);
    const kernel = graphIrV2(compilation, [facts]);
    const artifact = 'artifact:tests/live.test.ts';
    const criterion = 'criterion:F-aaaaaaaa/AC-11111111';
    const anchor = 'anchor:tests/live.test.ts#[covers:F-aaaaaaaa/AC-11111111] alpha live';

    expect(census).toMatchObject({safe: true, diagnostics: []});
    expect(kernel.criterionProofs(criterion).records).toEqual(expect.arrayContaining([
      expect.objectContaining({relation: 'supports', provenance: 'authored', raw: 'tests/live.test.ts#legacy alpha'}),
      expect.objectContaining({
        relation: 'covers', provenance: 'authored', from: anchor, to: criterion, state: 'resolved',
        raw: '[covers:F-aaaaaaaa/AC-11111111]', normalizedTarget: criterion,
        selector: {precision: 'fragment', value: '[covers:F-aaaaaaaa/AC-11111111] alpha live'},
        owner: {kind: 'text_source', path: 'tests/live.test.ts', selector: '[covers:F-aaaaaaaa/AC-11111111] alpha live'},
      }),
    ]));
    expect(kernel.artifactOwners(artifact).records).toEqual([{
      artifact,
      owners: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb'],
    }]);
    const projection = kernel.project({
      seeds: [artifact], rules: [{relation: 'covers', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    });
    expect(projection.nodes).toEqual([expect.objectContaining({address: artifact, roles: ['test']})]);
    expect(projection.nodes.filter((node) => node.address === artifact)).toHaveLength(1);
    const sourceOnlyCompilation = {
      ...compilation,
      nodes: compilation.nodes.map((node): GraphNode => node.nodeType === 'artifact' && node.address === artifact
        ? {...node, roles: ['source'] as const}
        : node),
    };
    expect(graphIrV2(sourceOnlyCompilation, [facts]).project({
      seeds: [artifact], rules: [{relation: 'covers', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    }).nodes).toEqual([expect.objectContaining({address: artifact, roles: ['source', 'test']})]);

    const observed = graphIrV2(compilation, [facts, {
      layerId: 'junit-observation', nodes: [], completeness: 'complete', unknownReasons: [], edges: [{
        identity: 'alpha-case', from: anchor, to: criterion, relation: 'covers', provenance: 'observed',
        owner: {kind: 'runtime_observation', adapter: 'junit', reference: 'alpha-case'}, state: 'passed',
      }],
    }]);
    const covers = observed.criterionProofs(criterion).records.filter((edge) => edge.relation === 'covers');
    expect(covers).toEqual(expect.arrayContaining([
      expect.objectContaining({provenance: 'authored', state: 'resolved'}),
      expect.objectContaining({provenance: 'observed', state: 'passed'}),
    ]));
  });

  test('[covers:F-208eaa79/AC-d452908b] rejects an unknown carrier and an unsafe scan as explicitly unknown', () => {
    const unknownRoot = workspace();
    writeSchema01Features(unknownRoot);
    writeFileSync(join(unknownRoot, 'tests', 'live.test.ts'), "it('[covers:F-ffffffff/AC-33333333] unknown', () => {});\n");
    const unknown = liveCensus(unknownRoot);
    const unknownFacts = workspaceFactAugmentation(unknown.compilation, unknown.census);
    expect(unknown.census.diagnostics).toEqual([expect.objectContaining({
      code: 'UNKNOWN_CRITERION', criterion: 'F-ffffffff/AC-33333333', file: 'tests/live.test.ts',
    })]);
    expect(unknownFacts).toMatchObject({completeness: 'unknown', nodes: [], edges: []});
    expect(graphIrV2(unknown.compilation, [unknownFacts]).criterionProofs('criterion:F-aaaaaaaa/AC-11111111'))
      .toMatchObject({completeness: 'unknown'});
    expect(loadGraphIrV2Workspace(unknownRoot).kernel.criterionProofs('criterion:F-aaaaaaaa/AC-11111111'))
      .toMatchObject({completeness: 'unknown'});

    const unsafeRoot = workspace();
    writeSchema01Features(unsafeRoot);
    writeFileSync(join(unsafeRoot, 'tests', 'broken.test.ts'), "it('[covers:F-aaaaaaaa/AC-11111111] broken'\n");
    const unsafe = liveCensus(unsafeRoot);
    const unsafeFacts = workspaceFactAugmentation(unsafe.compilation, unsafe.census);
    expect(unsafe.census).toMatchObject({safe: false, bindings: []});
    expect(graphIrV2(unsafe.compilation, [unsafeFacts]).criterionProofs('criterion:F-aaaaaaaa/AC-11111111'))
      .toMatchObject({completeness: 'unknown', reasons: expect.arrayContaining(['current-safe-vitest-jest-bindings: live Vitest/Jest declaration scan is incomplete'])});
    expect(loadGraphIrV2Workspace(unsafeRoot).kernel.criterionProofs('criterion:F-aaaaaaaa/AC-11111111'))
      .toMatchObject({completeness: 'unknown'});
  });

  test('[covers:F-208eaa79/AC-4f8c2542] copies and deeply freezes caller-owned static fact records', () => {
    const root = workspace();
    writeSchema01Features(root);
    const compilation = compileSpecWorkspace(root);
    const locator = {kind: 'text_source' as const, path: 'tests/direct.test.ts', selector: 'direct case'};
    const node = {
      address: 'artifact:tests/direct.test.ts', nodeType: 'artifact' as const, roles: ['test'] as ArtifactRole[],
      owners: ['feature:F-aaaaaaaa'] as string[], provenance: 'authored' as const, locator,
    };
    const anchor = {
      address: 'anchor:tests/direct.test.ts#direct case', nodeType: 'anchor' as const, artifact: node.address,
      selector: 'direct case', selectorProvenance: 'authored' as const, provenance: 'authored' as const, locator,
    };
    const edge = {
      identity: 'direct-case', from: anchor.address, to: 'criterion:F-aaaaaaaa/AC-11111111', relation: 'covers' as const,
      provenance: 'authored' as const, owner: locator, state: 'resolved' as const, raw: '[covers:F-aaaaaaaa/AC-11111111]',
      normalizedTarget: 'criterion:F-aaaaaaaa/AC-11111111', selector: {precision: 'fragment' as const, value: 'direct case'},
    };
    const layer: GraphIrV2Augmentation = {
      layerId: 'mutable-static', nodes: [node, anchor], edges: [edge], completeness: 'complete', unknownReasons: [],
    };
    const kernel = graphIrV2(compilation, [layer]);
    node.roles.push('source');
    node.owners[0] = 'feature:F-bbbbbbbb';
    locator.path = 'tests/mutated.test.ts';
    edge.raw = 'mutated';
    edge.selector.value = 'mutated';

    expect(kernel.project({
      seeds: ['artifact:tests/direct.test.ts'], rules: [{relation: 'covers', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    }).nodes).toEqual([expect.objectContaining({roles: ['test'], owners: ['feature:F-aaaaaaaa']})]);
    expect(kernel.criterionProofs('criterion:F-aaaaaaaa/AC-11111111').records).toEqual(expect.arrayContaining([
      expect.objectContaining({raw: '[covers:F-aaaaaaaa/AC-11111111]', selector: {precision: 'fragment', value: 'direct case'}}),
    ]));
  });

  test('[covers:F-208eaa79/AC-4f8c2542] merges external artifact facts deterministically without replacing compiler artifacts', () => {
    const root = workspace();
    writeSchema01Features(root);
    const compilation = compileSpecWorkspace(root);
    const artifact = 'artifact:tests/permutation.test.ts';
    const externalFacts: readonly GraphIrV2Augmentation[] = [
      {
        layerId: 'external-z',
        nodes: [{
          address: artifact, nodeType: 'artifact', roles: ['test'], owners: ['feature:F-aaaaaaaa'], provenance: 'authored',
          locator: {kind: 'text_source', path: 'tests/permutation.test.ts', selector: 'z'},
        }],
        edges: [], completeness: 'complete', unknownReasons: [],
      },
      {
        layerId: 'external-a',
        nodes: [{
          address: artifact, nodeType: 'artifact', roles: ['doc'], owners: ['feature:F-bbbbbbbb'], provenance: 'authored',
          locator: {kind: 'text_source', path: 'tests/permutation.test.ts', selector: 'a'},
        }],
        edges: [], completeness: 'complete', unknownReasons: [],
      },
      {
        layerId: 'external-derived',
        nodes: [{
          address: artifact, nodeType: 'artifact', roles: ['evidence'], owners: [], provenance: 'derived',
          locator: {kind: 'text_source', path: 'tests/permutation.test.ts', selector: 'derived'},
        }],
        edges: [], completeness: 'complete', unknownReasons: [],
      },
    ];
    const orders = [
      externalFacts,
      [externalFacts[0], externalFacts[2], externalFacts[1]],
      [externalFacts[1], externalFacts[0], externalFacts[2]],
      [externalFacts[1], externalFacts[2], externalFacts[0]],
      [externalFacts[2], externalFacts[0], externalFacts[1]],
      [externalFacts[2], externalFacts[1], externalFacts[0]],
    ];
    const projectArtifact = (address: string, layers: readonly GraphIrV2Augmentation[]) => graphIrV2(compilation, layers).project({
      seeds: [address], rules: [{relation: 'covers', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    }).nodes;
    const projected = orders.map((layers) => projectArtifact(artifact, layers));
    const expectedExternal = [{
      address: artifact,
      nodeType: 'artifact',
      roles: ['doc', 'evidence', 'test'],
      owners: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb'],
      provenance: 'authored',
      locator: {kind: 'text_source', path: 'tests/permutation.test.ts', selector: 'a'},
    }];

    expect(projected).toEqual(Array.from({length: orders.length}, () => expectedExternal));
    expect(new Set(projected.map((nodes) => JSON.stringify(nodes))).size).toBe(1);
    expect(projected.every((nodes) => nodes.filter((node) => node.address === artifact).length === 1)).toBe(true);

    const compilerArtifact = compilation.nodes.find((node) => node.address === 'artifact:tests/live.test.ts');
    if (!compilerArtifact || compilerArtifact.nodeType !== 'artifact') throw new Error('fixture compiler artifact missing');
    const externalOnBase: GraphIrV2Augmentation = {
      layerId: 'external-on-base',
      nodes: [{
        address: compilerArtifact.address, nodeType: 'artifact', roles: ['evidence'], owners: ['feature:F-bbbbbbbb'],
        provenance: 'authored', locator: {kind: 'text_source', path: 'tests/live.test.ts', selector: 'adapter fact'},
      }],
      edges: [], completeness: 'complete', unknownReasons: [],
    };
    const baseProjection = projectArtifact(compilerArtifact.address, [externalOnBase]);
    expect(baseProjection).toEqual([{
      ...compilerArtifact,
      roles: [...new Set([...compilerArtifact.roles, 'evidence'])].sort(),
      owners: [...new Set([...compilerArtifact.owners, 'feature:F-bbbbbbbb'])].sort(),
    }]);
    expect(baseProjection.filter((node) => node.address === compilerArtifact.address)).toHaveLength(1);
    expect(graphIrV2(compilation, [externalOnBase]).corpusRecords()).toEqual(graphIrV2(compilation).corpusRecords());
  });

  test('[covers:F-208eaa79/AC-616e6e74] scans schema 0.2 tests once and exposes the enriched workspace kernel', () => {
    const root = workspace('0.2');
    writeSchema02Feature(root);
    writeFileSync(join(root, 'tests', 'live.test.ts'), "it('[covers:F-aaaaaaaa/AC-11111111] one scan', () => {});\n");
    const spy = vi.spyOn(currentBindings, 'currentSafeBindingCensus');

    const loaded = loadGraphIrV2Workspace(root);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(loaded.kernel.criterionProofs('criterion:F-aaaaaaaa/AC-11111111').records).toEqual(expect.arrayContaining([
      expect.objectContaining({relation: 'covers', provenance: 'authored', state: 'resolved'}),
    ]));
  });
});

describe('GraphIR document facts', () => {
  test('[covers:F-208eaa79/AC-4f8c2542] keeps declarations, organic mentions, and Markdown targets provenance-distinct', () => {
    const root = workspace();
    writeSchema01Features(root);
    mkdirSync(join(root, 'docs', 'dogfood'), {recursive: true});
    writeFileSync(join(root, 'docs', 'target.md'), '# target\n');
    writeFileSync(join(root, 'docs', 'empty.md'), '# no references\n');
    writeFileSync(join(root, 'docs', 'guide.md'), [
      '<!-- clad-doc-links: F-aaaaaaaa -->',
      'Organic F-aaaaaaaa is distinct from the declaration; F-bbbbbbbb and F-deadbeef remain prose facts.',
      '[target](./target.md#section) [missing](./missing.md)', '',
    ].join('\n'));
    writeFileSync(join(root, 'docs', 'strict.md'), '<!-- clad-doc-links: F-feedbeef -->\n');
    writeFileSync(join(root, 'docs', 'dogfood', 'fixture.md'), '<!-- clad-doc-links: F-aaaaaaaa --> F-deadbeef [ignored](./missing.md)\n');
    const compilation = compileSpecWorkspace(root);
    const first = documentFactAugmentation(compilation, scanDocumentFacts(root));
    const second = documentFactAugmentation(compilation, scanDocumentFacts(root));
    const artifact = 'artifact:docs/guide.md';

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({address: artifact, roles: ['doc'], owners: ['feature:F-aaaaaaaa']}),
      expect.objectContaining({address: 'artifact:docs/empty.md', roles: ['doc'], owners: []}),
      expect.objectContaining({address: 'artifact:docs/target.md', roles: ['doc']}),
    ]));
    expect(first.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({relation: 'explains', provenance: 'authored', from: artifact, to: 'feature:F-aaaaaaaa', state: 'resolved'}),
      expect.objectContaining({relation: 'mentions', provenance: 'derived', from: artifact, to: 'feature:F-aaaaaaaa', state: 'resolved'}),
      expect.objectContaining({relation: 'mentions', provenance: 'derived', from: artifact, to: 'feature:F-bbbbbbbb', state: 'resolved'}),
      expect.objectContaining({relation: 'mentions', provenance: 'derived', from: artifact, to: 'feature:F-deadbeef', state: 'unresolved'}),
      expect.objectContaining({relation: 'links_to', provenance: 'authored', from: artifact, to: 'artifact:docs/target.md', raw: './target.md#section', state: 'resolved'}),
      expect.objectContaining({relation: 'links_to', provenance: 'authored', from: artifact, to: 'artifact:docs/missing.md', state: 'unresolved'}),
      expect.objectContaining({relation: 'explains', from: 'artifact:docs/dogfood/fixture.md', to: 'feature:F-aaaaaaaa'}),
    ]));
    expect(first.edges.filter((edge) => edge.relation === 'mentions' && edge.to === 'feature:F-aaaaaaaa')).toHaveLength(1);
    expect(first.edges.filter((edge) => edge.from === 'artifact:docs/dogfood/fixture.md' && edge.relation !== 'explains')).toEqual([]);
    expect(first).toMatchObject({
      completeness: 'unknown',
      unknownReasons: expect.arrayContaining([
        expect.stringContaining('explicit document feature target is absent: F-feedbeef'),
        expect.stringContaining('repository-local Markdown link target is absent: docs/missing.md'),
      ]),
    });
    expect(first.unknownReasons.some((reason) => reason.includes('F-deadbeef'))).toBe(false);

    const existingSourceAndTest: GraphIrV2Augmentation = {
      layerId: 'existing-source-and-test',
      nodes: [{
        address: artifact,
        nodeType: 'artifact',
        roles: ['source', 'test'],
        owners: ['feature:F-bbbbbbbb'],
        provenance: 'authored',
        locator: {kind: 'text_source', path: 'docs/guide.md', selector: 'prior artifact'},
      }],
      edges: [], completeness: 'complete', unknownReasons: [],
    };
    const kernel = graphIrV2(compilation, [existingSourceAndTest, first]);
    const projection = kernel.project({
      seeds: [artifact],
      rules: [
        {relation: 'explains', direction: 'outbound'},
        {relation: 'mentions', direction: 'outbound'},
        {relation: 'links_to', direction: 'outbound'},
      ],
      maxHops: 1, maxNodes: 10, maxEdges: 10,
    });
    expect(projection.nodes.filter((node) => node.address === artifact)).toEqual([
      expect.objectContaining({roles: ['doc', 'source', 'test'], owners: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb']}),
    ]);
    expect(projection).toMatchObject({completeness: 'unknown'});
  });

  test('[covers:F-208eaa79/AC-b8ed5507] keeps document GraphIR identities stable across unrelated facts', () => {
    const root = workspace();
    writeSchema01Features(root);
    mkdirSync(join(root, 'docs'), {recursive: true});
    writeFileSync(join(root, 'docs', 'target.md'), '# target\n');
    writeFileSync(join(root, 'docs', 'other.md'), '# other\n');
    writeFileSync(join(root, 'docs', 'guide.md'), [
      '<!-- clad-doc-links: F-aaaaaaaa -->',
      'Organic F-aaaaaaaa and F-bbbbbbbb. [target](./target.md#heading)',
      '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const initialScan = scanDocumentFacts(root);
    const initial = documentFactAugmentation(compilation, initialScan);

    writeFileSync(join(root, 'docs', 'guide.md'), [
      '<!-- clad-doc-links: F-deadbeef -->',
      'Unrelated F-cafef00d. [other](./other.md)',
      '<!-- clad-doc-links: F-aaaaaaaa -->',
      'Organic F-aaaaaaaa and F-bbbbbbbb. [target](./target.md#heading)',
      '',
    ].join('\n'));
    const insertedScan = scanDocumentFacts(root);
    const inserted = documentFactAugmentation(compilation, insertedScan);
    const retained = (facts: ReturnType<typeof documentFactAugmentation>) => facts.edges
      .filter((edge) => edge.raw === 'F-aaaaaaaa' || edge.raw === 'F-bbbbbbbb' || edge.raw === './target.md#heading')
      .map((edge) => edge.identity)
      .sort();

    expect(retained(initial)).toEqual(retained(inserted));
    expect(retained(inserted)).toEqual(expect.arrayContaining([
      expect.stringContaining('explains:artifact:docs/guide.md#declaration:'),
      expect.stringContaining('mentions:artifact:docs/guide.md#mention:'),
      expect.stringContaining('links_to:artifact:docs/guide.md#link:'),
    ]));
  });

  test('[covers:F-208eaa79/AC-d452908b] makes the document layer unknown without materializing unsafe targets', () => {
    const root = workspace();
    writeSchema01Features(root);
    mkdirSync(join(root, 'docs'), {recursive: true});
    const outside = mkdtempSync(join(tmpdir(), 'clad-workspace-facts-outside-'));
    try {
      writeFileSync(join(outside, 'outside.md'), '# outside\n');
      symlinkSync(join(outside, 'outside.md'), join(root, 'docs', 'escape.md'));
      writeFileSync(join(root, 'docs', 'guide.md'), [
        '[escape](../../outside.md)',
        '[absolute](/outside.md)',
        '[symlink](./escape.md)',
        '',
      ].join('\n'));
      const facts = documentFactAugmentation(compileSpecWorkspace(root), scanDocumentFacts(root));

      expect(facts.completeness).toBe('unknown');
      expect(facts.unknownReasons).toEqual(expect.arrayContaining([
        expect.stringContaining('../../outside.md'),
        expect.stringContaining('/outside.md'),
        expect.stringContaining('./escape.md'),
      ]));
      expect(facts.edges.some((edge) =>
        edge.raw === '../../outside.md' || edge.raw === '/outside.md' || edge.raw === './escape.md')).toBe(false);
      expect(facts.nodes.some((node) => node.address.includes('outside.md') || node.address.includes('..'))).toBe(false);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  test('[covers:F-208eaa79/AC-616e6e74] scans documents once when loading the workspace kernel', () => {
    const root = workspace('0.2');
    writeSchema02Feature(root);
    mkdirSync(join(root, 'docs'), {recursive: true});
    writeFileSync(join(root, 'docs', 'guide.md'), '<!-- clad-doc-links: F-aaaaaaaa -->\n');
    const spy = vi.spyOn(documentReferences, 'scanDocumentFacts');

    const loaded = loadGraphIrV2Workspace(root);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(loaded.kernel.project({
      seeds: ['artifact:docs/guide.md'], rules: [{relation: 'explains', direction: 'outbound'}], maxHops: 1, maxNodes: 2, maxEdges: 1,
    }).edges).toEqual([expect.objectContaining({relation: 'explains', state: 'resolved'})]);
  });
});
