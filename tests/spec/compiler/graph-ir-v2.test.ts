// Cladding · Spec 0.2 F1 · additive GraphIR v2 schema-0.1 tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';
import {graphIrV2} from '../../../src/spec/compiler/graph-ir-v2.js';

const temporary: string[] = [];

function workspace(schema: string = '0.1'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-spec-compiler-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'conformance'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {verify: 'vitest run'}}));
  writeFileSync(join(root, 'spec.yaml'), `schema: \"${schema}\"\nproject:\n  name: compiler-fixture\n  language: typescript\nfeatures: []\nscenarios: []\n`);
  return root;
}

function writeFeature(root: string, name: string, body: string): void {
  writeFileSync(join(root, 'spec', 'features', name), body);
}

function schema02Workspace(): string {
  const root = workspace('0.2');
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: compiler-fixture', '  language: typescript',
    '  purpose: Preserve exact authored proof declarations.', '  assurance_level: L2', '  scenario_policy: advisory',
    'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [spec]\nrules: []\n');
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec compiler GraphIR v2 skeleton', () => {
  test('dispatches schema deterministically and hard-fails unknown versions before child merge', () => {
    const root = workspace('9.9');
    writeFeature(root, 'ignored-aaaaaaaa.yaml', 'id: F-aaaaaaaa\ntitle: ignored\nstatus: planned\n');
    expect(() => compileSpecWorkspace(root)).toThrow(/does not recognize workspace schema/);
  });

  test('[covers:F-182eaa53/AC-6e5b88fa] is deterministic, preserves composite criteria, and never resolves a bare AC id', () => {
    const root = workspace();
    writeFeature(root, 'alpha-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned', 'modules: []', 'acceptance_criteria:',
      '  - id: AC-deadbeef', '    ears: ubiquitous', '    text: The system shall preserve alpha.', '',
    ].join('\n'));
    writeFeature(root, 'beta-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'slug: beta', 'title: Beta', 'status: planned', 'depends_on: [F-aaaaaaaa]', 'modules: []', 'acceptance_criteria:',
      '  - id: AC-deadbeef', '    ears: ubiquitous', '    text: The system shall preserve beta.', '',
    ].join('\n'));
    const first = compileSpecWorkspace(root);
    const second = compileSpecWorkspace(root);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.nodes.map((node) => node.address)).toContain('criterion:F-aaaaaaaa/AC-deadbeef');
    expect(first.nodes.map((node) => node.address)).toContain('criterion:F-bbbbbbbb/AC-deadbeef');
    expect(first.nodes.map((node) => node.address)).not.toContain('criterion:AC-deadbeef');
    expect(first.edges.some((edge) => edge.from === 'project' && edge.relation === 'contains')).toBe(false);
    expect(first.edges.some((edge) => edge.from === 'feature:F-bbbbbbbb' && edge.to === 'feature:F-aaaaaaaa' && edge.relation === 'depends_on')).toBe(true);
  });

  test('retains one multi-role artifact node and every feature owner', () => {
    const root = workspace();
    writeFileSync(join(root, 'src', 'shared.ts'), 'export const shared = true;\n');
    writeFeature(root, 'alpha-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned', 'modules: [src/shared.ts]', 'acceptance_criteria:',
      '  - id: AC-11111111', '    text: The system shall share a file.', '    test_refs: [src/shared.ts#shared behavior]', '',
    ].join('\n'));
    writeFeature(root, 'beta-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'slug: beta', 'title: Beta', 'status: planned', 'modules: [src/shared.ts]', 'acceptance_criteria: []', '',
    ].join('\n'));
    const graph = compileSpecWorkspace(root);
    const shared = graph.nodes.find((node) => node.address === 'artifact:src/shared.ts');
    expect(shared).toMatchObject({nodeType: 'artifact', roles: ['source', 'test'], owners: ['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb']});
  });

  test('preserves raw references, selector precision, channels, and unresolved pseudo-references without aliases', () => {
    const root = workspace();
    writeFileSync(join(root, 'tests', 'unit.test.ts'), 'export {};\n');
    writeFileSync(join(root, 'conformance', 'fixtures.yaml'), 'fixtures:\n  - name: registered-fixture\n');
    writeFeature(root, 'refs-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'slug: refs', 'title: References', 'status: planned', 'modules: []', 'acceptance_criteria:',
      '  - id: AC-11111111', '    text: The system shall retain references.', '    test_refs: [tests/unit.test.ts#named case]', '    oracle_refs: [script:verify, script:missing, script:missing#script-fragment]', '    evidence_refs: [fixture:registered-fixture, fixture:missing-fixture, fixture:missing-fixture#fixture-fragment, self-dogfood:verify, self-dogfood:missing, self-dogfood:missing#self-dogfood-fragment, self-dogfood:stage:commit-postcommit, derived:legacy-proof#derived-fragment]', '',
    ].join('\n'));
    const graph = compileSpecWorkspace(root);
    const supports = graph.edges.filter((edge) => edge.relation === 'supports');
    expect(graph.schemaVersion).toBe('0.1');
    expect(supports).toHaveLength(12);
    expect(supports).toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'test', raw: 'tests/unit.test.ts#named case', normalizedTarget: 'anchor:tests/unit.test.ts#named case', selector: {precision: 'fragment', value: 'named case'}, state: 'resolved'}),
      expect.objectContaining({channel: 'oracle', raw: 'script:verify', normalizedTarget: 'anchor:package.json#scripts.verify', selector: {precision: 'none'}, state: 'resolved'}),
      expect.objectContaining({channel: 'oracle', raw: 'script:missing', normalizedTarget: 'artifact:script:missing', selector: {precision: 'none'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'oracle', raw: 'script:missing#script-fragment', normalizedTarget: 'artifact:script:missing', selector: {precision: 'fragment', value: 'script-fragment'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'fixture:registered-fixture', normalizedTarget: 'anchor:conformance/fixtures.yaml#registered-fixture', selector: {precision: 'none'}, state: 'resolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'fixture:missing-fixture', normalizedTarget: 'artifact:fixture:missing-fixture', selector: {precision: 'none'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'fixture:missing-fixture#fixture-fragment', normalizedTarget: 'artifact:fixture:missing-fixture', selector: {precision: 'fragment', value: 'fixture-fragment'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'self-dogfood:verify', normalizedTarget: 'anchor:package.json#scripts.verify', selector: {precision: 'none'}, state: 'resolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'self-dogfood:missing', normalizedTarget: 'artifact:self-dogfood:missing', selector: {precision: 'none'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'self-dogfood:missing#self-dogfood-fragment', normalizedTarget: 'artifact:self-dogfood:missing', selector: {precision: 'fragment', value: 'self-dogfood-fragment'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'self-dogfood:stage:commit-postcommit', normalizedTarget: 'artifact:self-dogfood:stage:commit-postcommit', selector: {precision: 'none'}, state: 'unresolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'derived:legacy-proof#derived-fragment', normalizedTarget: 'artifact:derived:legacy-proof', selector: {precision: 'fragment', value: 'derived-fragment'}, state: 'unresolved'}),
    ]));
    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'anchor:tests/unit.test.ts#named case', nodeType: 'anchor', selector: 'named case', selectorProvenance: 'authored'}),
      expect.objectContaining({address: 'anchor:conformance/fixtures.yaml#registered-fixture', nodeType: 'anchor', selector: 'registered-fixture', selectorProvenance: 'derived'}),
      expect.objectContaining({address: 'anchor:package.json#scripts.verify', nodeType: 'anchor', selector: 'scripts.verify', selectorProvenance: 'derived'}),
    ]));
    const pseudoReferences = supports.filter((edge) => /^(?:fixture|script|self-dogfood|derived):/.test(edge.raw ?? ''));
    expect(pseudoReferences.every((edge) => graph.nodes.some((node) => node.address === edge.to))).toBe(true);
    expect(supports.some((edge) => edge.raw === 'self-dogfood:stage:commit-postcommit' && edge.to !== 'artifact:self-dogfood:stage:commit-postcommit')).toBe(false);
  });

  test('does not harvest source comments or fabricate observed proof, covers, or verification', () => {
    const root = workspace();
    writeFileSync(join(root, 'src', 'commented.ts'), '// [covers:F-aaaaaaaa/AC-11111111]\n');
    writeFeature(root, 'alpha-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'slug: alpha', 'title: Alpha', 'status: planned', 'modules: [src/commented.ts]', 'acceptance_criteria:',
      '  - id: AC-11111111', '    text: The system shall avoid unearned proof.', '',
    ].join('\n'));
    const graph = compileSpecWorkspace(root);
    expect(graph.edges.some((edge) => edge.relation === 'covers')).toBe(false);
    expect(graph.edges.some((edge) => edge.provenance === 'observed')).toBe(false);
    expect(graph.edges.some((edge) => edge.state === 'passed' || edge.state === 'failed')).toBe(false);
  });

  test('leaves local audit and compiler-cache output unresolved even when files exist while resolving a normal repository file', () => {
    const root = workspace();
    mkdirSync(join(root, '.cladding', 'audit'), {recursive: true});
    mkdirSync(join(root, '.cladding', 'cache', 'spec-compiler'), {recursive: true});
    writeFileSync(join(root, '.cladding', 'audit', 'local.md'), 'local-only audit output\n');
    writeFileSync(join(root, '.cladding', 'cache', 'spec-compiler', 'graph.json'), '{}\n');
    writeFileSync(join(root, 'tests', 'portable.test.ts'), 'export {};\n');
    writeFeature(root, 'audit-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'slug: audit', 'title: Audit', 'status: planned', 'modules: []', 'acceptance_criteria:',
      '  - id: AC-11111111', '    text: The system shall keep workspace output local.', '    test_refs: [.cladding/audit/local.md, .cladding/cache/spec-compiler/graph.json, tests/portable.test.ts]', '',
    ].join('\n'));
    const supports = compileSpecWorkspace(root).edges.filter((edge) => edge.relation === 'supports');
    expect(supports).toEqual(expect.arrayContaining([
      expect.objectContaining({raw: '.cladding/audit/local.md', state: 'unresolved'}),
      expect.objectContaining({raw: '.cladding/cache/spec-compiler/graph.json', state: 'unresolved'}),
      expect.objectContaining({raw: 'tests/portable.test.ts', state: 'resolved'}),
    ]));
  });

  test('materializes schema 0.2 oracle and evidence facts for every criterion kind without observation', () => {
    const root = schema02Workspace();
    const source = 'spec/features/proofs-aaaaaaaa.yaml';
    mkdirSync(join(root, 'src'), {recursive: true});
    writeFileSync(join(root, 'src', 'shared.ts'), 'export const shared = true;\n');
    writeFileSync(join(root, 'tests', 'resolved-oracle.test.ts'), 'export {};\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), [
      'layers:', '  - [spec]', 'rules:',
      '  - id: AR-11111111', '    kind: forbidden_import', '    from: spec', '    to: cli',
      '    rationale: Preserve the explicit constraint proof declaration.', '',
    ].join('\n'));
    const featureSource = [
      'id: F-aaaaaaaa', 'title: Proofs', 'status: planned',
      'purpose: Preserve structural proof declarations.', 'modules: [src/shared.ts]',
      'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-11111111', '    kind: behavior',
      '    statement: The system shall retain an authored behavior proof.',
      '    oracle_refs: [src/shared.ts#behavior oracle]',
      '    evidence_refs: [tests/missing-evidence.test.ts]',
      '  - id: AC-22222222', '    kind: quality',
      '    statement: The system shall retain an authored quality proof.',
      '    oracle_refs: [tests/resolved-oracle.test.ts]',
      '    evidence_refs: [src/shared.ts#quality evidence]',
      '  - id: AC-33333333', '    kind: constraint',
      '    statement: The system shall retain an authored constraint proof.',
      '    rationale: The structural proof remains independently inspectable.',
      '    constraint_refs: [AR-11111111]',
      '    oracle_refs: [tests/missing-oracle.test.ts#constraint oracle]',
      '    evidence_refs: [src/shared.ts]', '',
    ].join('\n');
    writeFeature(root, 'proofs-aaaaaaaa.yaml', featureSource);

    const compilation = compileSpecWorkspace(root);
    const supports = compilation.edges.filter((edge) => edge.relation === 'supports');
    expect(supports).toHaveLength(6);
    expect(supports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-11111111', to: 'anchor:src/shared.ts#behavior oracle',
        channel: 'oracle', raw: 'src/shared.ts#behavior oracle',
        normalizedTarget: 'anchor:src/shared.ts#behavior oracle',
        selector: {precision: 'fragment', value: 'behavior oracle'}, state: 'resolved',
        provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[0].oracle_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-11111111', to: 'artifact:tests/missing-evidence.test.ts',
        channel: 'evidence', raw: 'tests/missing-evidence.test.ts',
        normalizedTarget: 'artifact:tests/missing-evidence.test.ts', selector: {precision: 'none'},
        state: 'unresolved', provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[0].evidence_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-22222222', to: 'artifact:tests/resolved-oracle.test.ts',
        channel: 'oracle', raw: 'tests/resolved-oracle.test.ts',
        normalizedTarget: 'artifact:tests/resolved-oracle.test.ts', selector: {precision: 'none'},
        state: 'resolved', provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[1].oracle_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-22222222', to: 'anchor:src/shared.ts#quality evidence',
        channel: 'evidence', raw: 'src/shared.ts#quality evidence',
        normalizedTarget: 'anchor:src/shared.ts#quality evidence',
        selector: {precision: 'fragment', value: 'quality evidence'}, state: 'resolved',
        provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[1].evidence_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-33333333', to: 'anchor:tests/missing-oracle.test.ts#constraint oracle',
        channel: 'oracle', raw: 'tests/missing-oracle.test.ts#constraint oracle',
        normalizedTarget: 'anchor:tests/missing-oracle.test.ts#constraint oracle',
        selector: {precision: 'fragment', value: 'constraint oracle'}, state: 'unresolved',
        provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[2].oracle_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'criterion:F-aaaaaaaa/AC-33333333', to: 'artifact:src/shared.ts',
        channel: 'evidence', raw: 'src/shared.ts', normalizedTarget: 'artifact:src/shared.ts',
        selector: {precision: 'none'}, state: 'resolved', provenance: 'authored',
        owner: expect.objectContaining({path: source, yamlPath: '$.acceptance_criteria[2].evidence_refs[0]'}),
      }),
    ]));
    expect(compilation.nodes.find((node) => node.address === 'artifact:src/shared.ts')).toMatchObject({
      nodeType: 'artifact', roles: ['evidence', 'oracle', 'source'], owners: ['feature:F-aaaaaaaa'],
    });
    expect(compilation.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: 'anchor:src/shared.ts#behavior oracle', nodeType: 'anchor', artifact: 'artifact:src/shared.ts',
        selector: 'behavior oracle', selectorProvenance: 'authored', provenance: 'authored',
      }),
      expect.objectContaining({
        address: 'anchor:src/shared.ts#quality evidence', nodeType: 'anchor', artifact: 'artifact:src/shared.ts',
        selector: 'quality evidence', selectorProvenance: 'authored', provenance: 'authored',
      }),
      expect.objectContaining({
        address: 'anchor:tests/missing-oracle.test.ts#constraint oracle', nodeType: 'anchor',
        artifact: 'artifact:tests/missing-oracle.test.ts', selector: 'constraint oracle',
        selectorProvenance: 'authored', provenance: 'authored',
      }),
    ]));
    expect(supports.some((edge) => edge.state === 'passed' || edge.state === 'failed' || edge.provenance === 'observed')).toBe(false);

    const proofQuery = graphIrV2(compilation).criterionProofs('criterion:F-aaaaaaaa/AC-11111111');
    expect(proofQuery.records).toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'oracle', raw: 'src/shared.ts#behavior oracle', provenance: 'authored', state: 'resolved'}),
      expect.objectContaining({channel: 'evidence', raw: 'tests/missing-evidence.test.ts', provenance: 'authored', state: 'unresolved'}),
    ]));
    expect(proofQuery.completeness).toBe('unknown');
    expect(proofQuery.reasons).toContain('criterion has authored proof declarations but no observed proof fact: criterion:F-aaaaaaaa/AC-11111111');

    for (const [declaration, channel] of [
      ['    oracle_refs: [src/shared.ts#behavior oracle]', 'oracle'],
      ['    evidence_refs: [tests/missing-evidence.test.ts]', 'evidence'],
    ] as const) {
      writeFeature(root, 'proofs-aaaaaaaa.yaml', featureSource.replace(declaration, ''));
      const ablated = compileSpecWorkspace(root).edges.filter((edge) => edge.relation === 'supports');
      expect(ablated).toHaveLength(supports.length - 1);
      expect(ablated.some((edge) => edge.raw === (channel === 'oracle'
        ? 'src/shared.ts#behavior oracle'
        : 'tests/missing-evidence.test.ts'))).toBe(false);
    }
  });

  test('keeps schema 0.2 receipt-held test history separate from baseline-backed authored proof declarations', () => {
    const root = schema02Workspace();
    mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
    writeFileSync(join(root, 'tests', 'baseline-oracle.test.ts'), 'export {};\n');
    writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify({
      schema: 1,
      sourceSchema: '0.1',
      project: {address: 'project', legacyIntent: 'Preserve exact authored proof declarations.'},
      features: [],
      criteria: [{
        address: 'criterion:F-bbbbbbbb/AC-11111111',
        legacyIntent: {text: 'The system shall retain a baseline-backed proof declaration.'},
        classification: 'legacy_unclassified',
        bindings: [{channel: 'test', raw: 'tests/historic.test.ts#historic case'}],
        exemption: {
          id: 'legacy-criterion-proof', subject: 'criterion:F-bbbbbbbb/AC-11111111', reason: 'legacy_criterion_intent',
        },
      }],
      scenarios: [],
    }));
    writeFeature(root, 'baseline-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'title: Baseline proof', 'status: planned',
      'purpose: Retain valid migration exemptions without making observations.',
      'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-11111111', '    statement: The system shall retain a baseline-backed proof declaration.',
      '    oracle_refs: [tests/baseline-oracle.test.ts]',
      '    evidence_refs: [tests/missing-baseline-evidence.test.ts#review]', '',
    ].join('\n'));

    const compilation = compileSpecWorkspace(root);
    const supports = compilation.edges.filter((edge) => edge.from === 'criterion:F-bbbbbbbb/AC-11111111' && edge.relation === 'supports');
    expect(supports).toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'oracle', raw: 'tests/baseline-oracle.test.ts', state: 'resolved'}),
      expect.objectContaining({
        channel: 'evidence', raw: 'tests/missing-baseline-evidence.test.ts#review',
        normalizedTarget: 'anchor:tests/missing-baseline-evidence.test.ts#review',
        selector: {precision: 'fragment', value: 'review'}, state: 'unresolved',
      }),
    ]));
    expect(supports.some((edge) => edge.channel === 'test')).toBe(false);
    expect(compilation.migrationProofs).toEqual(expect.arrayContaining([
      expect.objectContaining({channel: 'test', raw: 'tests/historic.test.ts#historic case'}),
    ]));
    expect(compilation.migrationProofs?.some((proof) => proof.raw === 'tests/baseline-oracle.test.ts')).toBe(false);
  });

  test('continues to reject inline schema 0.2 test references without materializing them', () => {
    const root = schema02Workspace();
    writeFeature(root, 'legacy-aaaaaaaa.yaml', [
      'id: F-aaaaaaaa', 'title: Legacy field', 'status: planned',
      'purpose: Keep schema-specific proof channels explicit.',
      'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-11111111', '    kind: behavior',
      '    statement: The system shall reject an inline test reference.',
      '    test_refs: [tests/legacy.test.ts#case]', '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'LEGACY_FIELD', source: expect.objectContaining({yamlPath: '$.acceptance_criteria[0].test_refs'})}),
    ]));
    expect(compilation.edges.some((edge) => edge.channel === 'test')).toBe(false);
  });
});
