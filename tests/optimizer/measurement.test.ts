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
  test('the injected reader feeds BOTH slice and baseline — one universe, honest ratio', () => {
    // Pre-v0.7.1 the slice read the real fs while the baseline read the
    // injected reader, so a virtual module inflated the shrink factor. With
    // one reader the module text lands on both sides: a module that fits the
    // budget makes the slice ≈ naive + metadata (ratio ≈ 1, NOT a big shrink).
    const s = spec([feat('F-aaa111', 'a', ['pkg/a.py'])]);
    const read = (p: string): string | null =>
      p === 'pkg/a.py' ? 'x'.repeat(8000) : null;

    const result = measureGraphEfficiency(s, read);

    expect(result.features).toHaveLength(1);
    const row = result.features[0];
    if (row === undefined) {
      throw new Error('expected a measured feature row');
    }
    // 8000 chars fits the default budget: the code rides the slice, so the
    // slice cannot be dramatically smaller than naive — the honest reading.
    expect(row.sliceTokens).toBeGreaterThan(2000); // the module text is IN the slice
    expect(row.contextRatio).toBeGreaterThan(0.8);
    expect(row.contextRatio).toBeCloseTo(row.sliceTokens / row.naiveTokens, 5);
  });

  test('splits cap-driven shrink from structural shrink (honest attribution)', () => {
    const features = [
      feat('F-aaa111', 'a', ['pkg/a.py']),
      feat('F-bbb222', 'b', ['pkg/b.py'], ['F-aaa111']),
      feat('F-ccc333', 'c', ['pkg/c.py'], ['F-bbb222']),
    ];
    const s = spec(features);
    // 40k-char modules: naive ≈ 10k tokens, the 3000-token default budget
    // clips the code — the "shrink" is the cap's arithmetic, and the report
    // must say so instead of selling it as graph value.
    const source: Record<string, string> = {
      'pkg/a.py': 'x'.repeat(40000),
      'pkg/b.py': 'y'.repeat(40000),
      'pkg/c.py': 'z'.repeat(40000),
    };
    const read = (p: string): string | null => source[p] ?? null;

    const result = measureGraphEfficiency(s, read);

    expect(result.measured).toBe(features.length);
    expect(result.context.truncatedCount).toBe(3);
    expect(result.context.fitsCount).toBe(0);
    // Cap-driven shrink is real arithmetic (naive >> capped slice)…
    expect(result.context.medianShrinkTruncated).toBeGreaterThan(1);
    expect(result.context.medianShrinkFactor).toBeGreaterThan(1);
    // …but the UNCAPPED structural slice is naive + metadata, ratio ≈≥ 1 —
    // the graph does not structurally shrink the bytes.
    expect(result.context.medianStructuralRatio).toBeGreaterThanOrEqual(0.9);
    for (const row of result.features) {
      expect(row.budgetSaturated).toBe(true);
      expect(row.structuralTokens).toBeGreaterThan(row.sliceTokens);
    }

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

  test('a fitting feature counts as fits (no cap attribution) and structural == budgeted', () => {
    const s = spec([feat('F-eee555', 'e', ['pkg/e.py'])]);
    const read = (p: string): string | null => (p === 'pkg/e.py' ? 'x'.repeat(800) : null);

    const result = measureGraphEfficiency(s, read);

    expect(result.context.fitsCount).toBe(1);
    expect(result.context.truncatedCount).toBe(0);
    const row = result.features[0];
    if (row === undefined) throw new Error('expected a row');
    expect(row.budgetSaturated).toBe(false);
    // identical content; only the serialized budget.max_tokens digits differ (~3 tokens)
    expect(Math.abs(row.structuralTokens - row.sliceTokens)).toBeLessThanOrEqual(5);
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
