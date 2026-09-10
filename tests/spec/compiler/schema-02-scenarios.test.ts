// Cladding · Spec 0.2 F7 · scenario v2 compiler, policy, and GraphIR tests.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../../src/spec/compiler/compile.js';

const temporary: string[] = [];

interface ScenarioProjection {
  readonly id: string;
  readonly title: string;
  readonly actor: string;
  readonly goal: string;
  readonly success: string;
  readonly steps: readonly string[];
  readonly featureRefs: readonly string[];
}

function workspace(policy: 'off' | 'advisory' | 'required' = 'advisory'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-schema-02-scenarios-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: scenario-contract', '  language: typescript',
    '  purpose: Keep scenario intent explicit and reviewable.', '  assurance_level: L2', `  scenario_policy: ${policy}`, 'features: []', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [spec]\nrules: []\n');
  writeFeature(root, 'first-aaaaaaaa.yaml', 'F-aaaaaaaa', 'First feature');
  writeFeature(root, 'second-bbbbbbbb.yaml', 'F-bbbbbbbb', 'Second feature');
  return root;
}

function writeFeature(root: string, filename: string, id: string, title: string): void {
  writeFileSync(join(root, 'spec', 'features', filename), [
    `id: ${id}`, `title: ${title}`, 'status: planned', `purpose: ${title} keeps scenario links explicit.`,
    'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
    '  - id: AC-cccccccc', '    kind: behavior', '    statement: The system shall preserve the scenario contract.', '',
  ].join('\n'));
}

function writeScenario(root: string, filename: string, lines: readonly string[]): void {
  mkdirSync(join(root, 'spec', 'scenarios'), {recursive: true});
  writeFileSync(join(root, 'spec', 'scenarios', filename), `${lines.join('\n')}\n`);
}

function strictScenario(id: string = 'S-aaaaaaaa'): readonly string[] {
  return [
    `id: ${id}`, 'title: First login', 'actor: New customer', 'goal: Begin an authenticated session.',
    'success: The authenticated home screen is visible.', 'steps:', '  - Open the login screen.',
    '  - Submit valid credentials.', 'feature_refs:', '  - F-aaaaaaaa', '  - F-bbbbbbbb',
  ];
}

/** A present scenario with correctly typed but hollow coverage fields. */
function typedHollowScenario(id: string = 'S-aaaaaaaa'): readonly string[] {
  return [
    `id: ${id}`, 'title: Hollow journey', 'actor: ""', 'goal: ""', 'success: ""', 'steps: [""]', 'feature_refs: [""]',
  ];
}

/** A scenario may be absent from policy coverage one field at a time during migration. */
function missingFieldHollowScenario(id: string = 'S-aaaaaaaa'): readonly string[] {
  return [
    `id: ${id}`, 'title: Missing actor journey', 'goal: Begin an authenticated session.',
    'success: The authenticated home screen is visible.', 'steps: [Open the login screen.]', 'feature_refs: [F-aaaaaaaa]',
  ];
}

function scenarioProjection(compilation: ReturnType<typeof compileSpecWorkspace>): readonly ScenarioProjection[] {
  return ((compilation.contract as unknown as {readonly scenarios?: readonly ScenarioProjection[]} | undefined)?.scenarios ?? []);
}

