import {describe, expect, test} from 'vitest';

import {reduceTestBindings} from '../../src/proof/bindings.js';
import type {TestBinding, TestCaseObservation} from '../../src/proof/types.js';
import {parseJUnitReport, type JUnitReport} from '../../src/stages/junit-report.js';

const criterion = 'F-aaaaaaaa/AC-bbbbbbbb';
const selector = '[covers:F-aaaaaaaa/AC-bbbbbbbb] verifies the feature';

function binding(): TestBinding {
  return {criterion, framework: 'vitest', file: 'tests/proof/example.test.ts', selector, carrier: 'title'};
}

function vitestReport(cases: readonly TestCaseObservation[]): JUnitReport {
  const report = new Map() as JUnitReport;
  Object.defineProperty(report, 'cases', {value: Object.freeze(cases), enumerable: false});
  return report;
}

function observation(input: Omit<TestCaseObservation, 'files'>): TestCaseObservation {
  return {...input, files: ['tests/proof/example.test.ts']};
}

describe('current exact binding observations', () => {
  test('[covers:F-058/AC-139] exact live bindings and observations determine criterion proof', () => {
    const view = reduceTestBindings([binding()], vitestReport([
      observation({name: `outer suite ${selector}`, sourceTitle: selector, status: 'pass'}),
    ]));

    expect(view).toEqual([expect.objectContaining({state: 'verified', matched: 1, pass: 1})]);
  });

  test('does not synthesize a source title from a nested Vitest full name', () => {
    const view = reduceTestBindings([binding()], vitestReport([
      observation({name: `outer suite ${selector}`, status: 'pass'}),
    ]));

    expect(view).toEqual([expect.objectContaining({state: 'unverified', matched: 0, pass: 0})]);
  });

  test('does not infer a duplicate same-file Vitest leaf title from nested full names', () => {
    const view = reduceTestBindings([binding()], vitestReport([
      observation({name: `first nested ${selector}`, sourceTitle: selector, status: 'pass'}),
      observation({name: `second nested ${selector}`, sourceTitle: selector, status: 'pass'}),
    ]));

    expect(view).toEqual([expect.objectContaining({state: 'unverified', matched: 0, pass: 0})]);
  });

  test('keeps a full-name exact match when another explicit leaf title is ambiguous', () => {
    const view = reduceTestBindings([binding()], vitestReport([
      observation({name: selector, sourceTitle: selector, status: 'pass'}),
      observation({name: `nested duplicate ${selector}`, sourceTitle: selector, status: 'pass'}),
    ]));

    expect(view).toEqual([expect.objectContaining({state: 'verified', matched: 1, pass: 1})]);
  });

  test('compares entity-decoded JUnit names exactly without a source-title fallback', () => {
    const report = parseJUnitReport('<testcase file="tests/proof/example.test.ts" name="[covers:F-aaaaaaaa/AC-bbbbbbbb] A &amp; B"/>');
    const exact = {...binding(), selector: '[covers:F-aaaaaaaa/AC-bbbbbbbb] A & B'};
    const nestedOnly = {...binding(), selector: 'B'};

    expect(reduceTestBindings([exact], report)[0]).toMatchObject({state: 'verified', pass: 1});
    expect(reduceTestBindings([nestedOnly], report)[0]).toMatchObject({state: 'unverified', matched: 0});
  });

  test('keeps fail/error dominance, accepts a pass, and leaves skipped-only cases unverified', () => {
    const cases = (status: TestCaseObservation['status']) => reduceTestBindings([binding()], vitestReport([
      observation({name: selector, status}),
    ]))[0];

    expect(cases('pass')).toMatchObject({state: 'verified', pass: 1});
    expect(cases('fail')).toMatchObject({state: 'failed', fail: 1});
    expect(cases('error')).toMatchObject({state: 'failed', error: 1});
    expect(cases('skip')).toMatchObject({state: 'unverified', skip: 1});
    expect(reduceTestBindings([binding()], vitestReport([
      observation({name: selector, status: 'pass'}),
      observation({name: selector, status: 'fail'}),
    ]))[0]).toMatchObject({state: 'failed', pass: 1, fail: 1});
  });
});
