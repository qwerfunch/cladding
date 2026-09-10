// Cladding · Spec 0.2 F3 · project, capability, and architecture compiler tests.

import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';
import {previewSchema02Migration, serializeMigrationPreview} from '../../../src/spec/compiler/migration-preview.js';

const temporary: string[] = [];

function schema02Workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-schema-02-f3-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: catalog-fixture', '  language: typescript', '  description: A fixture project.',
    '  purpose: Keep a catalog authoritative.', '  assurance_level: L2', '  scenario_policy: advisory', 'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
    'capabilities:', '  - id: governance', '    title: Governance', '    outcome: Teams receive one owned outcome.', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'architecture.yaml'), [
    'layers:', '  - [spec]', '  - [stages]', 'rules:', '  - id: AR-aaaaaaaa', '    kind: forbidden_import', '    from: spec', '    to: stages', '    rationale: The compiler stays independent from stage execution.', '',
  ].join('\n'));
  writeSchema02Feature(root, 'catalog-aaaaaaaa.yaml', [
    'id: F-aaaaaaaa', 'title: Catalog', 'status: planned', 'purpose: Keep capability ownership local to a feature.', 'modules: []', 'depends_on: []', 'capability_refs: [governance]', 'acceptance_criteria:',
    '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall retain an explicit capability link.', '',
  ]);
  return root;
}

function writeSchema02Feature(root: string, name: string, body: readonly string[]): void {
  writeFileSync(join(root, 'spec', 'features', name), body.join('\n'));
}

function workspaceManifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return workspaceManifest(root, path);
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

