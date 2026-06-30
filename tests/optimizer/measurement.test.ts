import {describe, test, expect} from 'vitest';
import {measureGraphEfficiency} from '../../src/optimizer/measurement.js';
import type {Spec} from '../../src/spec/types.js';

// Synthetic spec builders. The Spec type carries far more than these tests
// exercise, so we assemble the minimal shape the contract describes and widen
// through `unknown` rather than reaching for `any`.
function feat(
  id: string,
  slug: string,
  modules: string[],
  dependsOn: string[] = [],
): Record<string, unknown> {
  return {
    id,
    slug,
    title: slug.toUpperCase(),
    status: 'done',
    modules,
    depends_on: dependsOn,
    acceptance_criteria: [],
  };
}

function spec(features: Record<string, unknown>[]): Spec {
  return {
    schema: '0.1',
    project: {name: 't', language: 'python'},
    features,
  } as unknown as Spec;
}

describe('measureGraphEfficiency', () => {
  test('computes the slice-vs-naive context ratio per feature', () => {
    const s = spec([feat('F-aaa111', 'a', ['pkg/a.py'])]);
    const read = (p: string): string | null =>
      p === 'pkg/a.py' ? 'x'.repeat(8000) : null;

    const result = measureGraphEfficiency(s, read);

    expect(result.features).toHaveLength(1);
    const row = result.features[0];
    if (row === undefined) {
      throw new Error('expected a measured feature row');
    }
    // A large module source makes the naive baseline (shard JSON + full module
    // text) much bigger than the working-set slice.
    expect(row.naiveTokens).toBeGreaterThan(row.sliceTokens);
    expect(row.contextRatio).toBeLessThan(1);
    expect(row.contextRatio).toBeCloseTo(row.sliceTokens / row.naiveTokens, 5);
  });

  test('aggregates median shrink factor, search depth, and coverage', () => {
    const features = [
      feat('F-aaa111', 'a', ['pkg/a.py']),
      feat('F-bbb222', 'b', ['pkg/b.py'], ['F-aaa111']),
      feat('F-ccc333', 'c', ['pkg/c.py'], ['F-bbb222']),
    ];
    const s = spec(features);
    const source: Record<string, string> = {
      'pkg/a.py': 'x'.repeat(8000),
      'pkg/b.py': 'y'.repeat(9000),
      'pkg/c.py': 'z'.repeat(7000),
    };
    const read = (p: string): string | null => source[p] ?? null;

    const result = measureGraphEfficiency(s, read);

    expect(result.measured).toBe(features.length);
    // Bigger naive source than slice ⇒ shrink factor > 1.
    expect(result.context.medianShrinkFactor).toBeGreaterThan(1);
    expect(typeof result.search.medianDepth).toBe('number');
    expect(result.search.medianDepth).toBeGreaterThanOrEqual(1);
    expect(result.stability.medianCoverage).toBeGreaterThanOrEqual(0);
    expect(result.stability.medianCoverage).toBeLessThanOrEqual(1);
    expect(typeof result.stability.byStopReason).toBe('object');

    const stopReasonSum = Object.values(result.stability.byStopReason).reduce(
      (a, b) => a + b,
      0,
    );
    expect(stopReasonSum).toBeLessThanOrEqual(result.measured);
  });

  test('is deterministic for identical spec and file contents', () => {
    const features = [
      feat('F-aaa111', 'a', ['pkg/a.py']),
      feat('F-bbb222', 'b', ['pkg/b.py'], ['F-aaa111']),
    ];
    const s = spec(features);
    const source: Record<string, string> = {
      'pkg/a.py': 'x'.repeat(5000),
      'pkg/b.py': 'y'.repeat(6000),
    };
    const read = (p: string): string | null => source[p] ?? null;

    const first = measureGraphEfficiency(s, read);
    const second = measureGraphEfficiency(s, read);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test('skips lookup misses without throwing', () => {
    const nullRead = (): string | null => null;

    const empty = spec([]);
    const emptyResult = measureGraphEfficiency(empty, nullRead);
    expect(emptyResult.measured).toBe(0);
    expect(emptyResult.features).toEqual([]);

    // A real feature with no modules and a reader that always misses must be
    // handled gracefully — the feature is still resolvable.
    const noModules = spec([feat('F-ddd444', 'd', [])]);
    expect(() => measureGraphEfficiency(noModules, nullRead)).not.toThrow();
    const noModResult = measureGraphEfficiency(noModules, nullRead);
    expect(noModResult.measured).toBe(1);
  });
});
