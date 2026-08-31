// Cladding · gate golden matrix (F-d49585)
//
// Characterization lock for runCheckStages — the single function that defines
// the 0/1/2 exit contract for `clad check` AND the `clad done` gate. The 0.6
// work (gate_run events, skip-policy generalization, attestation marker) all
// rewire this function; this matrix freezes today's contract first so each of
// those lands as an intentional, visible diff to THIS file rather than a
// silent regression. The contract pinned here (from clad.ts):
//
//   status  : pass when r.pass; else skip when exitCode === 2; else fail
//   worst   : max exitCode over FAILED stages only — a skip's 2 never raises
//             worst (skip is non-blocking by invariant)
//   strict  : a skipped stage the spec DEMANDS is promoted to RED, appended
//             as an extra 'Verification' fail entry (F-67d2e9 demand table):
//               stage_1.1 — project.language declared AND ≥1 done feature
//               stage_2.1 — ≥1 done feature declaring test_refs
//               stage_2.3 — ≥1 done AC declaring oracle_refs
//               stage_2.4 — deliverable is_safe_to_smoke:true AND ≥1 done feature
//             No demand ⇒ skip stays non-blocking (the false-RED defense).
//   unknown : unknown tier → {worst: 2, anyFailed: true}
//
// All stage runners are stubbed (no toolchain spawn); the whole matrix runs in
// well under a second.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type StageResult = {
  pass: boolean;
  exitCode: number;
  stderr?: string;
  findings?: readonly {detector: string; severity: 'error' | 'warn' | 'info'; path?: string; message: string}[];
};
const PASS: StageResult = {pass: true, exitCode: 0};
const FAIL: StageResult = {pass: false, exitCode: 1};
const SKIP: StageResult = {pass: false, exitCode: 2};

// One swappable vi.fn per stage so each matrix case re-targets outcomes
// without re-mocking modules (vi.mock is hoisted and per-file).
const stubs = {
  'stage_1.1': vi.fn(() => PASS),
  'stage_1.2': vi.fn(() => PASS),
  'stage_1.3': vi.fn(() => PASS),
  'stage_1.4': vi.fn(() => PASS),
  'stage_1.5': vi.fn(() => PASS),
  'stage_1.6': vi.fn(() => PASS),
  'stage_2.1': vi.fn(() => PASS),
  'stage_2.2': vi.fn(() => PASS),
  'stage_2.3': vi.fn(() => PASS),
  'stage_2.4': vi.fn(() => PASS),
  'stage_3.1': vi.fn(() => PASS),
  'stage_3.2': vi.fn(() => PASS),
  'stage_3.3': vi.fn(() => PASS),
  'stage_4.1': vi.fn(() => PASS),
  'stage_4.2': vi.fn(() => PASS),
} as const;
type StageName = keyof typeof stubs;

vi.mock('../../src/stages/type.js', () => ({runType: (...a: unknown[]) => stubs['stage_1.1'](...(a as []))}));
vi.mock('../../src/stages/lint.js', () => ({runLint: (...a: unknown[]) => stubs['stage_1.2'](...(a as []))}));
vi.mock('../../src/stages/drift.js', () => ({runDrift: (...a: unknown[]) => stubs['stage_1.3'](...(a as []))}));
vi.mock('../../src/stages/commit.js', () => ({runCommit: (...a: unknown[]) => stubs['stage_1.4'](...(a as []))}));
vi.mock('../../src/stages/arch.js', () => ({runArch: (...a: unknown[]) => stubs['stage_1.5'](...(a as []))}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: (...a: unknown[]) => stubs['stage_1.6'](...(a as []))}));
vi.mock('../../src/stages/unit.js', () => ({runUnit: (...a: unknown[]) => stubs['stage_2.1'](...(a as []))}));
vi.mock('../../src/stages/cov.js', () => ({runCov: (...a: unknown[]) => stubs['stage_2.2'](...(a as []))}));
vi.mock('../../src/stages/spec-conformance.js', () => ({runSpecConformance: (...a: unknown[]) => stubs['stage_2.3'](...(a as []))}));
vi.mock('../../src/stages/deliverable-smoke.js', () => ({runDeliverableSmoke: (...a: unknown[]) => stubs['stage_2.4'](...(a as []))}));
vi.mock('../../src/stages/smoke.js', () => ({runSmoke: (...a: unknown[]) => stubs['stage_3.1'](...(a as []))}));
vi.mock('../../src/stages/perf.js', () => ({runPerf: (...a: unknown[]) => stubs['stage_3.2'](...(a as []))}));
vi.mock('../../src/stages/visual.js', () => ({runVisual: (...a: unknown[]) => stubs['stage_3.3'](...(a as []))}));
vi.mock('../../src/stages/audit.js', () => ({runAudit: (...a: unknown[]) => stubs['stage_4.1'](...(a as []))}));
vi.mock('../../src/stages/uat.js', () => ({runUat: (...a: unknown[]) => stubs['stage_4.2'](...(a as []))}));

