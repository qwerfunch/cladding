// Cladding · stages · current-gate testcase ledger sealed at the stage seam.

import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {isCurrentGateTestcaseLedger} from '../../src/proof/testcase-ledger.js';
import {
  captureCurrentJUnitProof,
  captureCurrentVitestProof,
  clearTestRunCache,
  currentGateTestcaseLedger,
  primeTestRunCache,
} from '../../src/stages/test-run-cache.js';

const roots: string[] = [];
const INPUT_SHA = 'a'.repeat(64);
const STALE_INPUT_SHA = 'b'.repeat(64);
const SELECTOR = '[covers:F-aaaaaaaa/AC-bbbbbbbb] current observation';

function workspaceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-current-gate-ledger-'));
  roots.push(root);
  mkdirSync(join(root, 'tests'), {recursive: true});
  return root;
}

function vitestBytes(root: string, assertionResults: readonly object[], extra: object = {}): string {
  return JSON.stringify({
    testResults: [{name: join(root, 'tests', 'live.test.ts'), assertionResults}],
    ...extra,
  });
}

/** Runs one gate-shaped Vitest capture and reads the seam result inside it. */
function vitestLedgerResult(root: string, reportBytes: string, requested: string = INPUT_SHA) {
  const report = join(root, 'current-vitest.json');
  primeTestRunCache(root, INPUT_SHA);
  try {
    writeFileSync(report, reportBytes);
    captureCurrentVitestProof(root, report, ['vitest', 'run']);
    return currentGateTestcaseLedger(root, requested);
  } finally {
    clearTestRunCache();
  }
}

function junitLedgerResult(root: string, reportBytes: string, requested: string = INPUT_SHA) {
  mkdirSync(join(root, '.cladding'), {recursive: true});
  writeFileSync(join(root, '.cladding', 'config.yaml'), 'gate:\n  test_report: current.junit.xml\n');
  primeTestRunCache(root, INPUT_SHA);
  try {
    writeFileSync(join(root, 'current.junit.xml'), reportBytes);
    captureCurrentJUnitProof(root, ['vitest', 'run']);
    return currentGateTestcaseLedger(root, requested);
  } finally {
    clearTestRunCache();
  }
}

function reasonsOf(result: ReturnType<typeof currentGateTestcaseLedger>): readonly string[] {
  return 'reasons' in result ? result.reasons : [];
}

afterEach(() => {
  clearTestRunCache();
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('current-gate testcase ledger', () => {
  test('[covers:F-208eaa79/AC-d452908b] seals validated Vitest and JUnit gate evidence into exact carriers', () => {
    const root = workspaceRoot();
    const vitest = vitestLedgerResult(root, vitestBytes(root, [
      {status: 'passed', title: SELECTOR, ancestorTitles: [], opaqueOutput: 'report-body-must-not-leak'},
    ], {opaqueReport: 'report-body-must-not-leak'}));
    const junit = junitLedgerResult(root, `<testsuite><testcase file="tests/live.test.ts" name="${SELECTOR}"/></testsuite>`);

    if (!('ledger' in vitest)) throw new Error(`expected a sealed Vitest ledger: ${reasonsOf(vitest).join('; ')}`);
    if (!('ledger' in junit)) throw new Error(`expected a sealed JUnit ledger: ${reasonsOf(junit).join('; ')}`);
    expect(isCurrentGateTestcaseLedger(vitest.ledger)).toBe(true);
    expect(vitest.ledger).toMatchObject({
      identity: expect.stringMatching(/^[a-f0-9]{64}$/),
      inputSha256: INPUT_SHA,
      format: 'vitest-json',
    });
    expect(vitest.ledger.cases).toEqual([expect.objectContaining({
      name: SELECTOR, files: ['tests/live.test.ts'], status: 'pass',
    })]);
    expect(junit.ledger).toMatchObject({format: 'junit-xml'});
    expect(Object.isFrozen(vitest.ledger)).toBe(true);
    expect(Object.isFrozen(vitest.ledger.cases)).toBe(true);
    expect(Object.isFrozen(vitest.ledger.cases[0]!)).toBe(true);
    // The seal projects carriers only; report bytes and argv stay at the seam.
    expect(JSON.stringify(vitest.ledger)).not.toContain('report-body-must-not-leak');
    expect(JSON.stringify(vitest.ledger)).not.toContain('vitest","run');
    // A hand-built copy of the same fields is not gate evidence.
    expect(isCurrentGateTestcaseLedger(JSON.parse(JSON.stringify(vitest.ledger)))).toBe(false);
  });

  test('[covers:F-208eaa79/AC-d452908b] refuses empty or carrierless ledgers instead of treating absence as safe', () => {
    const root = workspaceRoot();

    expect(reasonsOf(vitestLedgerResult(root, vitestBytes(root, []))))
      .toEqual(['current-gate report has an empty case ledger']);
    expect(reasonsOf(junitLedgerResult(root, '<testsuite></testsuite>')))
      .toEqual(['current-gate report has an empty case ledger']);
    expect(reasonsOf(junitLedgerResult(root, `<testsuite><testcase name="${SELECTOR}"/></testsuite>`)))
      .toEqual(['current-gate report has no case-level carriers']);
  });

  test('[covers:F-208eaa79/AC-d452908b] reduces malformed, absent, stale, and unparseable evidence to stable unknown reasons', () => {
    const root = workspaceRoot();
    const passing = vitestBytes(root, [{status: 'passed', title: SELECTOR, ancestorTitles: []}]);

    expect(reasonsOf(vitestLedgerResult(root, passing, 'invalid')))
      .toEqual(['current-gate expected input SHA-256 is malformed']);
    // No gate session at all: the seam never reaches for a persisted report.
    expect(reasonsOf(currentGateTestcaseLedger(root, INPUT_SHA)))
      .toEqual(['current-gate proof evidence is missing or unbranded']);
    // A stale seal resolves to no evidence for THIS closure, never to another run's.
    expect(reasonsOf(vitestLedgerResult(root, passing, STALE_INPUT_SHA)))
      .toEqual(['current-gate proof evidence is missing or unbranded']);
    expect(reasonsOf(vitestLedgerResult(root, '{broken json')))
      .toEqual(['current-gate Vitest report cannot be parsed']);
    expect(reasonsOf(junitLedgerResult(root, 'not xml at all')))
      .toEqual(['current-gate JUnit report cannot be parsed']);
  });
});
