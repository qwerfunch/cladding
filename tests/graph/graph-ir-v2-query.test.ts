// Cladding · Spec 0.2 F8 · compiler-owned GraphIR v2 query kernel tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {graphIrV2} from '../../src/spec/compiler/graph-ir-v2.js';
import {scanIndependentCorpus} from '../../src/spec/compiler/corpus-snapshot.js';
import type {GraphEdge, GraphNode, GraphPresentationRecord, SourceLocator, SpecCompilation} from '../../src/spec/compiler/types.js';

const temporary: string[] = [];

function workspace(schema: '0.1' | '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-graph-ir-v2-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {verify: 'vitest run'}}));
  if (schema === '0.1') {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: graph fixture\n  language: typescript\nfeatures: []\nscenarios: []\n');
  } else {
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: graph fixture', '  language: typescript',
      '  purpose: Preserve compiler-owned graph intent.', '  assurance_level: L2', '  scenario_policy: advisory', '',
    ].join('\n'));
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), [
      'layers:', '  - [spec]', 'rules:', '  - id: AR-11111111', '    kind: forbidden_import',
      '    from: spec', '    to: cli', '    rationale: Retain the declared boundary.', '',
    ].join('\n'));
  }
  return root;
}

function writeSchema01GraphFixture(root: string): void {
  writeFileSync(join(root, 'src', 'shared.ts'), 'export const shared = true;\n');
  writeFileSync(join(root, 'tests', 'shared.test.ts'), 'export const shared = true;\n');
  writeFileSync(join(root, 'spec', 'features', 'alpha-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned', 'modules: [src/shared.ts]', 'acceptance_criteria:',
    '  - id: AC-deadbeef', '    text: The system shall preserve alpha.', '    test_refs: [tests/shared.test.ts#alpha regression]', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'beta-bbbbbbbb.yaml'), [
    'id: F-bbbbbbbb', 'slug: beta', 'title: Beta', 'status: planned', 'depends_on: [F-aaaaaaaa]', 'modules: [src/shared.ts, tests/shared.test.ts]', 'acceptance_criteria:',
    '  - id: AC-deadbeef', '    text: The system shall preserve beta.', '    test_refs: [tests/shared.test.ts#beta regression]', '',
  ].join('\n'));
}

