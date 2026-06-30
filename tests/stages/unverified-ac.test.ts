// Cladding · F-<hash> — UNVERIFIED_AC: AC → test → observed-pass.
//
// Covers the pure JUnit parser, tolerant path lookup, the pure evaluation
// core (fail/skip/absent/pass cases + done-only + skippable prefixes), and the
// graceful no-report skip via the public detector entry against a temp dir.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {parseJUnitReport, lookupTestRef, type JUnitReport} from '../../src/stages/junit-report.js';
import {evaluateAcVerification, unverifiedAc} from '../../src/stages/detectors/unverified-ac.js';
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
  test('matches exact, ./-prefixed, and suffix paths', () => {
    expect(lookupTestRef(r, 'tests/a.test.ts')?.pass).toBe(1);
    expect(lookupTestRef(r, './tests/a.test.ts')?.pass).toBe(1);
    expect(lookupTestRef(r, 'a.test.ts')?.pass).toBe(1); // ref is a suffix of the report key
    expect(lookupTestRef(r, 'tests/other.test.ts')).toBeUndefined();
  });
});

describe('evaluateAcVerification (F-<hash>)', () => {
  const report = parseJUnitReport(XML);

  test('a passing test_ref yields no finding', () => {
    expect(evaluateAcVerification(specWith(['tests/pass.test.ts']), report)).toHaveLength(0);
  });

  test('a failing test_ref is an error finding', () => {
    const f = evaluateAcVerification(specWith(['tests/fail.test.ts']), report);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({detector: 'UNVERIFIED_AC', severity: 'error'});
    expect(f[0].message).toMatch(/FAILING/);
  });

  test('an only-skipped test_ref is an error finding', () => {
    const f = evaluateAcVerification(specWith(['tests/skip.test.ts']), report);
    expect(f[0]).toMatchObject({severity: 'error'});
    expect(f[0].message).toMatch(/SKIPPED/);
  });

  test('a test_ref absent from the report is a warn finding (partial run is legitimate)', () => {
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

  test('no JUnit report present → returns nothing (existence check stays the baseline)', () => {
    // No report file anywhere under tmp → resolveReportPath returns null before
    // any spec load, so the detector emits no findings.
    expect(unverifiedAc.run({cwd: tmp})).toEqual([]);
  });
});
