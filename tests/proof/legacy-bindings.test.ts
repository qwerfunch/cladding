// Cladding · legacy proof-binding tests.

import {createHash} from 'node:crypto';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {selectCriterionTestBindings} from '../../src/proof/legacy-bindings.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import type {MigrationBaseline} from '../../src/spec/compiler/migration-baseline.js';

const temporary: string[] = [];

function baseline(): MigrationBaseline {
  return {
    schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [],
    criteria: [{
      address: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', legacyIntent: {text: 'The system shall retain a legacy test binding.'}, classification: 'legacy_unclassified',
      bindings: [{channel: 'test', raw: 'tests/legacy.test.ts'}], exemption: {id: 'legacy-1', subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', reason: 'legacy_criterion_intent'},
    }],
  };
}

function reviewedBaseline(bytes: string): MigrationBaseline {
  return {
    ...baseline(),
    reviewedCarryForwards: [{
      criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb',
      intent: {statement: 'The system shall retain a reviewed test binding.', kind: 'behavior'},
      bindings: [{
        raw: 'tests/reviewed.test.ts#historic case', file: 'tests/reviewed.test.ts', selector: 'historic case',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      }],
    }],
  };
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('legacy binding fallback', () => {
  test('uses unchanged exempt baseline test refs and hashes the whole path-only file', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f5-baseline-'));
    temporary.push(root);
    mkdirSync(join(root, 'tests'));
    writeFileSync(join(root, 'tests', 'legacy.test.ts'), 'test("legacy", () => {});\n');
    const selected = selectCriterionTestBindings({
      cwd: root, baseline: baseline(), criterion: 'F-aaaaaaaa/AC-bbbbbbbb',
      currentCriterion: {statement: 'The system shall retain a legacy test binding.'}, live: [],
    });
    expect(selected).toMatchObject({source: 'legacy', legacy: [expect.objectContaining({state: 'available', sha256: expect.stringMatching(/^[a-f0-9]{64}$/)})]});
  });

  test('live covers replaces rather than unions baseline, while changed intent and stale paths do not rewrite history', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f5-baseline-'));
    temporary.push(root);
    const current = {statement: 'The system shall retain a legacy test binding.'};
    const live = [{criterion: 'F-aaaaaaaa/AC-bbbbbbbb', framework: 'vitest' as const, file: 'tests/live.test.ts', selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb] live', carrier: 'title' as const}];
    expect(selectCriterionTestBindings({cwd: root, baseline: baseline(), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live})).toMatchObject({source: 'live', live, legacy: []});
    expect(selectCriterionTestBindings({cwd: root, baseline: baseline(), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: {statement: 'The system shall change intent.'}, live: []}).source).toBe('none');
    expect(selectCriterionTestBindings({cwd: root, baseline: baseline(), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live: []})).toMatchObject({source: 'legacy', legacy: [expect.objectContaining({state: 'stale', raw: 'tests/legacy.test.ts'})]});
  });

  test('uses an explicit reviewed carry-forward only for its exact strict intent and never unions it with live proof', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f7-reviewed-binding-'));
    temporary.push(root);
    mkdirSync(join(root, 'tests'));
    const reviewedBytes = 'it("historic case", () => {});\n';
    writeFileSync(join(root, 'tests', 'reviewed.test.ts'), reviewedBytes);
    const current = {statement: 'The system shall retain a reviewed test binding.', kind: 'behavior'};
    const selected = selectCriterionTestBindings({
      cwd: root, baseline: reviewedBaseline(reviewedBytes), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live: [],
    });
    expect(selected).toMatchObject({
      source: 'reviewed', live: [], legacy: [],
      reviewed: [expect.objectContaining({provenance: 'reviewed_carry_forward', state: 'available'})],
    });
    const live = [{criterion: 'F-aaaaaaaa/AC-bbbbbbbb', framework: 'vitest' as const, file: 'tests/live.test.ts', selector: 'live', carrier: 'title' as const}];
    expect(selectCriterionTestBindings({cwd: root, baseline: reviewedBaseline(reviewedBytes), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: current, live}))
      .toMatchObject({source: 'live', live, reviewed: [], legacy: []});
    for (const changed of [
      {statement: 'The system shall change the reviewed intent.', kind: 'behavior'},
      {statement: current.statement, kind: 'quality'},
      {statement: current.statement, kind: 'behavior', rationale: 'new reason'},
      {statement: current.statement, kind: 'behavior', constraint_refs: ['AR-aaaaaaaa']},
    ]) {
      expect(selectCriterionTestBindings({cwd: root, baseline: reviewedBaseline(reviewedBytes), criterion: 'F-aaaaaaaa/AC-bbbbbbbb', currentCriterion: changed, live: []}).source).toBe('none');
    }
    writeFileSync(join(root, 'tests', 'reviewed.test.ts'), `${reviewedBytes}// changed\n`);
    expect(selectCriterionTestBindings({
      cwd: root,
      baseline: reviewedBaseline(reviewedBytes),
      criterion: 'F-aaaaaaaa/AC-bbbbbbbb',
      currentCriterion: current,
      live: [],
    }))
      .toMatchObject({source: 'reviewed', reviewed: [expect.objectContaining({state: 'stale'})]});
  });

  test('exposes the validated migration baseline only through the compiler result', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-f5-baseline-compiler-'));
    temporary.push(root);
    mkdirSync(join(root, 'spec', 'features'), {recursive: true});
    mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: baseline\n  language: typescript\n  purpose: Keep baseline reads compiler-owned.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
    writeFileSync(join(root, 'spec', 'features', 'baseline-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Baseline\nstatus: done\npurpose: Keep baseline reads compiler-owned.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall retain a legacy test binding.\n');
    writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), `${JSON.stringify(baseline())}\n`);
    expect(compileSpecWorkspace(root).migrationBaseline?.criteria[0]?.bindings).toEqual([{channel: 'test', raw: 'tests/legacy.test.ts'}]);
  });
});
