// Cladding · Spec 0.2 F2 · canonical read-only migration-preview tests.

import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {previewSchema02Migration, serializeMigrationPreview} from '../../../src/spec/compiler/migration-preview.js';
import {remainingLegacyExemptions, validateMigrationBaseline} from '../../../src/spec/compiler/migration-baseline.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-migration-preview-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  writeFileSync(join(root, 'tests', 'migration.test.ts'), 'export {};\n');
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"', 'project:', '  name: migration-preview', '  language: typescript', '  intent_summary: "Keep authored source faithful."', 'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
    'schema: "0.1"', 'source: spec.yaml', 'capabilities:', '  - id: migration', '    title: Migration', '    summary: "Preview a careful schema transition."', '    features: [F-aaaaaaaa]', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'slug: migration', 'title: Migration preview', 'status: planned', 'modules: []', 'acceptance_criteria:',
    '  - id: AC-bbbbbbbb', '    ears: event', '    condition: when a different event occurs', '    action: an unrelated action happens', '    response: a stale legacy response', '    text: "When a user saves, the system shall retain the draft exactly."', '    test_refs: [tests/migration.test.ts#keeps raw selector]', '',
  ].join('\n'));
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

function workspaceManifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return [{path: `${path.slice(root.length + 1)}/`, bytes: '<directory>'}, ...workspaceManifest(root, path)];
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

