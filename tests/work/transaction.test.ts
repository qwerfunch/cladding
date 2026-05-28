// Cladding · unit tests for src/work/transaction.ts (0.4.3, F-89406c)
//
// Uses a tmpdir-seeded spec/features/ tree. Persona prompts load
// from cladding's real src/agents/ (loadPersona defaults to the
// package root). Drift detectors are stubbed via the test-only
// registerDetector / clearDetectors so we can assert pass vs fail
// branches without scaffolding the full cladding spec under tmpdir.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors, registerDetector} from '../../src/stages/drift.js';
import type {DriftDetector} from '../../src/stages/types.js';
import {
  abandonWork,
  completeWork,
  enterWork,
  FeatureNotFoundError,
  InvalidStatusTransitionError,
} from '../../src/work/transaction.js';
import {getActiveWork, listActiveWork} from '../../src/work/registry.js';

function seedFeature(cwd: string, filename: string, body: string): void {
  const dir = join(cwd, 'spec', 'features');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, filename), body);
}

const ALWAYS_PASS: DriftDetector = {name: 'TEST_ALWAYS_PASS', run: () => []};
const ALWAYS_FAIL: DriftDetector = {
  name: 'TEST_ALWAYS_FAIL',
  run: () => [{detector: 'TEST_ALWAYS_FAIL', severity: 'error' as const, path: 'src/demo.ts', message: 'fabricated drift'}],
};

describe('enterWork', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-work-tx-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('transitions planned → in_progress and returns persona + scope + entered status', () => {
    seedFeature(
      cwd,
      'demo-aaaaaa.yaml',
      [
        'id: F-aaaaaa',
        'slug: demo',
        'status: planned',
        'modules:',
        '  - src/demo.ts',
        'acceptance_criteria: []',
        '',
      ].join('\n'),
    );
    const result = enterWork({featureId: 'F-aaaaaa', intent: 'fix the demo', cwd});
    expect(result.status).toBe('entered');
    expect(result.scope.slug).toBe('demo');
    expect(result.scope.modules).toEqual(['src/demo.ts']);
    expect(result.personaId).toBe('specialists');
    expect(result.personaPrompt.length).toBeGreaterThan(0);
    // Status flipped on disk
    const yaml = readFileSync(join(cwd, 'spec', 'features', 'demo-aaaaaa.yaml'), 'utf8');
    expect(yaml).toContain('status: in_progress');
    // Registry entry created
    expect(getActiveWork(cwd, 'F-aaaaaa')).toBeDefined();
  });

  test('second enter_work on the same featureId returns resumed without re-emitting', () => {
    seedFeature(
      cwd,
      'demo-bbbbbb.yaml',
      'id: F-bbbbbb\nslug: demo\nstatus: planned\nmodules: []\nacceptance_criteria: []\n',
    );
    const first = enterWork({featureId: 'F-bbbbbb', cwd});
    expect(first.status).toBe('entered');
    const second = enterWork({featureId: 'F-bbbbbb', cwd});
    expect(second.status).toBe('resumed');
    // Registry has exactly one entry for this id
    expect(listActiveWork(cwd).filter((w) => w.featureId === 'F-bbbbbb')).toHaveLength(1);
  });

  test('throws InvalidStatusTransitionError on archived feature', () => {
    seedFeature(
      cwd,
      'old-cccccc.yaml',
      'id: F-cccccc\nslug: old\nstatus: archived\nmodules: []\nacceptance_criteria: []\n',
    );
    expect(() => enterWork({featureId: 'F-cccccc', cwd})).toThrow(InvalidStatusTransitionError);
  });

  test('throws FeatureNotFoundError on unknown featureId', () => {
    mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
    expect(() => enterWork({featureId: 'F-zzzzzz', cwd})).toThrow(FeatureNotFoundError);
  });
});

