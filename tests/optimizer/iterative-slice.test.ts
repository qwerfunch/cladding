import {describe, test, expect} from 'vitest';
import {buildIterativeImpactSlice} from '../../src/optimizer/iterative-slice.js';
import type {Spec} from '../../src/spec/types.js';

// --- synthetic spec builders (spec-only; no implementation knowledge) ---

function feature(id: string, dependsOn: string[], acNum: number): unknown {
  const num = String(acNum).padStart(6, '0');
  return {
    id,
    slug: id.toLowerCase().replace(/[^a-z0-9]/g, ''),
    title: id,
    status: 'done',
    depends_on: dependsOn,
    modules: [`src/${id}.ts`],
    acceptance_criteria: [
      {
        id: `AC-${num}`,
        ears: 'ubiquitous',
        text: 't',
        test_refs: [`tests/${id}.test.ts#x`],
      },
    ],
  };
}

function makeSpec(features: unknown[]): Spec {
  return {
    schema: '0.1',
    project: {name: 't', language: 'typescript'},
    features,
  } as unknown as Spec;
}

// Chain: A <- B <- C  (B depends_on A; C depends_on B)
function chainSpec(): Spec {
  return makeSpec([
    feature('F-A', [], 1),
    feature('F-B', ['F-A'], 2),
    feature('F-C', ['F-B'], 3),
  ]);
}

// A <- B only (B depends_on A; nothing beyond)
function singleDependentSpec(): Spec {
  return makeSpec([feature('F-A', [], 1), feature('F-B', ['F-A'], 2)]);
}

const ALLOWED_STOPS = [
  'exhaustion',
  'coverage',
  'marginal-yield',
  'max-depth',
] as const;

describe('buildIterativeImpactSlice', () => {
  test('widens a narrow miss: a 2-hop dependent chain reaches depth 2', () => {
    const result = buildIterativeImpactSlice(chainSpec(), 'F-A');

    expect('not_found' in result).toBe(false);
    if ('not_found' in result) throw new Error('expected a slice, got a miss');

    expect(result.depthUsed).toBeGreaterThanOrEqual(2);

    const ids = result.slice.impacted.map((i) => i.id).sort();
    expect(result.slice.impacted).toHaveLength(2);
    expect(ids).toContain('F-B');
    expect(ids).toContain('F-C');
  });

  test('stops at depth 1 when the radius is already complete', () => {
    const result = buildIterativeImpactSlice(singleDependentSpec(), 'F-A');

    expect('not_found' in result).toBe(false);
    if ('not_found' in result) throw new Error('expected a slice, got a miss');

    expect(result.depthUsed).toBe(1);
    expect(result.stoppedBy).toBe('coverage');
    expect(result.analysis.coverage).toBe(1);
  });

  test('stops on exhaustion when the reachable graph boundary is hit', () => {
    const result = buildIterativeImpactSlice(chainSpec(), 'F-A', {
      coverageThreshold: 1.1,
    });

    expect('not_found' in result).toBe(false);
    if ('not_found' in result) throw new Error('expected a slice, got a miss');

    expect(result.stoppedBy).toBe('exhaustion');
    expect(result.analysis.frontierExhausted).toBe(true);
    // depthUsed is the depth where the 0-add ring occurred: depth 3.
    expect(result.depthUsed).toBe(3);
  });

  test('reports depthUsed, stoppedBy, and coverage', () => {
    const result = buildIterativeImpactSlice(chainSpec(), 'F-A');

    expect('not_found' in result).toBe(false);
    if ('not_found' in result) throw new Error('expected a slice, got a miss');

    expect(typeof result.depthUsed).toBe('number');
    expect(ALLOWED_STOPS).toContain(result.stoppedBy);
    expect(result.analysis.coverage).toBeGreaterThanOrEqual(0);
    expect(result.analysis.coverage).toBeLessThanOrEqual(1);
    expect(typeof result.analysis.totalKnownDependents).toBe('number');
    expect(result.analysis.totalKnownDependents).toBeGreaterThanOrEqual(0);
  });

  test('is deterministic for identical spec state', () => {
    const opts = {coverageThreshold: 0.9} as const;
    const a = buildIterativeImpactSlice(chainSpec(), 'F-A', opts);
    const b = buildIterativeImpactSlice(chainSpec(), 'F-A', opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('a coverage or exhaustion stop never reports coverage below the threshold', () => {
    const cases: {spec: Spec; query: string; threshold: number; opts?: {coverageThreshold?: number}}[] = [
      {spec: chainSpec(), query: 'F-A', threshold: 0.9},
      {spec: singleDependentSpec(), query: 'F-A', threshold: 0.9},
      {spec: chainSpec(), query: 'F-A', threshold: 1.1, opts: {coverageThreshold: 1.1}},
    ];

    for (const c of cases) {
      const result = buildIterativeImpactSlice(c.spec, c.query, c.opts);
      expect('not_found' in result).toBe(false);
      if ('not_found' in result) throw new Error('expected a slice, got a miss');

      if (result.stoppedBy === 'coverage') {
        // No false completeness: a coverage stop must actually meet the bar.
        expect(result.analysis.coverage).toBeGreaterThanOrEqual(c.threshold);
      }
      if (result.stoppedBy === 'exhaustion') {
        expect(result.analysis.frontierExhausted).toBe(true);
      }
    }
  });

  test('an unresolved query returns the canonical not_found miss', () => {
    const result = buildIterativeImpactSlice(chainSpec(), 'F-nope');

    expect('not_found' in result).toBe(true);
    if (!('not_found' in result)) throw new Error('expected a miss, got a slice');

    expect(result.not_found).toBe('F-nope');
    expect(Array.isArray(result.accepted_forms)).toBe(true);
    expect(typeof result.discovery).toBe('string');
  });

  test('zero known dependents stops honestly: no-known-dependents + coverage null, never a vacuous 1.0 (F-c6a32fff)', () => {
    // Old behavior actively claimed completeness here: coverage=1 via the
    // vacuous 0-denominator arm + stoppedBy 'coverage' — identical for a blank
    // ledger and a genuine leaf, and identical to a real full-coverage stop.
    const spec = chainSpec(); // F-A ← F-B ← F-C chain; F-C (the tip) has no dependents
    const result = buildIterativeImpactSlice(spec, 'F-C');
    if ('not_found' in result) throw new Error('expected a slice');
    expect(result.stoppedBy).toBe('no-known-dependents');
    expect(result.analysis.coverage).toBeNull();
    expect(result.analysis.totalKnownDependents).toBe(0);
    expect(result.analysis.frontierExhausted).toBe(true);
    expect(result.slice.impacted).toEqual([]);
  });
});