// Swappable spec: default = NO tested-done features (guard never fires);
// the guard variant swaps in one done feature declaring test_refs.
// gate_run emission (F-b84c38) is part of the pinned contract — mocked so the
// matrix never writes to the real repo ledger, asserted explicitly below.
const writeAttestationMock = vi.fn((..._args: unknown[]) => true);
const detectorCatalogSha256Mock = vi.fn((..._args: unknown[]) => 'a'.repeat(64));
vi.mock('../../src/spec/attestation.js', () => ({
  writeAttestation: (...a: unknown[]) => writeAttestationMock(...a),
  detectorCatalogSha256: (...a: unknown[]) => detectorCatalogSha256Mock(...a),
}));

const recordEventMock = vi.fn();
vi.mock('../../src/events/log.js', () => ({recordEvent: (...a: unknown[]) => recordEventMock(...(a as []))}));

const loadSpecMock = vi.fn((): unknown => ({features: []}));
vi.mock('../../src/spec/load.js', () => ({loadSpec: (...a: unknown[]) => loadSpecMock(...(a as []))}));

// This characterization suite owns only stage-exit behavior.  Keep its F6
// boundary deliberately schema-0.1/lightweight so each all-stubbed matrix run
// neither compiles the repository nor walks proof closures; dedicated F6 tests
// cover those real compiler/workspace paths.
const compileSpecWorkspaceMock = vi.fn(() => ({schemaVersion: '0.1', nodes: [], edges: [], diagnostics: []}));
vi.mock('../../src/spec/compiler/compile.js', () => ({
  compileSpecWorkspace: (...a: unknown[]) => compileSpecWorkspaceMock(...(a as [])),
}));
vi.mock('../../src/assurance/workspace.js', () => ({
  workspaceClosureSeals: () => ({inputSha256: 'a'.repeat(64), closures: {schemaVersion: '0.1', features: []}}),
  currentProofBindingsFromWorkspace: () => [],
  currentExecutableProofFeatureIdsFromWorkspace: () => [],
  hasApplicableSchema02TestCriteria: () => false,
  currentProofViewsFromWorkspace: () => [],
  workspaceProfileSnapshot: () => ({inputSha256: 'a'.repeat(64), complete: true, closureInput: {schemaVersion: '0.1', features: []}, incompleteAddresses: []}),
  createWorkspaceAttestations: () => [],
}));

const clad = await import('../../src/cli/clad.js');

const TESTED_DONE_SPEC = {
  features: [
    {id: 'F-aaa', status: 'done', acceptance_criteria: [{id: 'AC-1', test_refs: ['tests/x.test.ts']}]},
  ],
};

interface JsonDoc {
  tier: string;
  worst: number;
  anyFailed: boolean;
  stages: {stage: string; status: 'pass' | 'skip' | 'fail'; exitCode: number}[];
}

function runMatrixCase(tier: string, strict: boolean): JsonDoc {
  let stdout = '';
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((s: unknown) => {
    stdout += String(s);
    return true;
  }) as never);
  try {
    const out = clad.runCheckStages({tier, strict, json: true});
    const doc = JSON.parse(stdout) as JsonDoc;
    // The return value and the JSON document must agree — `clad done` consumes
    // the return value, agents consume the JSON; divergence would be drift.
    expect(doc.worst).toBe(out.worst);
    expect(doc.anyFailed).toBe(out.anyFailed);
    return doc;
  } finally {
    spy.mockRestore();
  }
}

function setAll(result: StageResult): void {
  for (const fn of Object.values(stubs)) fn.mockImplementation(() => result);
}

beforeEach(() => {
  setAll(PASS);
  loadSpecMock.mockImplementation(() => ({features: []}));
});
afterEach(() => vi.clearAllMocks());