function schema01Workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-migration-f3-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'nested', 'empty'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.1"', 'project:', '  name: migration-fixture', '  language: typescript', '  intent_summary: Keep the legacy catalog exact.', 'features: []', 'scenarios: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'claimed-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'slug: claimed', 'title: Claimed', 'status: planned', 'modules: []', 'acceptance_criteria: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'features', 'direct-bbbbbbbb.yaml'), [
    'id: F-bbbbbbbb', 'slug: direct', 'title: Direct', 'status: planned', 'modules: []', 'acceptance_criteria: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
    'schema: "0.1"', 'source: spec.yaml', 'capabilities:', '  - id: catalog', '    title: Catalog', '    summary: Keep the legacy catalog exact.', '    features: [F-aaaaaaaa]', '',
  ].join('\n'));
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('schema 0.2 project, capability, and architecture contracts', () => {
  test('[covers:F-94285dd8/AC-00d84b33] preserves explicit project identity and shipped policies without hidden defaults', () => {
    const root = schema02Workspace();
    writeFileSync(join(root, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: catalog-fixture', '  language: typescript', '  description: A fixture project.', '  version: 0.10.0', '  repository: https://example.test/catalog', '  onboarding_seeded: true',
      '  purpose: Keep a catalog authoritative.', '  assurance_level: L3', '  scenario_policy: required', '  require_oracles: true', '  oracle_policy: strict', '  independence_policy: require', '  deliverable: {path: bin/clad}', '  smoke: [{kind: none}]', '  ai_hints: {primary_branch: develop}', 'features: []', 'scenarios: []', '',
    ].join('\n'));
    mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(root, 'spec', 'scenarios', 'catalog-review-aaaaaaaa.yaml'), [
      'id: S-aaaaaaaa', 'title: Catalog review', 'actor: Maintainer', 'goal: Review the catalog contract.',
      'success: The catalog contract remains valid.', 'steps: [Open the catalog.]', 'feature_refs: [F-aaaaaaaa]', '',
    ].join('\n'));
    const contract = compileSpecWorkspace(root).contract;
    expect(contract?.project).toEqual({
      name: 'catalog-fixture', language: 'typescript', description: 'A fixture project.', version: '0.10.0', repository: 'https://example.test/catalog', onboardingSeeded: true,
      purpose: 'Keep a catalog authoritative.', assuranceLevel: 'L3', scenarioPolicy: 'required',
      retainedPolicies: {
        ai_hints: {primary_branch: 'develop'}, deliverable: {path: 'bin/clad'}, independence_policy: 'require', oracle_policy: 'strict', require_oracles: true, smoke: [{kind: 'none'}],
      },
    });
    writeFileSync(join(root, 'spec.yaml'), readFileSync(join(root, 'spec.yaml'), 'utf8')
      .replace('  assurance_level: L3', '  assurance_level: L9')
      .replace('  scenario_policy: required', '  scenario_policy: hidden')
      .replace('  purpose: Keep a catalog authoritative.', '  purpose: Keep a catalog authoritative.\n  intent_summary: Legacy aliases are forbidden.\n  unknown_policy: reject-me'));
    const invalid = compileSpecWorkspace(root);
    expect(invalid.contract).toBeUndefined();
    expect(invalid.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      'project.assurance_level must explicitly be L1, L2, L3, or L4',
      'project.scenario_policy must explicitly be off, advisory, or required',
      'project must not contain intent_summary in schema 0.2',
    ]));
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'LEGACY_FIELD', source: expect.objectContaining({yamlPath: '$.intent_summary'})}),
      expect.objectContaining({code: 'INVALID_SCHEMA_02', source: expect.objectContaining({yamlPath: '$.unknown_policy'})}),
    ]));
  });

  test('[covers:F-94285dd8/AC-10b158d6] accepts deliberate empty links, blocks missing and unknown links, and never unions legacy capability owners', () => {
    const root = schema02Workspace();
    writeSchema02Feature(root, 'direct-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'title: Direct', 'status: planned', 'purpose: Contribute directly to project purpose.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria: []', '',
    ]);
    const direct = compileSpecWorkspace(root);
    expect(direct.contract?.features.find((feature) => feature.id === 'F-bbbbbbbb')).toEqual({
      id: 'F-bbbbbbbb', title: 'Direct', status: 'planned', purpose: 'Contribute directly to project purpose.', modules: [], dependsOn: [], capabilityRefs: [], acceptanceCriteria: [],
    });
    expect(direct.edges.some((edge) => edge.from === 'feature:F-bbbbbbbb' && edge.relation === 'contributes_to')).toBe(false);

    writeSchema02Feature(root, 'unknown-cccccccc.yaml', [
      'id: F-cccccccc', 'title: Unknown', 'status: planned', 'purpose: Reject unknown capability identities.', 'modules: []', 'depends_on: []', 'capability_refs: [missing]', 'acceptance_criteria: []', '',
    ]);
    writeSchema02Feature(root, 'missing-dddddddd.yaml', [
      'id: F-dddddddd', 'title: Missing', 'status: planned', 'purpose: Require an explicit direct contribution choice.', 'modules: []', 'depends_on: []', 'acceptance_criteria: []', '',
    ]);
    const blocked = compileSpecWorkspace(root);
    expect(blocked.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      'F-cccccccc capability_refs contains unknown capability missing',
      'feature.capability_refs must be explicitly persisted as an array',
    ]));

    writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
      'schema: "0.2"', 'source: spec.yaml', 'capabilities:', '  - id: governance', '    title: Governance', '    outcome: Teams receive one owned outcome.', '    summary: Legacy summary', '    surface: feature', '    features: [F-bbbbbbbb]', '',
    ].join('\n'));
    const noUnion = compileSpecWorkspace(root);
    expect(noUnion.edges.some((edge) => edge.from === 'feature:F-bbbbbbbb' && edge.relation === 'contributes_to')).toBe(false);
    expect(noUnion.diagnostics.filter((diagnostic) => diagnostic.code === 'LEGACY_FIELD').map((diagnostic) => diagnostic.source?.yamlPath)).toEqual(expect.arrayContaining([
      '$.schema', '$.source', '$.capabilities[0].summary', '$.capabilities[0].surface', '$.capabilities[0].features',
    ]));
  });

  test('[covers:F-94285dd8/AC-2ca57e75] materializes catalog and architecture nodes with authored edge direction and a deterministic typed contract', () => {
    const root = schema02Workspace();
    writeSchema02Feature(root, 'boundary-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'title: Boundary', 'status: planned', 'purpose: Keep constraints accountable.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-cccccccc', '    kind: constraint', '    statement: The system shall preserve the compiler boundary.', '    constraint_refs: [AR-aaaaaaaa]', '',
    ]);
    writeSchema02Feature(root, 'local-dddddddd.yaml', [
      'id: F-dddddddd', 'title: Local rationale', 'status: planned', 'purpose: Keep a local constraint rationale explicit.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-eeeeeeee', '    kind: constraint', '    statement: The system shall preserve a locally explained boundary.', '    rationale: This boundary is local to the feature.', '',
    ]);
    const compiled = compileSpecWorkspace(root);
    expect(compiled.contract?.architecture).toEqual({
      layers: [['spec'], ['stages']],
      rules: [{id: 'AR-aaaaaaaa', kind: 'forbidden_import', from: 'spec', to: 'stages', rationale: 'The compiler stays independent from stage execution.'}],
    });
    expect(compiled.nodes.map((node) => node.address)).toEqual(expect.arrayContaining([
      'capability:governance', 'architecture_rule:AR-aaaaaaaa',
    ]));
    expect(compiled.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({from: 'feature:F-aaaaaaaa', to: 'capability:governance', relation: 'contributes_to', provenance: 'authored'}),
      expect.objectContaining({from: 'criterion:F-bbbbbbbb/AC-cccccccc', to: 'architecture_rule:AR-aaaaaaaa', relation: 'constrained_by', provenance: 'authored'}),
    ]));
    expect(compiled.contract?.features.find((feature) => feature.id === 'F-dddddddd')?.acceptanceCriteria).toEqual([
      {id: 'AC-eeeeeeee', kind: 'constraint', statement: 'The system shall preserve a locally explained boundary.', rationale: 'This boundary is local to the feature.', constraintRefs: []},
    ]);
    expect(compiled.edges.some((edge) => edge.from === 'criterion:F-dddddddd/AC-eeeeeeee' && edge.relation === 'constrained_by')).toBe(false);
  });

  test('accepts an empty D08 architecture scaffold until architecture is known', () => {
    const root = schema02Workspace();
    // D08 permits an architecture.yaml scaffold with no known layers or rules.
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
    const compiled = compileSpecWorkspace(root);
    expect(compiled.contract?.architecture).toEqual({layers: [], rules: []});
    expect(compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
  });

  test('retains D06 feature governance and criterion proof fields while validating blocked lifecycle state', () => {
    const root = schema02Workspace();
    writeSchema02Feature(root, 'retained-dddddddd.yaml', [
      'id: F-dddddddd', 'title: Retained', 'status: blocked', 'blocked_reason: Await the independent oracle.', 'purpose: Preserve retained feature governance.', 'modules: [src/retained.ts]', 'depends_on: [F-aaaaaaaa]',
      'design_impact: {classification: additive, rationale: No structural design change., status: resolved}', 'archived_at: "2026-08-01T00:00:00Z"', 'archive_reason: Keep migration metadata available.', 'superseded_by: F-aaaaaaaa', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-eeeeeeee', '    kind: quality', '    statement: The system shall preserve retained proof locations.', '    oracle_refs: [tests/oracle/retained.test.ts]', '    evidence_refs: [docs/retained.md]', '    notes: Free-form context stays outside intent hashes.', '',
    ]);
    expect(compileSpecWorkspace(root).contract?.features.find((feature) => feature.id === 'F-dddddddd')).toEqual({
      id: 'F-dddddddd', title: 'Retained', status: 'blocked', blockedReason: 'Await the independent oracle.', purpose: 'Preserve retained feature governance.', modules: ['src/retained.ts'], dependsOn: ['F-aaaaaaaa'],
      designImpact: {classification: 'additive', rationale: 'No structural design change.', status: 'resolved'}, archivedAt: '2026-08-01T00:00:00Z', archiveReason: 'Keep migration metadata available.', supersededBy: 'F-aaaaaaaa', capabilityRefs: [],
      acceptanceCriteria: [{id: 'AC-eeeeeeee', kind: 'quality', statement: 'The system shall preserve retained proof locations.', constraintRefs: [], oracleRefs: ['tests/oracle/retained.test.ts'], evidenceRefs: ['docs/retained.md'], notes: 'Free-form context stays outside intent hashes.'}],
    });
    writeFileSync(join(root, 'spec', 'features', 'retained-dddddddd.yaml'), readFileSync(join(root, 'spec', 'features', 'retained-dddddddd.yaml'), 'utf8')
      .replace('status: blocked', 'status: invented')
      .replace('blocked_reason: Await the independent oracle.', 'blocked_reason:'));
    expect(compileSpecWorkspace(root).diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      'feature.status must be planned, in_progress, done, blocked, or archived',
      'feature.blocked_reason must be a non-empty string when supplied',
    ]));
  });

  test('[covers:F-94285dd8/AC-2ca57e75] rejects noncanonical architecture spellings, duplicate rules, and unresolved constraint references', () => {
    const root = schema02Workspace();
    writeFileSync(join(root, 'spec', 'architecture.yaml'), [
      'schema: "0.2"', 'source: spec.yaml', 'layers: {foundation: [spec]}', 'forbidden_imports: [{from: spec, to: stages}]', 'rules:',
      '  - id: AR-invalid', '    kind: reverse_import', '    from: stages', '    to: spec', '    rationale: ""',
      '  - id: AR-invalid', '    kind: forbidden_import', '    from: stages', '    to: spec', '    rationale: Duplicate direction.', '',
      '  - id: AR-bbbbbbbb', '    kind: forbidden_import', '    from: ""', '    to: ""', '    rationale: ""', '',
    ].join('\n'));
    writeSchema02Feature(root, 'unknown-rule-bbbbbbbb.yaml', [
      'id: F-bbbbbbbb', 'title: Unknown rule', 'status: planned', 'purpose: Reject unresolved constraints.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-cccccccc', '    kind: constraint', '    statement: The system shall reject unknown architecture rules.', '    constraint_refs: [AR-deadbeef]', '',
    ]);
    const compiled = compileSpecWorkspace(root);
    expect(compiled.contract).toBeUndefined();
    expect(compiled.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(expect.arrayContaining([
      'architecture must not contain schema in schema 0.2', 'architecture must not contain source in schema 0.2', 'architecture must not contain forbidden_imports in schema 0.2',
      'architecture.layers must be an ordered string[][] value', 'architecture rule ids must use the executable AR-<8 lowercase hex> policy',
      'architecture rule kind must be forbidden_import', 'duplicate architecture rule id AR-invalid', 'duplicate forbidden import from stages to spec',
      'architecture rule from must name the importing layer', 'architecture rule to must name the imported dependency layer', 'architecture rule rationale must be a non-empty string',
      'F-bbbbbbbb/AC-cccccccc constraint_refs contains unknown architecture rule AR-deadbeef',
    ]));
  });
});

