// Cladding · F-<hash> — UNVERIFIED_AC: AC → test → observed-pass.
//
// Covers the pure JUnit parser, tolerant path lookup, the pure evaluation
// core (fail/skip/absent/pass cases + done-only + skippable prefixes), and the
// graceful no-report skip via the public detector entry against a temp dir.

import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {parseJUnitReport, lookupTestRef, type JUnitReport} from '../../src/stages/junit-report.js';
import {evaluateAcVerification, evaluateSchema02AcVerification, unverifiedAc} from '../../src/stages/detectors/unverified-ac.js';
import type {Spec} from '../../src/spec/types.js';

const XML = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest" tests="4" failures="1" errors="0">
  <testsuite name="tests/pass.test.ts" tests="1" failures="0" skipped="0">
    <testcase classname="tests/pass.test.ts" name="a does X"></testcase>
  </testsuite>
  <testsuite name="tests/fail.test.ts" tests="1" failures="1" skipped="0">
    <testcase classname="tests/fail.test.ts" name="b does Y"><failure message="boom">stack</failure></testcase>
  </testsuite>
  <testsuite name="tests/skip.test.ts" tests="1" failures="0" skipped="1">
    <testcase classname="tests/skip.test.ts" name="c does Z"><skipped/></testcase>
  </testsuite>
