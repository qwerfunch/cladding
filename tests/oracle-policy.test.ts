// Cladding · unit tests for oracle/policy.ts — the risk-weighted oracle
// requirement (Lever 1). The SINGLE source of truth the SPEC_CONFORMANCE
// detector and `clad oracle --required` both resolve through, so these tests
// pin the precedence (oracle_policy > require_oracles > nothing), the
// deterministic sampling, and the worklist derivation.

import {describe, expect, test} from 'vitest';

import {
  oracleRequired,
  requiredOracleWorklist,
  resolveOraclePolicy,
  sampleHit,
} from '../src/oracle/policy.js';
import type {AcceptanceCriterion, Project, Spec} from '../src/spec/types.js';

const project = (p: Partial<Project>): Project => ({name: 'p', language: 'typescript', ...p});
const ac = (id: string, ears?: string, oracle_refs?: string[]): AcceptanceCriterion =>
  ({id, ears, oracle_refs} as unknown as AcceptanceCriterion);

describe('resolveOraclePolicy — precedence', () => {
  test('nothing set ⇒ NO mandate (inert default)', () => {
    const r = resolveOraclePolicy(project({}));
    expect(r.mandateActive).toBe(false);
    expect(r.exhaustive).toBe(false);
    expect(r.sample).toBe(0);
  });

  test('require_oracles:true ⇒ EXHAUSTIVE (sample 1.0)', () => {
    const r = resolveOraclePolicy(project({require_oracles: true}));
    expect(r.mandateActive).toBe(true);
    expect(r.exhaustive).toBe(true);
    expect(r.sample).toBe(1);
  });

  test('empty oracle_policy:{} ⇒ risk-weighted: always_ears defaults to [unwanted], sample 0', () => {
    const r = resolveOraclePolicy(project({oracle_policy: {}}));
    expect(r.mandateActive).toBe(true);
    expect(r.exhaustive).toBe(false);
    expect([...r.alwaysEars]).toEqual(['unwanted']);
    expect(r.sample).toBe(0);
  });

  test("[covers:F-bdcd90/AC-002] oracle_policy WINS over require_oracles when both present", () => {
    const r = resolveOraclePolicy(project({require_oracles: true, oracle_policy: {sample: 0}}));
    expect(r.exhaustive).toBe(false); // not the legacy exhaustive
    expect(r.sample).toBe(0);
    expect([...r.alwaysEars]).toEqual(['unwanted']);
  });

  test('sample is clamped to [0,1] and NaN/neg ⇒ 0', () => {
    expect(resolveOraclePolicy(project({oracle_policy: {sample: 2}})).sample).toBe(1);
    expect(resolveOraclePolicy(project({oracle_policy: {sample: -3}})).sample).toBe(0);
    expect(resolveOraclePolicy(project({oracle_policy: {sample: Number.NaN}})).sample).toBe(0);
  });
});

describe('sampleHit — deterministic', () => {
  test("[covers:F-bdcd90/AC-003] stable: same key ⇒ same verdict across calls", () => {
    const a = sampleHit('F-001.AC-001', 0.5);
    const b = sampleHit('F-001.AC-001', 0.5);
    expect(a).toBe(b);
  });

  test('boundaries: sample 0 ⇒ never, sample 1 ⇒ always', () => {
    for (const k of ['x', 'y', 'F-9.AC-9', 'zzz']) {
      expect(sampleHit(k, 0)).toBe(false);
      expect(sampleHit(k, 1)).toBe(true);
    }
  });

  test('approximates the fraction over many keys (0.2 within tolerance)', () => {
    let hits = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (sampleHit(`F-001.AC-${i}`, 0.2)) hits++;
    const rate = hits / N;
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.25);
  });
});

