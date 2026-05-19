// Cladding · `clad benchmark` — naive vs optimized token cost
//
// Measures the size of the spec context that would be sent to an LLM
// in two modes:
//   - naive   : whole spec.yaml as-is
//   - optimized: pruned to one focus feature plus transitive deps
//                (T11a pruning)
//
// Token estimation: we use a coarse char-count / 4 heuristic (English
// average). The point is the *ratio*, not the absolute number.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {pruneToFeature} from '../optimizer/prune.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

/**
 * Coarse English-token estimate (char count / 4).
 *
 * Exported so test suites can pin the heuristic explicitly — the
 * `clad benchmark` output's "tokens" figures only make sense relative
 * to a documented estimator.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface BenchmarkResult {
  readonly featureId: string;
  readonly naiveBytes: number;
  readonly optimizedBytes: number;
  readonly naiveTokens: number;
  readonly optimizedTokens: number;
  readonly reductionPercent: number;
}

/**
 * Measures naive-vs-optimized spec context size for `featureId` under `cwd`.
 *
 * @param cwd - Project root containing spec.yaml + optional sharded
 *              spec/features/ tree.
 * @param featureId - Target feature for the per-call pruning ratio.
 * @returns Byte counts, approximate token counts, and the reduction
 *          percent (positive when pruning helps).
 */
export function benchmark(cwd: string, featureId: string): BenchmarkResult {
  const naiveYaml = readFileSync(join(cwd, 'spec.yaml'), 'utf8');
  const spec = loadSpec(cwd);
  const pruned = pruneToFeature(spec, featureId);
  const optimizedYaml = JSON.stringify(pruned, null, 2);
  const naiveBytes = naiveYaml.length;
  const optimizedBytes = optimizedYaml.length;
  const reductionPercent = ((naiveBytes - optimizedBytes) / naiveBytes) * 100;
  return {
    featureId,
    naiveBytes,
    optimizedBytes,
    naiveTokens: approxTokens(naiveYaml),
    optimizedTokens: approxTokens(optimizedYaml),
    reductionPercent,
  };
}

// CLI entry — `tsx cli/benchmark.ts F-001` or `npm run benchmark F-001`.
const isCliEntry =
  !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED &&
  import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const featureId = process.argv[2];
  if (!featureId) {
    pulse('fail', 'benchmark', 'feature id required (e.g. F-001)');
    process.exit(2);
  } else {
    const result = benchmark('.', featureId);
    console.log(JSON.stringify(result, null, 2));
    pulse(
      'pass',
      'benchmark',
      `${featureId}: ${result.reductionPercent.toFixed(1)}% reduction` +
        ` (${result.naiveTokens} → ${result.optimizedTokens} tokens)`,
    );
    process.exit(0);
  }
}