describe('Spec compiler migration preview', () => {
  test('copies authored text and raw selectors without inferring schema 0.2 meaning', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(feature, `${readFileSync(feature, 'utf8')}  - id: AC-cccccccc\n    text: "The system shall preserve a sibling record."\n`);
    const preview = previewSchema02Migration(root);
    const criterion = preview.criteria.find((entry) => entry.address === 'criterion:F-aaaaaaaa/AC-bbbbbbbb');
    expect(preview.project).toEqual({purpose: 'Keep authored source faithful.', status: 'proposed', assuranceLevel: 'L2', scenarioPolicy: 'advisory'});
    expect(preview.capabilities).toEqual([{id: 'migration', title: 'Migration', outcome: 'Preview a careful schema transition.', status: 'proposed'}]);
    expect(criterion).toMatchObject({
      statement: 'When a user saves, the system shall retain the draft exactly.',
      scan: {status: 'parsed'}, kind: 'legacy_exempt',
      legacyBindings: [{channel: 'test', raw: 'tests/migration.test.ts#keeps raw selector', selector: 'keeps raw selector'}],
      reviewedTestCandidates: [expect.objectContaining({
        raw: 'tests/migration.test.ts#keeps raw selector', file: 'tests/migration.test.ts', selector: 'keeps raw selector',
        state: 'available', sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      })],
    });
    expect(preview.features).toEqual([expect.objectContaining({address: 'feature:F-aaaaaaaa', purpose: 'legacy_exempt', capabilityRefs: ['migration']})]);
    expect(preview.identityProof).toEqual({
      features: {source: ['F-aaaaaaaa'], candidate: ['F-aaaaaaaa']},
      criteria: {source: ['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc'], candidate: ['F-aaaaaaaa/AC-bbbbbbbb', 'F-aaaaaaaa/AC-cccccccc']},
      scenarios: {source: [], candidate: []},
    });
    expect(preview.baseline.project).toEqual({address: 'project', legacyIntent: 'Keep authored source faithful.'});
    expect(preview.baseline.features).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'feature:F-aaaaaaaa', title: 'Migration preview', exemption: expect.objectContaining({reason: 'missing_feature_purpose'})}),
    ]));
    expect(preview.baseline.criteria).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', classification: 'legacy_unclassified',
        legacyIntent: {
          ears: 'event', condition: 'when a different event occurs', action: 'an unrelated action happens',
          response: 'a stale legacy response', text: 'When a user saves, the system shall retain the draft exactly.',
        },
        bindings: [{channel: 'test', raw: 'tests/migration.test.ts#keeps raw selector', selector: 'keeps raw selector'}],
        exemption: expect.objectContaining({reason: 'legacy_criterion_intent'}),
      }),
    ]));
    expect(preview.requiredResolution.map((item) => item.code)).toEqual(expect.arrayContaining([
      'PROJECT_PURPOSE_CONFIRMATION', 'CAPABILITY_OUTCOME_CONFIRMATION',
    ]));
    expect(preview.requiredResolution.map((item) => item.code)).not.toEqual(expect.arrayContaining([
      'FEATURE_PURPOSE_REQUIRED', 'CRITERION_KIND_REQUIRED', 'CAPABILITY_EDGES_UNRESOLVED', 'CRITERION_STATEMENT_OPAQUE',
    ]));
    expect(validateMigrationBaseline(preview.baseline)).toEqual([]);
    const remaining = remainingLegacyExemptions(preview.baseline, [{
      subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', fields: ['criterion.statement'],
    }]).map((exemption) => exemption.subject);
    expect(remaining).toEqual(expect.arrayContaining([
      'feature:F-aaaaaaaa', 'criterion:F-aaaaaaaa/AC-cccccccc',
    ]));
    expect(remaining).not.toContain('criterion:F-aaaaaaaa/AC-bbbbbbbb');
  });

  test('binds whole historic test-file bytes into the deterministic reviewed preview', () => {
    const root = workspace();
    const before = previewSchema02Migration(root);
    writeFileSync(join(root, 'tests', 'migration.test.ts'), 'export const changed = true;\n');
    const after = previewSchema02Migration(root);
    const beforeCandidate = before.criteria[0]!.reviewedTestCandidates[0]!;
    const afterCandidate = after.criteria[0]!.reviewedTestCandidates[0]!;
    expect(afterCandidate.sha256).not.toBe(beforeCandidate.sha256);
    expect(serializeMigrationPreview(after)).not.toBe(serializeMigrationPreview(before));
  });

  test('is deterministic and writes zero bytes', () => {
    const root = workspace();
    const before = workspaceManifest(root);
    const first = serializeMigrationPreview(previewSchema02Migration(root));
    const second = serializeMigrationPreview(previewSchema02Migration(root));
    const after = workspaceManifest(root);
    expect(first).toBe(second);
    expect(after).toEqual(before);
  });

  test('binds the reviewed preview to every raw legacy source byte', () => {
    const root = workspace();
    const first = previewSchema02Migration(root);
    expect(first.sourceManifest.map((entry) => entry.path)).toEqual(expect.arrayContaining(['spec.yaml', 'spec/capabilities.yaml', 'spec/features/migration-aaaaaaaa.yaml']));
    writeFileSync(join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml'), `${readFileSync(join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml'), 'utf8')}notes: newly reviewed source byte\n`);
    const second = previewSchema02Migration(root);
    expect(second.sourceDigest).not.toBe(first.sourceDigest);
  });

  test('binds the reviewed preview to the sorted inventory test-file set', () => {
    const root = workspace();
    const first = previewSchema02Migration(root);
    expect(first.testFileCount).toBe(1);
    writeFileSync(join(root, 'tests', 'late-added.test.ts'), 'export {};\n');
    const second = previewSchema02Migration(root);
    expect(second.testFileCount).toBe(2);
    expect(second.testFileSetDigest).not.toBe(first.testFileSetDigest);
  });

  test('censuses only criteria from source features whose status is exactly done', () => {
    const root = workspace();
    const first = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(first, readFileSync(first, 'utf8').replace('status: planned', 'status: done'));
    for (const [id, status] of [
      ['F-bbbbbbbb', 'planned'], ['F-cccccccc', 'in_progress'], ['F-dddddddd', 'blocked'], ['F-eeeeeeee', 'archived'],
    ] as const) {
      writeFileSync(join(root, 'spec', 'features', `legacy-${id.slice(2)}.yaml`), [
        `id: ${id}`, `title: ${status}`, `status: ${status}`, 'modules: []', 'acceptance_criteria:', `  - id: AC-${id.slice(2)}`, '    text: The system shall preserve the source census.', '',
      ].join('\n'));
    }
    const preview = previewSchema02Migration(root);
    const criteria = ['criterion:F-aaaaaaaa/AC-bbbbbbbb'];
    const expectedDigest = createHash('sha256').update(JSON.stringify({
      criteria,
      domain: 'cladding.migration-l2-candidate-census/1',
    })).digest('hex');
    expect(preview.legacyL2Baseline).toEqual({candidateCount: 1, candidateCensusSha256: expectedDigest});
    expect(preview.requiredResolution).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'PROJECT_LEGACY_L2_BASELINE', subject: 'project'}),
    ]));
  });

  test('fails closed when a legacy shard filename cannot prove its body identity', () => {
    const root = workspace();
    const original = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    const mismatched = join(root, 'spec', 'features', 'migration-bbbbbbbb.yaml');
    writeFileSync(mismatched, readFileSync(original, 'utf8'));
    rmSync(original);
    expect(() => previewSchema02Migration(root)).toThrow('filename/body identity');
  });

  test('retains direct sequential/direct six-hex and slugged eight-hex legacy shard identities', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(join(root, 'spec', 'features', 'F-001.yaml'), readFileSync(feature, 'utf8').replaceAll('F-aaaaaaaa', 'F-001'));
    rmSync(feature);
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), readFileSync(join(root, 'spec', 'capabilities.yaml'), 'utf8').replace('F-aaaaaaaa', 'F-001'));
    const sequential = previewSchema02Migration(root);
    expect(sequential.features[0]).toMatchObject({address: 'feature:F-001', path: 'spec/features/F-001.yaml'});
    const direct = join(root, 'spec', 'features', 'F-001.yaml');
    writeFileSync(join(root, 'spec', 'features', 'F-aaaaaa.yaml'), readFileSync(direct, 'utf8').replaceAll('F-001', 'F-aaaaaa'));
    rmSync(direct);
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), readFileSync(join(root, 'spec', 'capabilities.yaml'), 'utf8').replace('F-001', 'F-aaaaaa'));
    const directHex = previewSchema02Migration(root);
    expect(directHex.features[0]).toMatchObject({address: 'feature:F-aaaaaa', path: 'spec/features/F-aaaaaa.yaml'});
    writeFileSync(join(root, 'spec', 'features', 'legacy-aaaaaa.yaml'), readFileSync(join(root, 'spec', 'features', 'F-aaaaaa.yaml'), 'utf8'));
    rmSync(join(root, 'spec', 'features', 'F-aaaaaa.yaml'));
    const sluggedSix = previewSchema02Migration(root);
    expect(sluggedSix.features[0]).toMatchObject({address: 'feature:F-aaaaaa', path: 'spec/features/legacy-aaaaaa.yaml'});
    writeFileSync(join(root, 'spec', 'features', 'legacy-aaaaaaaa.yaml'), readFileSync(join(root, 'spec', 'features', 'legacy-aaaaaa.yaml'), 'utf8').replaceAll('F-aaaaaa', 'F-aaaaaaaa'));
    rmSync(join(root, 'spec', 'features', 'legacy-aaaaaa.yaml'));
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), readFileSync(join(root, 'spec', 'capabilities.yaml'), 'utf8').replace('F-aaaaaa', 'F-aaaaaaaa'));
    const sluggedHex = previewSchema02Migration(root);
    expect(sluggedHex.features[0]).toMatchObject({address: 'feature:F-aaaaaaaa', path: 'spec/features/legacy-aaaaaaaa.yaml'});
  });

  test('rejects malformed ADR reference retention instead of silently dropping it', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(feature, `${readFileSync(feature, 'utf8')}    adr_refs: architecture/0001.md\n`);
    expect(() => previewSchema02Migration(root)).toThrow('adr_refs');
  });

  test('records a valid legacy capability surface as a D08 removal and rejects malformed values', () => {
    const root = workspace();
    const catalog = join(root, 'spec', 'capabilities.yaml');
    writeFileSync(catalog, readFileSync(catalog, 'utf8').replace('    title: Migration', '    title: Migration\n    surface: platform'));
    const preview = previewSchema02Migration(root);
    expect(preview.capabilitySurfaceDispositions).toEqual([{id: 'migration', legacySurface: 'platform', disposition: 'removed_by_schema_0.2'}]);
    expect(preview.baseline.capabilitySurfaceDispositions).toEqual(preview.capabilitySurfaceDispositions);
    writeFileSync(catalog, readFileSync(catalog, 'utf8').replace('surface: platform', 'surface: invented'));
    expect(() => previewSchema02Migration(root)).toThrow('capability surface');
  });

  test('permits an empty ADR reference list without inventing a review resolution', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(feature, `${readFileSync(feature, 'utf8')}    adr_refs: []\n`);
    expect(previewSchema02Migration(root).requiredResolution.some((item) => item.code === 'ADR_REFERENCE_REVIEW')).toBe(false);
  });

  test('keeps missing architecture and missing capability outcome addressable by closed resolutions', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
      'schema: "0.1"', 'capabilities:', '  - id: migration', '    title: Migration', '    features: [F-aaaaaaaa]', '',
    ].join('\n'));
    const preview = previewSchema02Migration(root);
    expect(preview.architecture).toMatchObject({status: 'resolution_required', rules: []});
    expect(preview.requiredResolution).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'ARCHITECTURE_LAYER_RESOLUTION', subject: 'architecture'}),
      expect.objectContaining({code: 'CAPABILITY_OUTCOME_CONFIRMATION', subject: 'capability:migration'}),
    ]));
    expect(preview.capabilities).toEqual([expect.objectContaining({id: 'migration', title: 'Migration', status: 'unknown'})]);
  });

  test('fails closed rather than coercing retained feature or proof-reference source fields', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    const original = readFileSync(feature, 'utf8');
    writeFileSync(feature, original.replace('status: planned', 'status: mystery'));
    expect(() => previewSchema02Migration(root)).toThrow('status must be a supported string');
    writeFileSync(feature, original.replace('modules: []', 'modules: invalid'));
    expect(() => previewSchema02Migration(root)).toThrow('modules must be an array of strings');
    writeFileSync(feature, original.replace('test_refs: [tests/migration.test.ts#keeps raw selector]', 'test_refs: [tests/migration.test.ts, 4]'));
    expect(() => previewSchema02Migration(root)).toThrow('test_refs');
  });

  test('binds legacy audit bytes and reports asserted-only independence loss under require policy', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec.yaml'), readFileSync(join(root, 'spec.yaml'), 'utf8').replace('  language: typescript', '  language: typescript\n  independence_policy: require'));
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(feature, readFileSync(feature, 'utf8').replace('status: planned', 'status: done'));
    mkdirSync(join(root, '.cladding'), {recursive: true});
    writeFileSync(join(root, '.cladding', 'audit.log.jsonl'), `${JSON.stringify({id: 'ev-legacy', featureId: 'F-aaaaaaaa', stage: 'stage_4.1', identity: {author: 'human', timestamp: '2020-01-01T00:00:00.000Z'}, kind: 'note', content: 'legacy signoff'})}\n`);
    const preview = previewSchema02Migration(root);
    expect(preview.sourceManifest.map((entry) => entry.path)).toContain('.cladding/audit.log.jsonl');
    expect(preview.independence).toEqual({legacyEvidence: 'asserted', requirePolicyDoneLosses: ['F-aaaaaaaa']});
  });

  test('makes malformed EARS and missing legacy text explicit rather than reconstructing them', () => {
    const root = workspace();
    const feature = join(root, 'spec', 'features', 'migration-aaaaaaaa.yaml');
    writeFileSync(feature, readFileSync(feature, 'utf8').replace(
      '    text: "When a user saves, the system shall retain the draft exactly."',
      '    text: "The system must retain the draft exactly."\n  - id: AC-cccccccc\n    ears: ubiquitous\n    condition: untrusted partial source',
    ));
    const criteria = previewSchema02Migration(root).criteria;
    expect(criteria.find((entry) => entry.address.endsWith('/AC-bbbbbbbb'))?.scan).toMatchObject({status: 'conflict'});
    expect(criteria.find((entry) => entry.address.endsWith('/AC-cccccccc'))?.scan).toEqual({status: 'unknown'});
  });

  test('rejects mixed inline capability and architecture source ahead of ignored legacy files', () => {
    const root = workspace();
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.1"', 'project:', '  name: migration-preview', '  language: typescript', '  intent_summary: "Keep authored source faithful."', 'features: []', 'scenarios: []', 'capabilities:', '  - id: inline-capability', '    title: Inline capability', '    summary: "Use the inline catalog exactly."', 'architecture:', '  layers:', '    - [spec]', '',
    ].join('\n'));
    expect(() => previewSchema02Migration(root)).toThrow('mixed inline and sharded capability sources');
  });
});