describe('oracleRequired', () => {
  const none = resolveOraclePolicy(project({}));
  const exhaustive = resolveOraclePolicy(project({require_oracles: true}));
  const riskW = resolveOraclePolicy(project({oracle_policy: {always_ears: ['unwanted'], sample: 0}}));

  test("[covers:F-bdcd90/AC-005] no mandate ⇒ never required", () => {
    expect(oracleRequired(none, 'F-001', ac('AC-001', 'unwanted'))).toBe(false);
  });

  test('exhaustive ⇒ always required regardless of EARS', () => {
    expect(oracleRequired(exhaustive, 'F-001', ac('AC-001', 'ubiquitous'))).toBe(true);
  });

  test("[covers:F-bdcd90/AC-001] risk-weighted: always_ears member (unwanted) required; non-member with sample 0 not", () => {
    expect(oracleRequired(riskW, 'F-001', ac('AC-001', 'unwanted'))).toBe(true);
    expect(oracleRequired(riskW, 'F-001', ac('AC-002', 'ubiquitous'))).toBe(false);
  });

  test('sample 1.0 ⇒ even non-always EARS required', () => {
    const all = resolveOraclePolicy(project({oracle_policy: {sample: 1}}));
    expect(oracleRequired(all, 'F-001', ac('AC-001', 'ubiquitous'))).toBe(true);
  });
});

describe('requiredOracleWorklist', () => {
  const spec = (p: Partial<Project>, features: unknown[]): Spec =>
    ({project: project(p), features} as unknown as Spec);

  test('no mandate ⇒ empty worklist', () => {
    const rows = requiredOracleWorklist(spec({}, [
      {id: 'F-001', status: 'done', acceptance_criteria: [ac('AC-001', 'unwanted')]},
    ]));
    expect(rows).toEqual([]);
  });

  test('risk-weighted: only unwanted AC listed; hasOracle reflects oracle_refs; planned feature skipped', () => {
    const rows = requiredOracleWorklist(spec({oracle_policy: {always_ears: ['unwanted'], sample: 0}}, [
      {
        id: 'F-001', status: 'done', acceptance_criteria: [
          ac('AC-001', 'unwanted'), // required, no oracle
          ac('AC-002', 'ubiquitous'), // not required
          ac('AC-003', 'unwanted', ['tests/oracle/x.test.ts']), // required, has oracle
        ],
      },
      {id: 'F-002', status: 'planned', acceptance_criteria: [ac('AC-004', 'unwanted')]}, // skipped (not done)
    ]));
    expect(rows.map((r) => `${r.acId}:${r.reason}:${r.hasOracle}`)).toEqual([
      'AC-001:always:false',
      'AC-003:always:true',
    ]);
  });

  test('exhaustive ⇒ every done AC listed with reason "exhaustive"', () => {
    const rows = requiredOracleWorklist(spec({require_oracles: true}, [
      {id: 'F-001', status: 'done', acceptance_criteria: [ac('AC-001', 'ubiquitous'), ac('AC-002')]},
    ]));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === 'exhaustive')).toBe(true);
  });
});

// ─── F-551a1c — scale-graduated report-only default ───

describe('graduated default (F-551a1c)', () => {
  test('a grown project (>=8 done) with no declared policy gains a REPORT-ONLY risk-weighted mandate', () => {
    const r = resolveOraclePolicy(project({}), 8);
    expect(r.mandateActive).toBe(true);
    expect(r.reportOnly).toBe(true);
    expect([...r.alwaysEars]).toEqual(['unwanted']);
    expect(r.sample).toBe(0);
  });

  test('below the scale gate (7 done) the default stays inert', () => {
    const r = resolveOraclePolicy(project({}), 7);
    expect(r.mandateActive).toBe(false);
  });

  test('an explicit require_oracles: false is the project saying NO — never graduated', () => {
    const r = resolveOraclePolicy(project({require_oracles: false}), 50);
    expect(r.mandateActive).toBe(false);
  });

  test('explicit policies are never report-only', () => {
    expect(resolveOraclePolicy(project({oracle_policy: {}}), 50).reportOnly).toBe(false);
    expect(resolveOraclePolicy(project({require_oracles: true}), 50).reportOnly).toBe(false);
  });
});
