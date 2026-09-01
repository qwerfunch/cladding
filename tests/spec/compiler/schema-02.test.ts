// Cladding · Spec 0.2 F2 · additive schema 0.2 compiler boundary tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';

const temporary: string[] = [];

function workspace(schema: string = '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-schema-02-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), `schema: "${schema}"\nproject:\n  name: schema-02\n  language: typescript\n  purpose: Keep strict schema contracts explicit.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\n`);
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [spec]\nrules: []\n');
  return root;
}

function feature(root: string, body: readonly string[]): void {
  writeFileSync(join(root, 'spec', 'features', 'strict-aaaaaaaa.yaml'), `${body.join('\n')}\n`);
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec compiler schema 0.2 structural boundary', () => {
  test('dispatches a schema 0.2 root into feature and criterion structural nodes', () => {
    const root = workspace();
    feature(root, [
      'id: F-aaaaaaaa', 'title: Strict', 'status: planned', 'purpose: Preserve strict authoring.', 'modules: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall preserve a strict statement.',
    ]);
    const compilation = compileSpecWorkspace(root);
    expect(compilation.schemaVersion).toBe('0.2');
    expect(compilation.nodes.map((node) => node.address)).toEqual(expect.arrayContaining(['feature:F-aaaaaaaa', 'criterion:F-aaaaaaaa/AC-bbbbbbbb']));
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('materializes an existing migration receipt artifact even when its body is invalid', () => {
    const root = workspace();
    mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
    writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), '[]\n');
    const compilation = compileSpecWorkspace(root);
    expect(compilation.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: 'artifact:spec/generated/migration-baseline-0.1-to-0.2.yaml',
        nodeType: 'artifact', roles: ['generated'],
      }),
    ]));
    expect(compilation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'INVALID_SCHEMA_02', message: expect.stringContaining('Invalid migration baseline')}),
    ]));
  });

  test('fails an unknown root schema before reading child shards', () => {
    const root = workspace('9.9');
    feature(root, ['id: F-aaaaaaaa', 'title: child must stay unread', 'status: planned', 'purpose: no merge']);
    expect(() => compileSpecWorkspace(root)).toThrow(/does not recognize workspace schema/);
  });

  test('refuses inline schema 0.2 features without treating spec.yaml as a feature shard', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: schema-02', '  language: typescript', '  purpose: Keep strict schema contracts explicit.', '  assurance_level: L2', '  scenario_policy: advisory', 'features:', '  - id: F-aaaaaaaa', '    title: Inline', '    status: planned', '    purpose: Inline records are forbidden.', '    capability_refs: []', '    acceptance_criteria:', '      - id: AC-bbbbbbbb', '        kind: behavior', '        statement: The system shall reject inline features.', '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', message: expect.stringContaining('feature shards')}),
    ]));
    expect(compilation.nodes.map((node) => node.address)).not.toContain('feature:F-aaaaaaaa');
  });

  test('refuses child schema declarations and mixed schema 0.1 criterion spellings', () => {
    const root = workspace();
    feature(root, [
      'schema: "0.1"', 'id: F-aaaaaaaa', 'slug: strict', 'title: Strict', 'status: planned', 'purpose: Preserve strict authoring.', 'modules: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall preserve a strict statement.', '    ears: ubiquitous', '    text: The system shall preserve legacy text.', '    test_refs: [tests/legacy.test.ts]',
    ]);
    const codes = compileSpecWorkspace(root).diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toEqual(expect.arrayContaining(['LEGACY_FIELD']));
  });

  test('uses the schema 0.2 shard filename as slug authority, including direct legacy fallback', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec', 'features', 'filename-authoritative-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'slug: body-must-not-win', 'title: Filename authority', 'status: planned', 'purpose: Keep the shard name authoritative.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    const compilation = compileSpecWorkspace(root);
    const feature = compilation.presentations.find((record) => record.address === 'feature:F-aaaaaaaa');
    const slugAlias = compilation.aliases.find((record) => record.address === 'feature:F-aaaaaaaa' && record.kind === 'feature_slug');
    expect(feature).toMatchObject({slug: 'filename-authoritative', source: {path: 'spec/features/filename-authoritative-aaaaaaaa.yaml', yamlPath: '$'}});
    expect(slugAlias).toMatchObject({alias: 'filename-authoritative', source: {path: 'spec/features/filename-authoritative-aaaaaaaa.yaml', yamlPath: '$'}});
    expect(compilation.aliases.some((record) => record.alias === 'body-must-not-win')).toBe(false);

    const legacyRoot = workspace();
    writeFileSync(join(legacyRoot, 'spec', 'features', 'F-001.yaml'), [
      'id: F-001', 'title: Direct fallback', 'status: planned', 'purpose: Preserve a readable direct shard.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    expect(compileSpecWorkspace(legacyRoot).presentations.find((record) => record.address === 'feature:F-001')).toMatchObject({slug: 'F-001'});
  });

  test('blocks duplicate schema 0.2 feature and criterion identifiers without multiplying first facts', () => {
    const featureRoot = workspace();
    writeFileSync(join(featureRoot, 'spec', 'features', 'first-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'title: First', 'status: planned', 'purpose: Retain the first feature fact.', 'modules: [src/first.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    writeFileSync(join(featureRoot, 'spec', 'features', 'second-bbbbbbbb.yaml'), [
      'id: F-aaaaaaaa', 'title: Duplicate', 'status: planned', 'purpose: This duplicate cannot rewrite the first fact.', 'modules: [src/second.ts]', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    const duplicateFeature = compileSpecWorkspace(featureRoot);
    expect(duplicateFeature.diagnostics.filter((diagnostic) => diagnostic.code === 'DUPLICATE_IDENTIFIER')).toEqual([
      expect.objectContaining({message: 'duplicate feature id F-aaaaaaaa', source: expect.objectContaining({path: 'spec/features/second-bbbbbbbb.yaml', yamlPath: '$.id'})}),
    ]);
    expect(duplicateFeature.nodes.find((node) => node.address === 'feature:F-aaaaaaaa')).toMatchObject({source: {path: 'spec/features/first-aaaaaaaa.yaml'}});
    expect(duplicateFeature.presentations.filter((record) => record.address === 'feature:F-aaaaaaaa')).toHaveLength(1);
    expect(duplicateFeature.aliases.filter((record) => record.address === 'feature:F-aaaaaaaa')).toHaveLength(2);
    expect(duplicateFeature.edges.some((edge) => edge.to === 'artifact:src/second.ts')).toBe(false);
    expect(duplicateFeature.contract).toBeUndefined();

    const criterionRoot = workspace();
    writeFileSync(join(criterionRoot, 'spec', 'features', 'criteria-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'title: Criteria', 'status: planned', 'purpose: Retain the first criterion fact.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall retain the first criterion.',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall not overwrite the first criterion.', '',
    ].join('\n'));
    const duplicateCriterion = compileSpecWorkspace(criterionRoot);
    expect(duplicateCriterion.diagnostics.filter((diagnostic) => diagnostic.code === 'DUPLICATE_IDENTIFIER')).toEqual([
      expect.objectContaining({message: 'duplicate criterion id AC-bbbbbbbb', source: expect.objectContaining({path: 'spec/features/criteria-aaaaaaaa.yaml', yamlPath: '$.acceptance_criteria[1].id'})}),
    ]);
    expect(duplicateCriterion.nodes.find((node) => node.address === 'criterion:F-aaaaaaaa/AC-bbbbbbbb')).toMatchObject({source: {yamlPath: '$.acceptance_criteria[0].id'}});
    expect(duplicateCriterion.presentations.filter((record) => record.address === 'criterion:F-aaaaaaaa/AC-bbbbbbbb')).toHaveLength(1);
    expect(duplicateCriterion.edges.filter((edge) => edge.from === 'feature:F-aaaaaaaa' && edge.relation === 'contains')).toHaveLength(1);
    expect(duplicateCriterion.contract).toBeUndefined();
  });

  test('reports genuine atomicity risk and leaves a long valid control nonblocking', () => {
    const root = workspace();
    feature(root, [
      'id: F-aaaaaaaa', 'title: Strict', 'status: planned', 'purpose: Preserve strict authoring.', 'modules: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: When an order completes, the system shall persist the receipt, notify the customer, and emit an audit event.',
      '  - id: AC-cccccccc', '    kind: quality', '    statement: The system shall preserve a durable operational narrative whose purpose is to retain one indivisible record for a reviewer by describing a detailed context in a single continuous expression that remains deliberately long enough to exercise advisory length analysis without introducing any second obligation or any independently actionable predicate whatsoever.',
    ]);
    const diagnostics = compileSpecWorkspace(root).diagnostics;
    expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({code: 'ATOMICITY_RISK', severity: 'advisory'})]));
    expect(diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });
});