describe('gate golden matrix — runCheckStages exit contract (F-d49585)', () => {
  const TIERS = Object.entries(clad.TIER_STAGES) as [string, readonly StageName[]][];

  test('baseline: all stages pass → worst 0, nothing failed, every tier runs exactly its TIER_STAGES', () => {
    for (const [tier, expectedStages] of TIERS) {
      for (const strict of [false, true]) {
        const doc = runMatrixCase(tier, strict);
        expect(doc.worst, `${tier} strict=${strict}`).toBe(0);
        expect(doc.anyFailed, `${tier} strict=${strict}`).toBe(false);
        expect(doc.stages.map((s) => s.stage), `${tier} stage list`).toEqual([...expectedStages]);
        expect(doc.stages.every((s) => s.status === 'pass'), `${tier} all pass`).toBe(true);
      }
    }
  });

  test('single-stage FAIL: exactly that stage reports fail; worst 1; gate blocks — every stage × every tier × strict on/off', () => {
    for (const [tier, stages] of TIERS) {
      for (const failing of stages) {
        for (const strict of [false, true]) {
          setAll(PASS);
          stubs[failing].mockImplementation(() => FAIL);
          const doc = runMatrixCase(tier, strict);
          expect(doc.worst, `${tier}/${failing} strict=${strict}`).toBe(1);
          expect(doc.anyFailed, `${tier}/${failing} strict=${strict}`).toBe(true);
          const failed = doc.stages.filter((s) => s.status === 'fail').map((s) => s.stage);
          expect(failed, `${tier}/${failing} only the failing stage fails`).toEqual([failing]);
        }
      }
    }
  });

  test('single-stage SKIP is non-blocking: worst stays 0 — every stage × tier × strict EXCEPT the pinned unit-guard promotion', () => {
    for (const [tier, stages] of TIERS) {
      for (const skipping of stages) {
        for (const strict of [false, true]) {
          setAll(PASS);
          stubs[skipping].mockImplementation(() => SKIP);
          const doc = runMatrixCase(tier, strict);
          // With NO spec demands (empty spec mock: no language, no done
          // features, no oracles, no deliverable) no skip blocks the gate —
          // the demand-gated policy's false-RED defense.
          expect(doc.worst, `${tier}/${skipping} strict=${strict}`).toBe(0);
          expect(doc.anyFailed, `${tier}/${skipping} strict=${strict}`).toBe(false);
          const skipped = doc.stages.filter((s) => s.status === 'skip').map((s) => s.stage);
          expect(skipped, `${tier}/${skipping} only the skipping stage skips`).toEqual([skipping]);
        }
      }
    }
  });

  const DEMAND_SPECS: Record<string, {spec: unknown; stage: StageName}> = {
    'stage_1.1 — declared language + done feature': {
      stage: 'stage_1.1',
      spec: {project: {name: 'x', language: 'typescript'}, features: [{id: 'F-a', status: 'done', acceptance_criteria: []}]},
    },
    'stage_2.1 — done feature declaring test_refs': {
      stage: 'stage_2.1',
      spec: TESTED_DONE_SPEC,
    },
    'stage_2.3 — done AC declaring oracle_refs': {
      stage: 'stage_2.3',
      spec: {features: [{id: 'F-a', status: 'done', acceptance_criteria: [{id: 'AC-1', oracle_refs: ['tests/oracle/x.test.ts']}]}]},
    },
    'stage_2.4 — safe declared deliverable + done feature': {
      stage: 'stage_2.4',
      spec: {
        project: {name: 'x', deliverable: {path: 'bin/app.js', is_safe_to_smoke: true}},
        features: [{id: 'F-a', status: 'done', acceptance_criteria: []}],
      },
    },
  };

  test('[covers:F-d49585/AC-40db4c] strict demand table promotes skips only for declared stage 1.1/2.1/2.3/2.4 demands and keeps non-strict or undemanded skips non-blocking', () => {
    for (const [name, {spec, stage}] of Object.entries(DEMAND_SPECS)) {
      loadSpecMock.mockImplementation(() => spec);
      setAll(PASS);
      stubs[stage].mockImplementation(() => SKIP);
      const doc = runMatrixCase('pre-push', true);
      expect(doc.worst, name).toBe(1);
      expect(doc.anyFailed, name).toBe(true);
      const entries = doc.stages.filter((s2) => s2.stage === stage);
      expect(entries.map((s2) => s2.status), name).toEqual(['skip', 'fail']); // original skip + appended demand entry
    }
  });

  test('demands do NOT fire: non-strict, or no demand in the spec, or the stage outside the tier', () => {
    // non-strict with every demand present
    loadSpecMock.mockImplementation(() => DEMAND_SPECS['stage_2.1 — done feature declaring test_refs'].spec);
    setAll(PASS);
    stubs['stage_2.1'].mockImplementation(() => SKIP);
    expect(runMatrixCase('pre-push', false).worst).toBe(0);

    // strict but the skipping stage has no demand (Cov is never demanded)
    setAll(PASS);
    stubs['stage_2.2'].mockImplementation(() => SKIP);
    expect(runMatrixCase('pre-push', true).worst).toBe(0);

    // strict + demanded stage skipping, but pre-commit tier doesn't run it
    loadSpecMock.mockImplementation(() => TESTED_DONE_SPEC);
    setAll(PASS);
    stubs['stage_2.1'].mockImplementation(() => SKIP);
    expect(runMatrixCase('pre-commit', true).worst).toBe(0);

    // A safe deliverable demand is similarly non-blocking outside strict mode.
    loadSpecMock.mockImplementation(() => DEMAND_SPECS['stage_2.4 — safe declared deliverable + done feature'].spec);
    setAll(PASS);
    stubs['stage_2.4'].mockImplementation(() => SKIP);
    expect(runMatrixCase('pre-push', false).worst).toBe(0);
  });

  test('fail outranks skip when both occur: worst is the failure, skip stays visible in stage statuses', () => {
    setAll(PASS);
    stubs['stage_1.1'].mockImplementation(() => SKIP);
    stubs['stage_1.3'].mockImplementation(() => FAIL);
    const doc = runMatrixCase('pre-push', false);
    expect(doc.worst).toBe(1);
    expect(doc.anyFailed).toBe(true);
    expect(doc.stages.find((s) => s.stage === 'stage_1.1')?.status).toBe('skip');
    expect(doc.stages.find((s) => s.stage === 'stage_1.3')?.status).toBe('fail');
  });

  test('unknown tier → worst 2, anyFailed true, no stages run', () => {
    const doc = runMatrixCase('nightly', false);
    expect(doc.worst).toBe(2);
    expect(doc.anyFailed).toBe(true);
    expect(doc.stages).toEqual([]);
    for (const fn of Object.values(stubs)) expect(fn).not.toHaveBeenCalled();
  });

  test('records compact blocker telemetry without changing the gate matrix', () => {
    setAll(PASS);
    recordEventMock.mockClear();
    runMatrixCase('pre-push', true);
    let gateRuns = recordEventMock.mock.calls.filter((call) => call[1] === 'gate_run');
    expect(gateRuns).toHaveLength(1);
    expect(gateRuns[0][2]).toEqual({
      tier: 'pre-push',
      strict: true,
      worst: 0,
      anyFailed: false,
      blockers: [],
      stopFingerprint: '',
    });

    recordEventMock.mockClear();
    stubs['stage_1.3'].mockImplementation(() => ({
      pass: false,
      exitCode: 1,
      findings: [{detector: 'AC_DRIFT', severity: 'error', path: 'spec/x.yaml', message: 'mismatch'}],
    }));
    runMatrixCase('pre-push', true);
    gateRuns = recordEventMock.mock.calls.filter((call) => call[1] === 'gate_run');
    expect(gateRuns).toHaveLength(1);
    expect(gateRuns[0][2]).toMatchObject({
      tier: 'pre-push',
      strict: true,
      worst: 1,
      anyFailed: true,
      blockers: ['AC_DRIFT'],
    });
    expect((gateRuns[0][2] as {stopFingerprint: string}).stopFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  test('PINNED (F-a5228c): solely-stale drift under strict pre-push is exempted, run counts GREEN, attestation stamps', () => {
    setAll(PASS);
    writeAttestationMock.mockClear();
    stubs['stage_1.3'].mockImplementation(() => ({
      pass: false,
      exitCode: 1,
      findings: [{detector: 'STALE_ATTESTATION', severity: 'warn', message: 'stale'}],
    }) as never);
    const doc = runMatrixCase('pre-push', true);
    expect(doc.worst).toBe(0);
    expect(doc.anyFailed).toBe(false);
    expect(doc.stages.find((s2) => s2.stage === 'stage_1.3')?.status).toBe('pass');
    expect(writeAttestationMock).toHaveBeenCalledTimes(1);
  });

  test('no exemption when drift carries any OTHER failing finding, or in the pre-commit tier', () => {
    // mixed findings → stays RED
    setAll(PASS);
    stubs['stage_1.3'].mockImplementation(() => ({
      pass: false,
      exitCode: 1,
      findings: [
        {detector: 'STALE_ATTESTATION', severity: 'warn', message: 'stale'},
        {detector: 'MISSING_TESTS', severity: 'error', message: 'real'},
      ],
    }) as never);
    expect(runMatrixCase('pre-push', true).worst).toBe(1);

    // pre-commit tier cannot re-attest → solely-stale stays RED under strict
    setAll(PASS);
    stubs['stage_1.3'].mockImplementation(() => ({
      pass: false,
      exitCode: 1,
      findings: [{detector: 'STALE_ATTESTATION', severity: 'warn', message: 'stale'}],
    }) as never);
    expect(runMatrixCase('pre-commit', true).worst).toBe(1);
  });

  test('a plain GREEN strict pre-push run stamps policy identity; non-strict does not', () => {
    setAll(PASS);
    writeAttestationMock.mockClear();
    runMatrixCase('pre-push', true);
    expect(writeAttestationMock).toHaveBeenCalledTimes(1);
    expect(writeAttestationMock.mock.calls[0]?.[2]).toEqual({
      cladding: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      blocking: 'strict',
      detectorsSha256: 'a'.repeat(64),
    });
    writeAttestationMock.mockClear();
    runMatrixCase('pre-push', false);
    expect(writeAttestationMock).not.toHaveBeenCalled();
  });
});
