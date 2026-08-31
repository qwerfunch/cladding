// Cladding · Spec 0.2 F1 · independent corpus snapshot and parity tests.

import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace, compilerCorpusView} from '../../../src/spec/compiler/compile.js';
import {
  scanIndependentCorpus,
  serializeIndependentCorpusSnapshot,
} from '../../../src/spec/compiler/corpus-snapshot.js';
import {runCorpusSnapshot} from '../../../scripts/spec-0.2-corpus-snapshot.js';

const temporary: string[] = [];

function corpusFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-independent-corpus-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'conformance'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'package.json'), JSON.stringify({scripts: {check: 'vitest run', verify: 'vitest run'}}));
  writeFileSync(join(root, 'conformance', 'fixtures.yaml'), 'fixtures:\n  - name: registered-fixture\n');
  writeFileSync(join(root, 'tests', 'one.test.ts'), 'export {};\n');
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: corpus\n  language: typescript\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'slug: one', 'title: One', 'status: planned', 'modules: [src/one.ts]', 'acceptance_criteria:',
    '  - id: AC-11111111', '    text: The system shall preserve a source record.', '    test_refs: [tests/one.test.ts#one case]', '    oracle_refs: [script:verify, script:missing, script:missing#script-fragment]', '    evidence_refs: [fixture:registered-fixture, fixture:missing-fixture, fixture:missing-fixture#fixture-fragment, self-dogfood:verify, self-dogfood:missing, self-dogfood:missing#self-dogfood-fragment, self-dogfood:stage:commit-postcommit, derived:legacy-proof#derived-fragment]', '',
  ].join('\n'));
  return root;
}

/** A compact reviewed 0.2 corpus with canonical owners and receipt-held proof history. */
function schema02CorpusFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-independent-corpus-02-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'tests', 'one.test.ts'), 'export {};\n');
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: corpus', '  language: typescript',
    '  purpose: Preserve independently scanned source locations.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
    'capabilities:', '  - id: governance', '    title: Governance', '    outcome: Keep source ownership explicit.', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'architecture.yaml'), [
    'layers:', '  - [spec]', '  - [cli]', 'rules:', '  - id: AR-11111111', '    kind: forbidden_import', '    from: spec', '    to: cli', '    rationale: Keep the source layer pure.', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: One', 'status: planned', 'purpose: Preserve source ownership.', 'modules: [src/one.ts]', 'depends_on: []', 'capability_refs: [governance]', 'acceptance_criteria:',
    '  - id: AC-11111111', '    kind: behavior', '    statement: The system shall preserve a source record.', '    oracle_refs: [script:verify]', '    evidence_refs: [tests/one.test.ts]', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'scenarios', 'one-cccccccc.yaml'), [
    'id: S-cccccccc', 'title: One journey', 'actor: contributor', 'goal: preserve an owner', 'success: the source record remains available', 'steps: [read]', 'feature_refs: [F-aaaaaaaa]', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), [
    'schema: 1', 'sourceSchema: "0.1"', 'project:', '  address: project', '  legacyIntent: Preserve independently scanned source locations.', 'features: []', 'criteria:',
    '  - address: criterion:F-aaaaaaaa/AC-11111111', '    legacyIntent:', '      text: The system shall preserve a source record.', '    classification: legacy_unclassified', '    bindings:', '      - channel: test', '        raw: tests/one.test.ts#one case', '      - channel: oracle', '        raw: script:missing', '    exemption:', '      id: legacy-criterion-proof', '      subject: criterion:F-aaaaaaaa/AC-11111111', '      reason: legacy_criterion_intent', 'scenarios: []', '',
  ].join('\n'));
  return root;
}

