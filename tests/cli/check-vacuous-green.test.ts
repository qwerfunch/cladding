// Fix ① — VACUOUS-GREEN GUARD. Under `--strict`, a `done` feature that declares
// `test_refs` must have had its tests actually RUN. If the Unit stage SKIPPED
// (no test runner installed) while the spec carries tested-done features, the gate
// is RED — "done" must not certify verification that never executed. (A plain
// `someRan` check is too weak: Drift/Commit/Arch/Secret are pure-JS detectors that
// always run, so they would mask the skip.)
import {beforeEach, afterEach, describe, expect, test, vi} from 'vitest';

const pass = () => ({pass: true, exitCode: 0});
const skip = () => ({pass: false, exitCode: 2}); // cladding's skip contract (tool absent)

// Mock the pre-push stage runners: everything passes EXCEPT Unit, which skips.
vi.mock('../../src/stages/type.js', () => ({runType: vi.fn(pass)}));
vi.mock('../../src/stages/lint.js', () => ({runLint: vi.fn(pass)}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: vi.fn(pass)}));
vi.mock('../../src/stages/arch.js', () => ({runArch: vi.fn(pass)}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: vi.fn(pass)}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: vi.fn(skip)}));
vi.mock('../../src/stages/cov.js', () => ({runCov: vi.fn(pass)}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: vi.fn(pass)}));

vi.mock('../../src/spec/load.js', () => ({
  loadSpec: vi.fn(() => ({
    features: [
      // a DONE feature that declares tests → must have been verified
      {id: 'F-aaa', status: 'done', acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/x.test.ts']}]},
      // a PLANNED feature with tests → not yet expected to be verified, must NOT count
      {id: 'F-bbb', status: 'planned', acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/y.test.ts']}]},
    ],
  })),
}));

const clad = await import('../../src/cli/clad.js');

describe('runCheckStages — vacuous-green guard (--strict)', () => {
  let stdout: string;
  beforeEach(() => {
    stdout = '';
    vi.spyOn(process.stdout, 'write').mockImplementation(((s: unknown) => {
      stdout += String(s);
      return true;
    }) as never);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  test('RED when a done feature declares tests but the Unit runner SKIPPED', () => {
    const out = clad.runCheckStages({tier: 'pre-push', strict: true, json: true});
    const doc = JSON.parse(stdout) as {worst: number; stages: {label: string; status: string}[]};
    expect(out.worst).toBeGreaterThanOrEqual(1);
    expect(doc.stages.some((s) => s.label === 'Verification' && s.status === 'fail')).toBe(true);
  });

  test('non-strict keeps the lenient skip-as-pass contract (guard does NOT fire)', () => {
    const out = clad.runCheckStages({tier: 'pre-push', strict: false, json: true});
    const doc = JSON.parse(stdout) as {stages: {label: string}[]};
    expect(out.worst).toBe(0);
    expect(doc.stages.some((s) => s.label === 'Verification')).toBe(false);
  });
});