function scenarioDiagnostics(compilation: ReturnType<typeof compileSpecWorkspace>) {
  return compilation.diagnostics.filter((diagnostic) => diagnostic.source?.path.startsWith('spec/scenarios/')
    || diagnostic.message.toLowerCase().includes('scenario'));
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('Spec compiler scenario v2 contract', () => {
  test('[covers:F-0b8f23c5/AC-0b8f2301] keeps schema 0.1 scenarios compatible while compiling strict schema 0.2 scenario nodes, projections, and source-bearing feature edges', () => {
    const legacy = mkdtempSync(join(tmpdir(), 'clad-schema-01-scenarios-'));
    temporary.push(legacy);
    mkdirSync(join(legacy, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(legacy, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: legacy-scenarios\n  language: typescript\nfeatures: []\n');
    writeScenario(legacy, 'legacy-aaaaaaaa.yaml', ['id: S-aaaaaaaa', 'title: Legacy scenario', 'flow: Preserve historical journey prose.', 'features: [F-aaaaaaaa]']);
    const legacyCompilation = compileSpecWorkspace(legacy);
    expect(legacyCompilation.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({address: 'scenario:S-aaaaaaaa', nodeType: 'semantic'}),
    ]));
    expect(legacyCompilation.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({from: 'scenario:S-aaaaaaaa', to: 'feature:F-aaaaaaaa', relation: 'participates_in', provenance: 'authored'}),
    ]));

    const root = workspace('required');
    writeScenario(root, 'first-login-aaaaaaaa.yaml', strictScenario());
    const compilation = compileSpecWorkspace(root);
    expect(compilation.diagnostics.filter((diagnostic) => diagnostic.severity === 'blocking')).toEqual([]);
    expect(compilation.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: 'scenario:S-aaaaaaaa', nodeType: 'semantic', provenance: 'authored',
        source: expect.objectContaining({path: 'spec/scenarios/first-login-aaaaaaaa.yaml', yamlPath: '$.id'}),
      }),
    ]));
    expect(compilation.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'scenario:S-aaaaaaaa', to: 'feature:F-aaaaaaaa', relation: 'participates_in', provenance: 'authored',
        owner: expect.objectContaining({path: 'spec/scenarios/first-login-aaaaaaaa.yaml', yamlPath: '$.feature_refs[0]'}),
      }),
      expect.objectContaining({
        from: 'scenario:S-aaaaaaaa', to: 'feature:F-bbbbbbbb', relation: 'participates_in', provenance: 'authored',
        owner: expect.objectContaining({path: 'spec/scenarios/first-login-aaaaaaaa.yaml', yamlPath: '$.feature_refs[1]'}),
      }),
    ]));
    expect(scenarioProjection(compilation)).toEqual([{
      id: 'S-aaaaaaaa', title: 'First login', actor: 'New customer', goal: 'Begin an authenticated session.',
      success: 'The authenticated home screen is visible.', steps: ['Open the login screen.', 'Submit valid credentials.'],
      featureRefs: ['F-aaaaaaaa', 'F-bbbbbbbb'],
    }]);
  });

  test('[covers:F-0b8f23c5/AC-0b8f2302] blocks malformed scenarios and forbidden legacy or unknown fields under every policy', () => {
    for (const policy of ['off', 'advisory', 'required'] as const) {
      const root = workspace(policy);
      writeScenario(root, 'invalid-bbbbbbbb.yaml', [
        'id: S-bbbbbbbb', 'title: Invalid legacy spill', 'actor: 7', 'goal: [not, a, string]', 'success: {state: invalid}', 'steps: not-an-array',
        'feature_refs: [F-aaaaaaaa, F-aaaaaaaa]', 'flow: Old journey prose.', 'features: [F-aaaaaaaa]', 'slug: invalid',
        'schema: "0.1"', 'source: spec.yaml', 'unrecognized: rejected',
      ]);
      const diagnostics = compileSpecWorkspace(root).diagnostics;
      const path = 'spec/scenarios/invalid-bbbbbbbb.yaml';
      expect(diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.actor'})}),
        expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.goal'})}),
        expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.success'})}),
        expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.steps'})}),
        expect.objectContaining({code: 'DUPLICATE_IDENTIFIER', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.feature_refs[1]'})}),
        expect.objectContaining({code: 'LEGACY_FIELD', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.flow'})}),
        expect.objectContaining({code: 'LEGACY_FIELD', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.features'})}),
        expect.objectContaining({code: 'LEGACY_FIELD', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.slug'})}),
        expect.objectContaining({code: 'LEGACY_FIELD', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.schema'})}),
        expect.objectContaining({code: 'LEGACY_FIELD', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.source'})}),
        expect.objectContaining({code: 'INVALID_SCHEMA_02', severity: 'blocking', source: expect.objectContaining({path, yamlPath: '$.unrecognized'})}),
      ]));
    }
  });

  test('[covers:F-0b8f23c5/AC-0b8f2302] blocks unresolved scenario feature refs under every policy', () => {
    for (const policy of ['off', 'advisory', 'required'] as const) {
      const root = workspace(policy);
      writeScenario(root, 'unresolved-bbbbbbbb.yaml', [
        'id: S-bbbbbbbb', 'title: Unresolved reference', 'actor: New customer', 'goal: Start a journey.',
        'success: The journey starts.', 'steps:', '  - Open the journey.', 'feature_refs:', '  - F-deadbeef',
      ]);
      expect(compileSpecWorkspace(root).diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: 'UNKNOWN_REFERENCE', severity: 'blocking',
          source: expect.objectContaining({path: 'spec/scenarios/unresolved-bbbbbbbb.yaml', yamlPath: '$.feature_refs[0]'}),
        }),
      ]));
    }
  });

  test('[covers:F-0b8f23c5/AC-0b8f2302][covers:F-0b8f23c5/AC-0b8f2303] applies the off advisory and required truth table to absent, missing-field, typed-hollow, and valid scenario coverage', () => {
    const expected = {
      off: {absent: {blocking: false, advisory: false}, missing: {blocking: false, advisory: false}, hollow: {blocking: false, advisory: false}, valid: {blocking: false, advisory: false}},
      advisory: {absent: {blocking: false, advisory: true}, missing: {blocking: false, advisory: true}, hollow: {blocking: false, advisory: true}, valid: {blocking: false, advisory: false}},
      required: {absent: {blocking: true, advisory: false}, missing: {blocking: true, advisory: false}, hollow: {blocking: true, advisory: false}, valid: {blocking: false, advisory: false}},
    } as const;
    for (const policy of ['off', 'advisory', 'required'] as const) {
      for (const state of ['absent', 'missing', 'hollow', 'valid'] as const) {
        const outcome = expected[policy][state];
        const root = workspace(policy);
        if (state === 'missing') {
          writeScenario(root, 'missing-actor-aaaaaaaa.yaml', missingFieldHollowScenario());
        } else if (state === 'hollow') {
          writeScenario(root, 'hollow-aaaaaaaa.yaml', typedHollowScenario());
        } else if (state === 'valid') {
          writeScenario(root, 'first-login-aaaaaaaa.yaml', strictScenario());
        }
        const compilation = compileSpecWorkspace(root);
        const diagnostics = scenarioDiagnostics(compilation);
        expect(diagnostics.some((diagnostic) => diagnostic.severity === 'blocking'), `${policy}/${state}`).toBe(outcome.blocking);
        expect(diagnostics.some((diagnostic) => diagnostic.severity === 'advisory'), `${policy}/${state}`).toBe(outcome.advisory);
        if (state === 'hollow') {
          expect(compilation.edges.some((edge) => edge.from === 'scenario:S-aaaaaaaa' && edge.relation === 'participates_in'), `${policy}/${state}`).toBe(false);
        }
      }
    }
  });
});