describe('schema 0.1 migration candidates', () => {
  test('U02 L = N', () => {
    const root = schema01Workspace();
    const preview = previewSchema02Migration(root);
    expect(preview.project).toEqual({purpose: 'Keep the legacy catalog exact.', status: 'proposed', assuranceLevel: 'L2', scenarioPolicy: 'advisory'});
    expect(preview.features).toEqual([
      {address: 'feature:F-aaaaaaaa', path: 'spec/features/claimed-aaaaaaaa.yaml', targetPath: 'spec/features/claimed-aaaaaaaa.yaml', title: 'Claimed', purpose: 'legacy_exempt', capabilityRefs: ['catalog']},
      {address: 'feature:F-bbbbbbbb', path: 'spec/features/direct-bbbbbbbb.yaml', targetPath: 'spec/features/direct-bbbbbbbb.yaml', title: 'Direct', purpose: 'legacy_exempt', capabilityRefs: []},
    ]);
    expect(preview.capabilityEdgeProof).toEqual({
      legacyPairs: [{capabilityId: 'catalog', featureId: 'F-aaaaaaaa'}],
      candidatePairs: [{capabilityId: 'catalog', featureId: 'F-aaaaaaaa'}],
      missing: [], extra: [], conflicts: [], equal: true,
    });
    expect(preview.requiredResolution.map((item) => item.code)).toEqual(expect.arrayContaining([
      'PROJECT_PURPOSE_CONFIRMATION', 'PROJECT_ASSURANCE_LEVEL_CONFIRMATION', 'PROJECT_SCENARIO_POLICY_CONFIRMATION', 'CAPABILITY_OUTCOME_CONFIRMATION',
    ]));
  });

  test('rejects duplicate capability identities rather than advertising an unexecutable edge resolution', () => {
    const root = schema01Workspace();
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
      'capabilities:', '  - id: catalog', '    title: Catalog', '    summary: Keep the legacy catalog exact.', '    features: [F-aaaaaaaa, F-missing]', '  - id: catalog', '    title: Duplicate', '    summary: Conflicting owner.', '    features: [F-aaaaaaaa]', '',
    ].join('\n'));
    expect(() => previewSchema02Migration(root)).toThrow('duplicate capability id catalog');
  });

  test('rejects structurally unaddressable capability and feature identities before candidate construction', () => {
    const root = schema01Workspace();
    writeFileSync(join(root, 'spec', 'features', 'claimed-duplicate-cccccccc.yaml'), [
      'id: F-aaaaaaaa', 'slug: claimed-duplicate', 'title: Duplicate', 'status: planned', 'modules: []', 'acceptance_criteria: []', '',
    ].join('\n'));
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), [
      'capabilities:', '  - legacy-literal', '  - title: Missing id', '    summary: No identity.', '  - id: missing-title', '    summary: No title.', '',
    ].join('\n'));
    expect(() => previewSchema02Migration(root)).toThrow(/duplicate legacy feature id|capability record/);
    const nonArrayRoot = schema01Workspace();
    writeFileSync(join(nonArrayRoot, 'spec', 'capabilities.yaml'), 'capabilities: not-an-array\n');
    expect(() => previewSchema02Migration(nonArrayRoot)).toThrow('capability catalog that is not an array');
  });

  test('[covers:F-94285dd8/AC-3f2d0ad2] copies lossless architecture structure but leaves each rule rationale and lossy layers for review', () => {
    const root = schema01Workspace();
    writeFileSync(join(root, 'spec', 'architecture.yaml'), [
      '# This comment is explanatory prose, not a structured rule rationale.', 'layers:', '  - [spec, core]', '  - [stages]', 'forbidden_imports:', '  - {from: spec, to: stages}', '',
    ].join('\n'));
    const preview = previewSchema02Migration(root);
    expect(preview.architecture).toEqual({
      status: 'resolution_required', layers: [['spec', 'core'], ['stages']],
      rules: [{id: 'AR-51b36828', kind: 'forbidden_import', from: 'spec', to: 'stages', status: 'rationale_required'}],
    });
    expect(preview.requiredResolution).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'ARCHITECTURE_RULE_RATIONALE', subject: 'architecture_rule:AR-51b36828'}),
    ]));
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: {foundation: [spec]}\nforbidden_imports: []\n');
    const lossy = previewSchema02Migration(root);
    expect(lossy.architecture).toEqual({status: 'resolution_required', rules: []});
    expect(lossy.requiredResolution).toEqual(expect.arrayContaining([
      expect.objectContaining({code: 'ARCHITECTURE_LAYER_RESOLUTION', subject: 'architecture'}),
    ]));
  });

  test('[covers:F-94285dd8/AC-3f2d0ad2] is deterministic and recursively writes zero bytes while apply remains unavailable', () => {
    const root = schema01Workspace();
    const before = workspaceManifest(root);
    const first = serializeMigrationPreview(previewSchema02Migration(root));
    const second = serializeMigrationPreview(previewSchema02Migration(root));
    expect(second).toBe(first);
    expect(workspaceManifest(root)).toEqual(before);
  });
});