function workspaceSchema(root: string): string | undefined {
  return /^schema:\s*["']?([^\s"']+)/m.exec(readFileSync(join(root, 'spec.yaml'), 'utf8'))?.[1];
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec 0.2 independent corpus snapshot', () => {
  test('is byte-stable and has no production compiler or loader dependency', () => {
    const first = serializeIndependentCorpusSnapshot(scanIndependentCorpus(process.cwd()));
    const second = serializeIndependentCorpusSnapshot(scanIndependentCorpus(process.cwd()));
    const committed = readFileSync(join(process.cwd(), 'tests', 'spec', 'compiler', 'fixtures', 'self-corpus.snapshot.json'), 'utf8');
    const scannerSource = readFileSync(join(process.cwd(), 'src', 'spec', 'compiler', 'corpus-snapshot.ts'), 'utf8');
    expect(first).toBe(second);
    if (workspaceSchema(process.cwd()) === '0.1') expect(committed).toBe(first);
    expect(scanIndependentCorpus(process.cwd()).records.semanticOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'feature:F-4f4a12c3', owner: 'feature:F-4f4a12c3'}),
      expect.objectContaining({address: 'criterion:F-4f4a12c3/AC-4f4a1204', owner: 'feature:F-4f4a12c3'}),
    ]));
    expect(scannerSource).not.toMatch(/loadSpec|reverse-index|compiler\/compile|compilerCorpusView/);
    expect(runCorpusSnapshot([], process.cwd())).toMatchObject({changed: false, digest: expect.stringMatching(/^[a-f0-9]{64}$/)});
  });

  test('matches additive compiler records while preserving all prerequisite, dependent, artifact-owner, proof, and regression records', () => {
    const snapshot = scanIndependentCorpus(process.cwd());
    const view = compilerCorpusView(compileSpecWorkspace(process.cwd()));
    expect(view).toEqual(snapshot.records);
    expect(snapshot.derived.proofOccurrences).toBe(snapshot.records.proofs.length);
    expect(snapshot.derived.resolvedProofs + snapshot.derived.unresolvedProofs).toBe(snapshot.records.proofs.length);
  });

  test('resolves only registered fixtures and exact package-script pseudo-references', () => {
    const root = corpusFixture();
    const snapshot = scanIndependentCorpus(root);
    expect(snapshot.records.proofs).toEqual(expect.arrayContaining([
      expect.objectContaining({raw: 'fixture:registered-fixture', normalizedTarget: 'anchor:conformance/fixtures.yaml#registered-fixture', resolution: 'resolved'}),
      expect.objectContaining({raw: 'fixture:missing-fixture', normalizedTarget: 'artifact:fixture:missing-fixture', resolution: 'unresolved'}),
      expect.objectContaining({raw: 'fixture:missing-fixture#fixture-fragment', normalizedTarget: 'artifact:fixture:missing-fixture', selector: {precision: 'fragment', value: 'fixture-fragment'}, resolution: 'unresolved'}),
      expect.objectContaining({raw: 'script:verify', normalizedTarget: 'anchor:package.json#scripts.verify', resolution: 'resolved'}),
      expect.objectContaining({raw: 'script:missing', normalizedTarget: 'artifact:script:missing', resolution: 'unresolved'}),
      expect.objectContaining({raw: 'script:missing#script-fragment', normalizedTarget: 'artifact:script:missing', selector: {precision: 'fragment', value: 'script-fragment'}, resolution: 'unresolved'}),
      expect.objectContaining({raw: 'self-dogfood:verify', normalizedTarget: 'anchor:package.json#scripts.verify', resolution: 'resolved'}),
      expect.objectContaining({raw: 'self-dogfood:missing', normalizedTarget: 'artifact:self-dogfood:missing', resolution: 'unresolved'}),
      expect.objectContaining({raw: 'self-dogfood:missing#self-dogfood-fragment', normalizedTarget: 'artifact:self-dogfood:missing', selector: {precision: 'fragment', value: 'self-dogfood-fragment'}, resolution: 'unresolved'}),
      expect.objectContaining({raw: 'self-dogfood:stage:commit-postcommit', normalizedTarget: 'artifact:self-dogfood:stage:commit-postcommit', resolution: 'unresolved'}),
      expect.objectContaining({raw: 'derived:legacy-proof#derived-fragment', normalizedTarget: 'artifact:derived:legacy-proof', selector: {precision: 'fragment', value: 'derived-fragment'}, resolution: 'unresolved'}),
    ]));
    expect(compilerCorpusView(compileSpecWorkspace(root))).toEqual(snapshot.records);
  });

  test('keeps existing local audit and compiler-cache output unresolved while resolving a normal fixture file', () => {
    const root = corpusFixture();
    mkdirSync(join(root, '.cladding', 'audit'), {recursive: true});
    mkdirSync(join(root, '.cladding', 'cache', 'spec-compiler'), {recursive: true});
    writeFileSync(join(root, '.cladding', 'audit', 'local.md'), 'local-only audit output\n');
    writeFileSync(join(root, '.cladding', 'cache', 'spec-compiler', 'graph.json'), '{}\n');
    const shard = join(root, 'spec', 'features', 'one-aaaaaaaa.yaml');
    writeFileSync(shard, readFileSync(shard, 'utf8').replace(
      'test_refs: [tests/one.test.ts#one case]',
      'test_refs: [.cladding/audit/local.md, .cladding/cache/spec-compiler/graph.json, tests/one.test.ts#one case]',
    ));
    expect(scanIndependentCorpus(root).records.proofs).toEqual(expect.arrayContaining([
      expect.objectContaining({raw: '.cladding/audit/local.md', resolution: 'unresolved'}),
      expect.objectContaining({raw: '.cladding/cache/spec-compiler/graph.json', resolution: 'unresolved'}),
      expect.objectContaining({raw: 'tests/one.test.ts#one case', resolution: 'resolved'}),
    ]));
  });

  test('matches the compact committed schema-0.2 migration-proof oracle without compiler-derived expectations', () => {
    const root = schema02CorpusFixture();
    const snapshot = scanIndependentCorpus(root);
    const compilation = compileSpecWorkspace(root);
    const view = compilerCorpusView(compilation);
    const committedMigrationProofs = readFileSync(
      join(process.cwd(), 'tests', 'spec', 'compiler', 'fixtures', 'schema-02-migration-proofs.snapshot.json'),
      'utf8',
    );
    expect(view).toEqual(snapshot.records);
    expect(snapshot.records.semanticOwners).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'project', source: expect.objectContaining({path: 'spec.yaml', yamlPath: '$.project'})}),
      expect.objectContaining({address: 'capability:governance', source: expect.objectContaining({path: 'spec/capabilities.yaml', yamlPath: '$.capabilities[0].id'})}),
      expect.objectContaining({address: 'architecture_rule:AR-11111111', source: expect.objectContaining({path: 'spec/architecture.yaml', yamlPath: '$.rules[0].id'})}),
      expect.objectContaining({address: 'feature:F-aaaaaaaa', source: expect.objectContaining({path: 'spec/features/one-aaaaaaaa.yaml', yamlPath: '$.id'})}),
      expect.objectContaining({address: 'criterion:F-aaaaaaaa/AC-11111111', owner: 'feature:F-aaaaaaaa', source: expect.objectContaining({yamlPath: '$.acceptance_criteria[0].id'})}),
    ]));
    expect(snapshot.records.proofs).toEqual([]);
    expect(`${JSON.stringify(snapshot.migrationProofs, null, 2)}\n`).toBe(committedMigrationProofs);
    expect(compilation.migrationProofs).toEqual(snapshot.migrationProofs);
  });

  test('reports a meaningful source mutation instead of hiding it behind a literal count', () => {
    const root = corpusFixture();
    const before = scanIndependentCorpus(root);
    writeFileSync(join(root, 'spec', 'features', 'one-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'slug: one', 'title: One', 'status: planned', 'modules: [src/one.ts]', 'acceptance_criteria:',
      '  - id: AC-11111111', '    text: The system shall preserve a source record.', '    test_refs: [tests/two.test.ts#two case]', '    oracle_refs: [script:verify, script:missing]', '    evidence_refs: [fixture:registered-fixture, fixture:missing-fixture, self-dogfood:verify, self-dogfood:missing, self-dogfood:stage:commit-postcommit]', '',
    ].join('\n'));
    const after = scanIndependentCorpus(root);
    expect(serializeIndependentCorpusSnapshot(after)).not.toBe(serializeIndependentCorpusSnapshot(before));
    expect(after.records.proofs).toEqual(expect.arrayContaining([
      expect.objectContaining({raw: 'tests/two.test.ts#two case', resolution: 'unresolved', selector: {precision: 'fragment', value: 'two case'}}),
    ]));
  });
});
