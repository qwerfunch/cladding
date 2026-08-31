// Cladding · Spec 0.2 F1 · additive GraphIR v2 schema-0.1 tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';

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

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec compiler GraphIR v2 skeleton', () => {
  test('dispatches schema deterministically and hard-fails unknown versions before child merge', () => {
    const root = workspace('9.9');
    writeFeature(root, 'ignored-aaaaaaaa.yaml', 'id: F-aaaaaaaa\ntitle: ignored\nstatus: planned\n');
    expect(() => compileSpecWorkspace(root)).toThrow(/does not recognize workspace schema/);
  });

  test('is deterministic, preserves composite criteria, and never resolves a bare AC id', () => {
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
});