function writeSchema02GraphFixture(root: string): void {
  writeFileSync(join(root, 'spec', 'features', 'strict-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: Strict graph', 'status: planned', 'purpose: Preserve directed graph intent.', 'modules: [src/strict.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-deadbeef', '    kind: constraint', '    statement: The system shall preserve an explicit graph boundary.', '    rationale: A criterion retains its authored reason.', '    constraint_refs: [AR-11111111]', '',
  ].join('\n'));
  writeFileSync(join(root, 'src', 'strict.ts'), 'export const strict = true;\n');
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

const FIDELITY_EXPECTATIONS = {
  structuralFeature: 'feature:F-aaaaaaaa',
  structuralCriterion: 'criterion:F-aaaaaaaa/AC-deadbeef',
  featurePurpose: 'Preserve directed graph intent.',
  criterionRationale: 'A criterion retains its authored reason.',
  proofFeature: 'feature:F-bbbbbbbb',
  prerequisite: 'feature:F-aaaaaaaa',
  proofCriterion: 'criterion:F-aaaaaaaa/AC-deadbeef',
  proofTarget: 'anchor:tests/shared.test.ts#alpha regression',
  selector: {precision: 'fragment', value: 'alpha regression'},
} as const;

function graphIrV2FidelityFailures(
  structuralCompilation: SpecCompilation,
  proofCompilation: SpecCompilation,
): readonly string[] {
  const failures: string[] = [];
  const structuralKernel = graphIrV2(structuralCompilation);
  const structure = structuralKernel.project({
    seeds: [FIDELITY_EXPECTATIONS.structuralFeature], rules: [{relation: 'contains', direction: 'outbound'}], maxHops: 1, maxNodes: 4, maxEdges: 4,
  });
  if (!structure.nodes.some((node) => node.address === FIDELITY_EXPECTATIONS.structuralCriterion)) {
    failures.push('criterion node missing');
  }
  const feature = structuralKernel.presentationRecords().find((record) => record.address === FIDELITY_EXPECTATIONS.structuralFeature);
  if (feature?.purpose !== FIDELITY_EXPECTATIONS.featurePurpose) failures.push('feature purpose missing');
  const criterion = structuralKernel.presentationRecords().find((record) => record.address === FIDELITY_EXPECTATIONS.structuralCriterion);
  if (criterion?.rationale !== FIDELITY_EXPECTATIONS.criterionRationale) failures.push('criterion rationale missing');

  const proofKernel = graphIrV2(proofCompilation);
  const support = proofKernel.criterionProofs(FIDELITY_EXPECTATIONS.proofCriterion).records.find((edge) => (
    edge.relation === 'supports'
    && edge.from === FIDELITY_EXPECTATIONS.proofCriterion
    && edge.to === FIDELITY_EXPECTATIONS.proofTarget
  ));
  if (support?.selector?.precision !== FIDELITY_EXPECTATIONS.selector.precision
    || support.selector.value !== FIDELITY_EXPECTATIONS.selector.value) {
    failures.push('support selector missing');
  }
  if (support?.provenance !== 'authored') failures.push('support provenance missing');
  const expectedDirection = proofKernel.prerequisites('F-bbbbbbbb').records.some((record) => (
    record.feature === FIDELITY_EXPECTATIONS.proofFeature
    && record.prerequisite === FIDELITY_EXPECTATIONS.prerequisite
  ));
  if (!expectedDirection) failures.push('prerequisite direction missing');
  return failures;
}

describe('compiler GraphIR v2 query kernel', () => {
  test('[covers:F-208eaa79/AC-1f71c694] matches the independent scanner records for self and hand-built schema 0.1/0.2 corpora', () => {
    const schema01 = workspace('0.1');
    const schema02 = workspace('0.2');
    writeSchema01GraphFixture(schema01);
    writeSchema02GraphFixture(schema02);
    for (const root of [process.cwd(), schema01, schema02]) {
      const expected = scanIndependentCorpus(root).records;
      const actual = graphIrV2(compileSpecWorkspace(root)).corpusRecords();
      expect(actual).toEqual(expected);
    }
  }, 15_000);

  test('[covers:F-208eaa79/AC-1f6fd7fe] keeps B→A prerequisites and A→B dependents directed, with a direction ablation', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const compilation = compileSpecWorkspace(root);
    const kernel = graphIrV2(compilation);
    const prerequisites = kernel.prerequisites('F-bbbbbbbb');
    const dependents = kernel.dependents('F-aaaaaaaa');
    const wrongDirection = kernel.prerequisites('F-aaaaaaaa');
    const independentFacts = compilation.edges
      .filter((edge) => edge.relation === 'depends_on' && edge.provenance === 'authored')
      .map((edge) => [edge.from, edge.to]);
    expect(prerequisites.records.map((record) => [record.feature, record.prerequisite])).toEqual(independentFacts);
    expect(dependents.records.map((record) => [record.feature, record.dependent])).toEqual(independentFacts.map(([from, to]) => [to, from]));
    expect(wrongDirection.records).not.toEqual(prerequisites.records);
    const transitive = graphIrV2(syntheticCompilation(3));
    expect(transitive.prerequisites('F-00000002', 2).records).toHaveLength(2);
    expect(transitive.dependents('F-00000000', 2).records).toHaveLength(2);
    expect(() => transitive.prerequisites('F-00000002', 0.5)).toThrow(/finite non-negative integer/);
  });

  test('[covers:F-208eaa79/AC-1f6fd7fe] cannot turn the project seed into a repository or sibling hub', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const result = graphIrV2(compileSpecWorkspace(root)).project({
      seeds: ['project'], rules: [{relation: 'defined_in', direction: 'outbound'}], maxHops: 2, maxNodes: 20, maxEdges: 20,
    });
    expect(result.completeness).toBe('complete');
    expect(result.nodes.map((node) => node.address)).toEqual(['artifact:spec.yaml', 'project']);
    expect(result.nodes.some((node) => node.address.startsWith('feature:'))).toBe(false);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] indexes one multi-role artifact with all feature owners', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const result = graphIrV2(compileSpecWorkspace(root)).artifactOwners('src/shared.ts');
    expect(result).toMatchObject({completeness: 'complete', records: [{
      artifact: 'artifact:src/shared.ts', owners: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb'],
    }]});
  });

  test('[covers:F-208eaa79/AC-ff543b95] rejects bare criteria and reports composite, slug, and path collisions explicitly', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    writeFileSync(join(root, 'spec', 'features', 'collision-cccccccc.yaml'), [
      'id: F-cccccccc', 'slug: alpha', 'title: Collision', 'status: planned', 'modules: [src/shared.ts]', 'acceptance_criteria:',
      '  - id: AC-deadbeef', '    text: The system shall retain a unique composite address.', '',
    ].join('\n'));
    writeFileSync(join(root, 'spec', 'features', 'path-dddddddd.yaml'), [
      'id: F-dddddddd', 'slug: src/shared.ts', 'title: Path collision', 'status: planned', 'modules: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const kernel = graphIrV2(compilation);
    expect(graphIrV2(compilation)).toBe(graphIrV2(compilation));
    expect(kernel.resolveAddress('AC-deadbeef')).toMatchObject({state: 'unresolved', form: 'noncanonical'});
    expect(kernel.resolveAddress('F-aaaaaaaa')).toMatchObject({state: 'resolved', canonical: 'feature:F-aaaaaaaa', via: 'feature_id'});
    expect(kernel.resolveAddress('./src/shared.ts')).toMatchObject({state: 'resolved', canonical: 'artifact:src/shared.ts', via: 'path'});
    expect(kernel.resolveAddress('tests/shared.test.ts#alpha regression')).toMatchObject({state: 'resolved', canonical: 'anchor:tests/shared.test.ts#alpha regression', via: 'anchor'});
    expect(kernel.resolveAddress('criterion:F-aaaaaaaa/AC-deadbeef')).toMatchObject({state: 'resolved'});
    expect(kernel.resolveAddress('criterion:F-bbbbbbbb/AC-deadbeef')).toMatchObject({state: 'resolved'});
    expect(kernel.resolveAddress('criterion:F-aaaaaaaa/AC-deadbeef/extra')).toMatchObject({state: 'unresolved', form: 'noncanonical'});
    expect(kernel.resolveAddress('alpha')).toMatchObject({state: 'ambiguous'});
    expect(kernel.resolveAddress('src/shared.ts')).toMatchObject({state: 'ambiguous'});
  });

  test('[covers:F-208eaa79/AC-d452908b] preserves authored supports separately from observed anchor→criterion covers', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const compilation = compileSpecWorkspace(root);
    const criterion = 'criterion:F-aaaaaaaa/AC-deadbeef';
    const anchor = 'anchor:tests/shared.test.ts#alpha regression';
    const kernel = graphIrV2(compilation, [{
      layerId: 'runner-receipt', nodes: [], completeness: 'complete', unknownReasons: [], edges: [{
        identity: 'case:alpha', from: anchor, to: criterion, relation: 'covers', provenance: 'observed',
        owner: {kind: 'runtime_observation', adapter: 'junit', reference: 'case:alpha'}, state: 'passed',
        raw: '[covers:F-aaaaaaaa/AC-deadbeef]', normalizedTarget: criterion,
        selector: {precision: 'fragment', value: 'alpha regression'},
      }],
    }]);
    const proofs = kernel.criterionProofs(criterion).records;
    const regression = kernel.regressions(criterion).records[0];
    const featureRegressions = kernel.regressions('F-aaaaaaaa').records;
    expect(proofs).toEqual(expect.arrayContaining([
      expect.objectContaining({relation: 'supports', provenance: 'authored', raw: 'tests/shared.test.ts#alpha regression', normalizedTarget: anchor, selector: {precision: 'fragment', value: 'alpha regression'}, state: 'resolved'}),
      expect.objectContaining({relation: 'covers', provenance: 'observed', from: anchor, to: criterion, state: 'passed'}),
    ]));
    expect(regression).toMatchObject({raw: 'tests/shared.test.ts#alpha regression', normalizedTarget: anchor, selector: {precision: 'fragment', value: 'alpha regression'}, resolution: 'resolved'});
    expect(featureRegressions).toEqual([regression]);
    expect(proofs.filter((edge) => edge.relation === 'covers')).not.toEqual(proofs.filter((edge) => edge.relation === 'supports'));
    expect(proofs.map((edge) => ({...edge, selector: undefined}))).not.toEqual(proofs);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] rejects malformed runtime facts before indexing and retains canonical anchor→criterion covers', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const compilation = compileSpecWorkspace(root);
    const criterion = 'criterion:F-aaaaaaaa/AC-deadbeef';
    const anchor = 'anchor:tests/shared.test.ts#alpha regression';
    const edge = {
      identity: 'case:strict', from: anchor, to: criterion, relation: 'covers' as const, provenance: 'observed' as const,
      owner: {kind: 'runtime_observation' as const, adapter: 'junit', reference: 'case:strict'}, state: 'passed' as const,
    };
    const layer = {layerId: 'strict-receipt', nodes: [], edges: [edge], completeness: 'complete' as const, unknownReasons: []};
    expect(graphIrV2(compilation, [layer]).criterionProofs(criterion).records).toEqual(expect.arrayContaining([
      expect.objectContaining({identity: 'case:strict', from: anchor, to: criterion, relation: 'covers'}),
    ]));
    expect(() => graphIrV2(compilation, [{...layer, layerId: ' '}])).toThrow(/layer id must be nonblank/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, identity: ''}]}])).toThrow(/identity must be nonblank/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, owner: {...edge.owner, adapter: ' '}}]}])).toThrow(/adapter and reference/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, owner: {...edge.owner, reference: ' '}}]}])).toThrow(/adapter and reference/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, to: 'criterion:F-aaaaaaaa/AC-missing'}]}])).toThrow(/absent from the combined GraphIR node set/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, from: criterion, to: anchor}]}])).toThrow(/invalid covers endpoint taxonomy/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, from: 'feature:F-aaaaaaaa', to: 'artifact:tests/shared.test.ts'}]}])).toThrow(/invalid covers endpoint taxonomy/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, relation: 'mentions' as const, from: 'feature:F-aaaaaaaa', to: criterion}]}])).toThrow(/invalid mentions endpoint taxonomy/);
    const missingCanonicalTarget = 'artifact:runtime/missing-receipt.json';
    const unresolvedMissingTarget = {...edge, state: 'unresolved' as const, normalizedTarget: missingCanonicalTarget};
    expect(graphIrV2(compilation, [{...layer, edges: [unresolvedMissingTarget]}]).criterionProofs(criterion).records).toEqual(expect.arrayContaining([
      expect.objectContaining({identity: 'case:strict', state: 'unresolved', normalizedTarget: missingCanonicalTarget}),
    ]));
    const unresolvedDocumentLink = {
      identity: 'document:missing',
      from: 'artifact:tests/shared.test.ts',
      to: 'artifact:docs/missing.md',
      relation: 'links_to' as const,
      provenance: 'authored' as const,
      owner: {kind: 'text_source' as const, path: 'tests/shared.test.ts', selector: 'link:1:1:0'},
      state: 'unresolved' as const,
      raw: './missing.md',
      normalizedTarget: 'artifact:docs/missing.md',
      selector: {precision: 'fragment' as const, value: 'link:1:1:0'},
    };
    const unresolvedKernel = graphIrV2(compilation, [{
      layerId: 'unresolved-document-link', nodes: [], edges: [unresolvedDocumentLink], completeness: 'unknown', unknownReasons: ['missing document target'],
    }]);
    expect(unresolvedKernel.project({
      seeds: ['artifact:tests/shared.test.ts'], rules: [{relation: 'links_to', direction: 'outbound'}], maxHops: 1, maxNodes: 2, maxEdges: 1,
    })).toMatchObject({completeness: 'unknown', reasons: expect.arrayContaining(['edge endpoint is absent: authored:document:missing'])});
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...edge, state: 'resolved' as const, normalizedTarget: missingCanonicalTarget}]}])).toThrow(/normalized target.*absent from the combined GraphIR node set/);
    expect(() => graphIrV2(compilation, [{...layer, edges: [{...unresolvedMissingTarget, normalizedTarget: 'runtime/missing-receipt.json'}]}])).toThrow(/not canonical/);
  });

  test('[covers:F-208eaa79/AC-4f8c2542] deduplicates exact future facts and fails closed on conflicting identities', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const compilation = compileSpecWorkspace(root);
    const edge = {
      identity: 'case:dedupe', from: 'anchor:tests/shared.test.ts#alpha regression', to: 'criterion:F-aaaaaaaa/AC-deadbeef',
      relation: 'covers' as const, provenance: 'observed' as const,
      owner: {kind: 'runtime_observation' as const, adapter: 'junit', reference: 'case:dedupe'}, state: 'passed' as const,
    };
    const reordered = {
      state: 'passed' as const, owner: {reference: 'case:dedupe', adapter: 'junit', kind: 'runtime_observation' as const},
      provenance: 'observed' as const, relation: 'covers' as const, to: 'criterion:F-aaaaaaaa/AC-deadbeef',
      from: 'anchor:tests/shared.test.ts#alpha regression', identity: 'case:dedupe',
    };
    const layer = {layerId: 'dedupe', nodes: [], edges: [edge, reordered], completeness: 'complete' as const, unknownReasons: []};
    expect(graphIrV2(compilation, [layer]).criterionProofs('criterion:F-aaaaaaaa/AC-deadbeef').records.filter((record) => record.relation === 'covers')).toHaveLength(1);
    expect(() => graphIrV2(compilation, [{...layer, edges: [edge, {...edge, state: 'failed' as const}]}])).toThrow(/conflicting duplicate edge identity/);
  });

  test('[covers:F-208eaa79/AC-d452908b] makes unresolved, unknown, and bounded results explicit and rejects invalid bounds', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const kernel = graphIrV2(compileSpecWorkspace(root));
    expect(kernel.prerequisites('F-missing')).toMatchObject({completeness: 'unresolved'});
    expect(kernel.artifactOwners('spec.yaml')).toMatchObject({completeness: 'unknown'});
    expect(kernel.project({
      seeds: ['F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 1, maxNodes: 1, maxEdges: 1,
    })).toMatchObject({completeness: 'bounded'});
    expect(() => kernel.project({
      seeds: ['F-aaaaaaaa', 'F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    })).toThrow(/cannot exclude a required resolved seed/);
    expect(kernel.project({
      seeds: ['F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 0, maxNodes: 1, maxEdges: 0,
    })).toMatchObject({completeness: 'complete', nodes: [expect.objectContaining({address: 'feature:F-bbbbbbbb'})], edges: []});
    expect(() => kernel.project({
      seeds: ['F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 1, maxNodes: 1, maxEdges: 0,
    })).toThrow(/depth-zero/);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5]) {
      expect(() => kernel.project({
        seeds: ['F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: invalid, maxNodes: 1, maxEdges: 1,
      })).toThrow(/finite non-negative integer/);
    }
  });

  test('[covers:F-208eaa79/AC-d452908b] fails incomplete predicted impact and unknown observation layers closed', () => {
    const root = workspace('0.1');
    writeSchema01GraphFixture(root);
    const compilation = compileSpecWorkspace(root);
    const missingEdge: GraphEdge = {
      address: 'feature:F-bbbbbbbb|depends_on|feature:F-missing|synthetic:missing', from: 'feature:F-bbbbbbbb', to: 'feature:F-missing',
      relation: 'depends_on', provenance: 'authored', owner: {path: 'spec/features/beta-bbbbbbbb.yaml', yamlPath: '$.depends_on[1]', range: {start: 0, end: 0, line: 1, column: 1}},
    };
    const incomplete = graphIrV2({...compilation, edges: [...compilation.edges, missingEdge]});
    expect(incomplete.prerequisites('F-bbbbbbbb')).toMatchObject({completeness: 'unknown'});
    expect(incomplete.project({
      seeds: ['F-bbbbbbbb'], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 1, maxNodes: 4, maxEdges: 4,
    })).toMatchObject({completeness: 'unknown'});
    const unknownLayer = graphIrV2(compilation, [{layerId: 'offline-ledger', nodes: [], edges: [], completeness: 'unknown', unknownReasons: ['receipt ledger is unavailable']}]);
    expect(unknownLayer.criterionProofs('criterion:F-aaaaaaaa/AC-deadbeef')).toMatchObject({completeness: 'unknown', reasons: expect.arrayContaining(['offline-ledger: receipt ledger is unavailable'])});
  });

  test('[covers:F-208eaa79/AC-9ea1a6ed] independently rejects every discriminating GraphIR fidelity ablation', () => {
    const structuralRoot = workspace('0.2');
    const proofRoot = workspace('0.1');
    writeSchema02GraphFixture(structuralRoot);
    writeSchema01GraphFixture(proofRoot);
    const structuralCompilation = compileSpecWorkspace(structuralRoot);
    const proofCompilation = compileSpecWorkspace(proofRoot);

    expect(graphIrV2FidelityFailures(structuralCompilation, proofCompilation)).toEqual([]);
    expect(graphIrV2FidelityFailures({
      ...structuralCompilation,
      nodes: structuralCompilation.nodes.filter((node) => node.address !== FIDELITY_EXPECTATIONS.structuralCriterion),
    }, proofCompilation)).toEqual(['criterion node missing']);
    expect(graphIrV2FidelityFailures(structuralCompilation, {
      ...proofCompilation,
      edges: proofCompilation.edges.map((edge) => edge.from === FIDELITY_EXPECTATIONS.proofCriterion && edge.to === FIDELITY_EXPECTATIONS.proofTarget
        ? {...edge, selector: undefined}
        : edge),
    })).toEqual(['support selector missing']);
    expect(graphIrV2FidelityFailures(structuralCompilation, {
      ...proofCompilation,
      edges: proofCompilation.edges.map((edge) => edge.from === FIDELITY_EXPECTATIONS.proofCriterion && edge.to === FIDELITY_EXPECTATIONS.proofTarget
        ? {...edge, provenance: 'derived' as const}
        : edge),
    })).toEqual(['support provenance missing']);
    expect(graphIrV2FidelityFailures(structuralCompilation, {
      ...proofCompilation,
      edges: proofCompilation.edges.map((edge) => edge.from === FIDELITY_EXPECTATIONS.proofFeature && edge.to === FIDELITY_EXPECTATIONS.prerequisite
        ? {...edge, from: FIDELITY_EXPECTATIONS.prerequisite, to: FIDELITY_EXPECTATIONS.proofFeature}
        : edge),
    })).toEqual(['prerequisite direction missing']);
    expect(graphIrV2FidelityFailures({
      ...structuralCompilation,
      presentations: structuralCompilation.presentations.map((record) => record.address === FIDELITY_EXPECTATIONS.structuralFeature
        ? {...record, purpose: undefined}
        : record),
    }, proofCompilation)).toEqual(['feature purpose missing']);
    expect(graphIrV2FidelityFailures({
      ...structuralCompilation,
      presentations: structuralCompilation.presentations.map((record) => record.address === FIDELITY_EXPECTATIONS.structuralCriterion
        ? {...record, rationale: undefined}
        : record),
    }, proofCompilation)).toEqual(['criterion rationale missing']);
  });

  test('[covers:F-208eaa79/AC-6110ed01] reports environment-labelled cold and warm timings while indexing 5,000 features linearly', () => {
    const selfStart = performance.now();
    const selfCompilation = compileSpecWorkspace(process.cwd());
    const selfKernel = graphIrV2(selfCompilation);
    const coldSelfMs = performance.now() - selfStart;
    const warmStart = performance.now();
    selfKernel.project({
      seeds: ['feature:F-208eaa79'], rules: [{relation: 'contains', direction: 'outbound'}], maxHops: 1, maxNodes: 50, maxEdges: 50,
    });
    const warmProjectionMs = performance.now() - warmStart;
    const count = 5_000;
    const synthetic = syntheticCompilation(count);
    const scaleStart = performance.now();
    const kernel = graphIrV2(synthetic);
    const projection = kernel.project({
      seeds: [`feature:F-${String(count - 1).padStart(8, '0')}`], rules: [{relation: 'depends_on', direction: 'outbound'}], maxHops: 1, maxNodes: 2, maxEdges: 1,
    });
    const scaleMs = performance.now() - scaleStart;
    console.info(`GraphIR v2 benchmark · ${process.platform}/${process.arch} node ${process.version} · cold self compile+kernel ${coldSelfMs.toFixed(1)}ms (reference ≤500ms) · warm focused projection ${warmProjectionMs.toFixed(1)}ms (reference ≤50ms) · synthetic 5000 index+projection ${scaleMs.toFixed(1)}ms`);
    expect(projection.nodes).toHaveLength(2);
    expect(projection.edges).toHaveLength(1);
    expect(kernel.corpusRecords().semanticOwners.filter((record) => record.address.startsWith('feature:'))).toHaveLength(count);
    expect(kernel.corpusRecords().prerequisites).toHaveLength(count - 1);
    expect(scaleMs).toBeLessThan(15_000);
  }, 15_000);
});

function syntheticCompilation(count: number): SpecCompilation {
  const source: SourceLocator = {path: 'spec/features/synthetic.yaml', yamlPath: '$.id', range: {start: 0, end: 0, line: 1, column: 1}};
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const presentations: GraphPresentationRecord[] = [];
  const aliases: SpecCompilation['aliases'][number][] = [];
  for (let index = 0; index < count; index++) {
    const id = `F-${String(index).padStart(8, '0')}`;
    const address = `feature:${id}`;
    nodes.push({address, nodeType: 'semantic', kind: 'feature', provenance: 'authored', source});
    presentations.push({schemaVersion: '0.1', address, kind: 'feature', title: `Synthetic ${index}`, status: 'planned', source});
    aliases.push({alias: id, address, kind: 'feature_id', source});
    if (index > 0) {
      const prerequisite = `feature:F-${String(index - 1).padStart(8, '0')}`;
      edges.push({address: `${address}|depends_on|${prerequisite}|synthetic:${index}`, from: address, to: prerequisite, relation: 'depends_on', provenance: 'authored', owner: source});
    }
  }
  return {schemaVersion: '0.1', nodes, edges, diagnostics: [], presentations, aliases};
}