describe('completeWork', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-work-tx-'));
    clearDetectors();
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('pass branch — status in_progress → done, evidence appended, registry cleared', () => {
    seedFeature(
      cwd,
      'demo-dddddd.yaml',
      [
        'id: F-dddddd',
        'slug: demo',
        'status: planned',
        'modules:',
        '  - src/demo.ts',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    text: "demo AC"',
        '',
      ].join('\n'),
    );
    enterWork({featureId: 'F-dddddd', cwd});
    registerDetector(ALWAYS_PASS);

    const result = completeWork({
      featureId: 'F-dddddd',
      evidence: [{acId: 'AC-001', ref: 'tests/demo.test.ts'}],
      cwd,
    });
    expect(result.status).toBe('completed');
    expect(result.evidenceAppended).toBe(1);
    const yaml = readFileSync(join(cwd, 'spec', 'features', 'demo-dddddd.yaml'), 'utf8');
    expect(yaml).toContain('status: done');
    expect(yaml).toContain('tests/demo.test.ts');
    expect(getActiveWork(cwd, 'F-dddddd')).toBeUndefined();
  });

  test('fail branch — iron law error keeps status in_progress + returns findings + registry stays', () => {
    seedFeature(
      cwd,
      'demo-eeeeee.yaml',
      [
        'id: F-eeeeee',
        'slug: demo',
        'status: planned',
        'modules:',
        '  - src/demo.ts',
        'acceptance_criteria: []',
        '',
      ].join('\n'),
    );
    enterWork({featureId: 'F-eeeeee', cwd});
    registerDetector(ALWAYS_FAIL);

    const result = completeWork({featureId: 'F-eeeeee', cwd});
    expect(result.status).toBe('iron_law_failed');
    expect(result.driftFindings.length).toBeGreaterThan(0);
    expect(result.driftFindings[0].detector).toBe('TEST_ALWAYS_FAIL');
    const yaml = readFileSync(join(cwd, 'spec', 'features', 'demo-eeeeee.yaml'), 'utf8');
    expect(yaml).toContain('status: in_progress');
    expect(getActiveWork(cwd, 'F-eeeeee')).toBeDefined(); // not removed
  });

  test('0.4.5 — gates array carries all four L1 results (drift + type + lint + arch)', () => {
    seedFeature(
      cwd,
      'demo-aabbcc.yaml',
      'id: F-aabbcc\nslug: demo\nstatus: planned\nmodules: []\nacceptance_criteria: []\n',
    );
    enterWork({featureId: 'F-aabbcc', cwd});
    registerDetector(ALWAYS_PASS);

    const result = completeWork({featureId: 'F-aabbcc', cwd});
    // Shape assertions only — the per-gate pass/skipped values depend on
    // whether the test environment's ancestor directories carry a
    // toolchain manifest detectToolchain resolves (cwd is a tmpdir but
    // detectToolchain only inspects the immediate cwd, so the L1 gates
    // typically skip; this assertion stays robust either way).
    expect(result.gates).toHaveLength(4);
    expect(result.gates.map((g) => g.name).sort()).toEqual(['arch', 'drift', 'lint', 'type']);

    const drift = result.gates.find((g) => g.name === 'drift')!;
    expect(drift.skipped).toBe(false);
    expect(drift.pass).toBe(true);

    for (const name of ['type', 'lint', 'arch'] as const) {
      const g = result.gates.find((x) => x.name === name)!;
      // Either the gate skipped (no toolchain) or it ran. Both branches
      // are valid; the contract is that `pass` is set in both cases.
      expect(typeof g.pass).toBe('boolean');
      if (g.skipped) expect(g.pass).toBe(true);
    }
  });

  test('0.4.5 — drift failure surfaces in gates[] and blocks completion', () => {
    seedFeature(
      cwd,
      'demo-bbccdd.yaml',
      'id: F-bbccdd\nslug: demo\nstatus: planned\nmodules: []\nacceptance_criteria: []\n',
    );
    enterWork({featureId: 'F-bbccdd', cwd});
    registerDetector(ALWAYS_FAIL);

    const result = completeWork({featureId: 'F-bbccdd', cwd});
    expect(result.status).toBe('iron_law_failed');
    const driftGate = result.gates.find((g) => g.name === 'drift')!;
    expect(driftGate.pass).toBe(false);
    // drift must be in the failed-gates list (other gates may or may
    // not also fail depending on toolchain detection).
    expect(result.gates.filter((g) => !g.pass).map((g) => g.name)).toContain('drift');
  });
});

describe('abandonWork', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-work-tx-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
    clearDetectors();
  });

  test('removes the registry entry and preserves status as in_progress', () => {
    seedFeature(
      cwd,
      'demo-ffffff.yaml',
      'id: F-ffffff\nslug: demo\nstatus: planned\nmodules: []\nacceptance_criteria: []\n',
    );
    enterWork({featureId: 'F-ffffff', cwd});
    const result = abandonWork({featureId: 'F-ffffff', reason: 'user changed direction', cwd});
    expect(result.status).toBe('abandoned');
    expect(getActiveWork(cwd, 'F-ffffff')).toBeUndefined();
    const yaml = readFileSync(join(cwd, 'spec', 'features', 'demo-ffffff.yaml'), 'utf8');
    expect(yaml).toContain('status: in_progress');
  });

  test('returns not_active when no transaction is open for the featureId', () => {
    const result = abandonWork({featureId: 'F-aaaaaa', reason: 'never entered', cwd});
    expect(result.status).toBe('not_active');
  });
});