</testsuites>`;

const specWith = (refs: string[], status = 'done'): Spec =>
  ({features: [{id: 'F-x', status, acceptance_criteria: [{id: 'AC-1', test_refs: refs}]}]} as never);

function writeSchema02CarryForwardFixture(root: string, reviewed: boolean): Spec {
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  mkdirSync(join(root, 'tests'), {recursive: true});
  const historic = 'it("historic path-only case", () => {});\n';
  writeFileSync(join(root, 'tests', 'historic.test.ts'), historic);
  writeFileSync(join(root, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: carry-forward', '  language: typescript',
    '  purpose: Preserve accepted migration proof.', '  assurance_level: L2', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'carry-forward-aaaaaaaa.yaml'), [
    'id: F-aaaaaaaa', 'title: Carry forward', 'status: done', 'purpose: Preserve accepted migration proof.',
    'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:', '  - id: AC-bbbbbbbb',
    ...(reviewed ? ['    kind: behavior'] : []), '    statement: The system shall preserve accepted migration proof.', '',
  ].join('\n'));
  const baseline = {
    schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [],
    criteria: [{
      address: 'criterion:F-aaaaaaaa/AC-bbbbbbbb',
      legacyIntent: {text: 'The system shall preserve accepted migration proof.'},
      classification: 'legacy_unclassified',
      bindings: [{channel: 'test', raw: 'tests/historic.test.ts'}],
      exemption: {id: 'carry-forward-proof', subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', reason: 'legacy_criterion_intent'},
    }],
    ...(reviewed ? {reviewedCarryForwards: [{
      criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb',
      intent: {statement: 'The system shall preserve accepted migration proof.', kind: 'behavior'},
      bindings: [{raw: 'tests/historic.test.ts', file: 'tests/historic.test.ts', sha256: createHash('sha256').update(historic).digest('hex')}],
    }]} : {}),
  };
  writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify(baseline));
  return {schema: '0.2', features: [{id: 'F-aaaaaaaa', status: 'done', acceptance_criteria: [{id: 'AC-bbbbbbbb'}]}]} as never as Spec;
}

describe('parseJUnitReport (F-<hash>)', () => {
  test('aggregates pass / fail / skip per file from classname', () => {
    const r = parseJUnitReport(XML);
    expect(r.get('tests/pass.test.ts')).toEqual({pass: 1, fail: 0, skip: 0});
    expect(r.get('tests/fail.test.ts')).toEqual({pass: 0, fail: 1, skip: 0});
    expect(r.get('tests/skip.test.ts')).toEqual({pass: 0, fail: 0, skip: 1});
  });

  test('self-closed passing testcase counts as a pass', () => {
    const r = parseJUnitReport('<testcase classname="x.ts" name="ok" />');
    expect(r.get('x.ts')).toEqual({pass: 1, fail: 0, skip: 0});
  });
});

describe('lookupTestRef (F-<hash>)', () => {
  const r: JUnitReport = new Map([['tests/a.test.ts', {pass: 1, fail: 0, skip: 0}]]);
  test('[covers:F-96700032/AC-14bdc224] matches exact, ./-prefixed, and suffix paths', () => {
    expect(lookupTestRef(r, 'tests/a.test.ts')?.pass).toBe(1);
    expect(lookupTestRef(r, './tests/a.test.ts')?.pass).toBe(1);
    expect(lookupTestRef(r, 'a.test.ts')?.pass).toBe(1); // ref is a suffix of the report key
    expect(lookupTestRef(r, 'tests/other.test.ts')).toBeUndefined();
  });
});

describe('evaluateAcVerification (F-<hash>)', () => {
  const report = parseJUnitReport(XML);

  test('[covers:F-96700032/AC-ab798b7c] a passing test_ref yields no finding', () => {
    expect(evaluateAcVerification(specWith(['tests/pass.test.ts']), report)).toHaveLength(0);
  });

  test('[covers:F-96700032/AC-75ab1c26] a failing test_ref is an error finding', () => {
    const f = evaluateAcVerification(specWith(['tests/fail.test.ts']), report);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({detector: 'UNVERIFIED_AC', severity: 'error'});
    expect(f[0].message).toMatch(/FAILING/);
  });

  test('[covers:F-96700032/AC-0ac3333c] an only-skipped test_ref is an error finding', () => {
    const f = evaluateAcVerification(specWith(['tests/skip.test.ts']), report);
    expect(f[0]).toMatchObject({severity: 'error'});
    expect(f[0].message).toMatch(/SKIPPED/);
  });

  test('[covers:F-96700032/AC-f1cb906a] a test_ref absent from the report is a warn finding (partial run is legitimate)', () => {
    const f = evaluateAcVerification(specWith(['tests/missing.test.ts']), report);
    expect(f[0]).toMatchObject({severity: 'warn'});
    expect(f[0].message).toMatch(/no observed result/);
  });

  test('the #anchor part of a test_ref is stripped before lookup', () => {
    expect(evaluateAcVerification(specWith(['tests/pass.test.ts#a does X']), report)).toHaveLength(0);
  });

  test('only done features are inspected', () => {
    expect(evaluateAcVerification(specWith(['tests/fail.test.ts'], 'planned'), report)).toHaveLength(0);
  });

  test('self-dogfood / fixture / derived pseudo-refs are skipped', () => {
    const f = evaluateAcVerification(specWith(['self-dogfood:build', 'fixture:x', 'derived:y']), report);
    expect(f).toHaveLength(0);
  });
});

describe('unverifiedAc.run — graceful skip (F-<hash>)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'unverified-ac-'));
  });
  afterEach(() => {
    rmSync(tmp, {recursive: true, force: true});
  });

  test('[covers:F-96700032/AC-44e7172f] no JUnit report present → returns nothing (existence check stays the baseline)', () => {
    // No report and no schema-0.2 source leaves neither legacy observation nor
    // static binding integrity for the detector to evaluate.
    expect(unverifiedAc.run({cwd: tmp})).toEqual([]);
  });

  test('keeps schema 0.1 JUnit fail reduction unchanged', () => {
    mkdirSync(join(tmp, '.cladding'), {recursive: true});
    writeFileSync(join(tmp, 'spec.yaml'), [
      'schema: "0.1"', 'project:', '  name: legacy', '  language: typescript',
      'features:', '  - id: F-aaaaaaaa', '    title: Legacy', '    status: done',
      '    acceptance_criteria:', '      - id: AC-bbbbbbbb', '        test_refs: [tests/legacy.test.ts]', '',
    ].join('\n'));
    writeFileSync(join(tmp, '.cladding', 'config.yaml'), 'gate:\n  test_report: legacy.junit.xml\n');
    writeFileSync(join(tmp, 'legacy.junit.xml'), '<testcase classname="tests/legacy.test.ts" name="legacy"><failure/></testcase>');

    expect(unverifiedAc.run({cwd: tmp})).toEqual([
      expect.objectContaining({detector: 'UNVERIFIED_AC', severity: 'error', message: expect.stringContaining('FAILING')}),
    ]);
  });
});

describe('schema 0.2 reviewed carry-forward verification', () => {
  test('keeps hash-current legacy and reviewed path-only bindings informative and non-blocking', () => {
    const roots = [false, true].map((reviewed) => ({
      reviewed,
      root: mkdtempSync(join(tmpdir(), 'unverified-path-only-carry-forward-')),
    }));
    try {
      for (const {root, reviewed} of roots) {
        const findings = evaluateSchema02AcVerification(root, writeSchema02CarryForwardFixture(root, reviewed));
        expect(findings).toEqual([expect.objectContaining({
          detector: 'UNVERIFIED_AC', severity: 'info', path: 'tests/historic.test.ts',
          message: expect.stringContaining(reviewed ? 'reviewed carry-forward test binding' : 'legacy test binding'),
        })]);
        // Strict drift promotes error and warn only; info remains diagnostic.
        expect(findings.every((finding) => finding.severity === 'info')).toBe(true);
      }
    } finally {
      for (const {root} of roots) rmSync(root, {recursive: true, force: true});
    }
  });

  test('keeps a stale legacy path-only binding as a strict-warning control', () => {
    const root = mkdtempSync(join(tmpdir(), 'unverified-stale-legacy-carry-forward-'));
    try {
      const spec = writeSchema02CarryForwardFixture(root, false);
      rmSync(join(root, 'tests', 'historic.test.ts'));

      expect(evaluateSchema02AcVerification(root, spec)).toEqual([expect.objectContaining({
        detector: 'UNVERIFIED_AC', severity: 'warn', path: 'tests/historic.test.ts',
        message: expect.stringContaining('legacy test binding is stale'),
      })]);
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('treats a reviewed whole-file hash mismatch as an authoritative RED finding', () => {
    const root = mkdtempSync(join(tmpdir(), 'unverified-reviewed-carry-forward-'));
    try {
      mkdirSync(join(root, 'spec', 'features'), {recursive: true});
      mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
      mkdirSync(join(root, 'tests'), {recursive: true});
      const reviewed = 'it("historic reviewed case", () => {});\n';
      writeFileSync(join(root, 'tests', 'reviewed.test.ts'), `${reviewed}// changed after review\n`);
      writeFileSync(join(root, 'spec.yaml'), [
        'schema: "0.2"', 'project:', '  name: reviewed', '  language: typescript',
        '  purpose: Keep reviewed proof strict.', '  assurance_level: L2', '  scenario_policy: advisory', '',
      ].join('\n'));
      writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
      writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
      writeFileSync(join(root, 'spec', 'features', 'reviewed-aaaaaaaa.yaml'), [
        'id: F-aaaaaaaa', 'title: Reviewed', 'status: done', 'purpose: Keep reviewed proof strict.',
        'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
        '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall keep reviewed proof strict.', '',
      ].join('\n'));
      writeFileSync(join(root, 'spec', 'generated', 'migration-baseline-0.1-to-0.2.yaml'), JSON.stringify({
        schema: 1, sourceSchema: '0.1', project: {address: 'project'}, features: [], scenarios: [],
        criteria: [{
          address: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', legacyIntent: {text: 'The system shall keep reviewed proof strict.'},
          classification: 'legacy_unclassified', bindings: [{channel: 'test', raw: 'tests/reviewed.test.ts#historic reviewed case', selector: 'historic reviewed case'}],
          exemption: {id: 'reviewed-proof', subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', reason: 'legacy_criterion_intent'},
        }],
        reviewedCarryForwards: [{
          criterion: 'criterion:F-aaaaaaaa/AC-bbbbbbbb',
          intent: {statement: 'The system shall keep reviewed proof strict.', kind: 'behavior'},
          bindings: [{raw: 'tests/reviewed.test.ts#historic reviewed case', file: 'tests/reviewed.test.ts', selector: 'historic reviewed case', sha256: createHash('sha256').update(reviewed).digest('hex')}],
        }],
      }));
      const spec = {schema: '0.2', features: [{id: 'F-aaaaaaaa', status: 'done', acceptance_criteria: [{id: 'AC-bbbbbbbb'}]}]} as never as Spec;
      expect(evaluateSchema02AcVerification(root, spec, parseJUnitReport('<testcase classname="tests/reviewed.test.ts" name="historic reviewed case" />')))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({detector: 'UNVERIFIED_AC', severity: 'error', message: expect.stringContaining('immutable migration review')}),
        ]));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });

  test('ignores a retained schema 0.2 JUnit failure while retaining static source diagnostics', () => {
    const root = mkdtempSync(join(tmpdir(), 'unverified-schema02-static-'));
    try {
      mkdirSync(join(root, 'spec', 'features'), {recursive: true});
      mkdirSync(join(root, 'tests'), {recursive: true});
      mkdirSync(join(root, '.cladding'), {recursive: true});
      const selector = '[covers:F-aaaaaaaa/AC-bbbbbbbb] current proof';
      writeFileSync(join(root, 'spec.yaml'), [
        'schema: "0.2"', 'project:', '  name: static', '  language: typescript',
        '  purpose: Keep current proof separate from historic reports.', '  assurance_level: L2', '  scenario_policy: advisory', '',
      ].join('\n'));
      writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
      writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
      writeFileSync(join(root, 'spec', 'features', 'static-aaaaaaaa.yaml'), [
        'id: F-aaaaaaaa', 'title: Static', 'status: done', 'purpose: Keep current proof separate from historic reports.',
        'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
        '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall separate current proof from historic reports.', '',
      ].join('\n'));
      writeFileSync(join(root, 'tests', 'static.test.ts'), `it('${selector}', () => {});\nit('[covers:F-aaaaaaaa/AC-deadbeef] unknown', () => {});\n`);
      writeFileSync(join(root, '.cladding', 'config.yaml'), 'gate:\n  test_report: retained.junit.xml\n');
      writeFileSync(join(root, 'retained.junit.xml'), `<testcase classname="tests/static.test.ts" name="${selector}"><failure/></testcase>`);

      const findings = unverifiedAc.run({cwd: root});
      expect(findings).toEqual(expect.arrayContaining([
        expect.objectContaining({detector: 'UNVERIFIED_AC', severity: 'error', message: expect.stringContaining('Unknown covers criterion')}),
      ]));
      expect(findings).not.toEqual(expect.arrayContaining([
        expect.objectContaining({message: expect.stringContaining('failing exact bound testcase observation')}),
      ]));
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
