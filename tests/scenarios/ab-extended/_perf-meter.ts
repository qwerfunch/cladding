// Cladding · scenarios · ab-extended · perf meter (v0.3.49, F-0144b9)
//
// Performance-dimension instrumentation for the 30-feature A/B test.
// Wraps captureSnapshot calls with performance.now() timing + tracks
// cumulative metrics per milestone:
//
//   - capture duration (ms)
//   - source LoC (.ts/.tsx under src/)
//   - test LoC (.ts/.tsx under tests/)
//   - spec LoC (.yaml under spec/ + spec.yaml)
//   - file count (per category)
//   - spec-to-code ratio (cladding only)
//
// All metrics are deterministic functions of the tmpdir state — re-running
// the test against the same state produces the same numbers (except for
// `captureDurationMs` which is wall-clock; the renderer presents it as a
// rough bucket, not an exact value, so jitter doesn't break snapshots).

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';

import {captureSnapshot, type AbSnapshot} from '../ab/_ab-metrics.js';

export interface PerfMetrics {
  /** Wall-clock duration of captureSnapshot in ms. Renderer rounds to a bucket. */
  readonly captureDurationMs: number;
  readonly srcFiles: number;
  readonly srcLoc: number;
  readonly testFiles: number;
  readonly testLoc: number;
  readonly specFiles: number;
  readonly specLoc: number;
  /** spec/(src+test) ratio — cladding-only signal of governance overhead. */
  readonly specToCodeRatio: number;
}

export interface PerfSnapshot {
  readonly group: 'A' | 'B';
  readonly milestone: number;
  readonly snapshot: AbSnapshot;
  readonly perf: PerfMetrics;
}

function countFiles(rootAbs: string, ext: readonly string[]): {files: number; loc: number} {
  let files = 0;
  let loc = 0;
  function walk(absDir: string): void {
    let entries: readonly string[];
    try {
      entries = readdirSync(absDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.cladding' || name.startsWith('.')) continue;
      const childAbs = join(absDir, name);
      let s;
      try {
        s = statSync(childAbs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        walk(childAbs);
        continue;
      }
      if (!ext.some((e) => name.endsWith(e))) continue;
      files++;
      try {
        loc += readFileSync(childAbs, 'utf8').split('\n').length;
      } catch {
        // ignore
      }
    }
  }
  walk(rootAbs);
  return {files, loc};
}

export function measurePerf(cwd: string, captureDurationMs: number): PerfMetrics {
  const src = countFiles(join(cwd, 'src'), ['.ts', '.tsx']);
  const tests = countFiles(join(cwd, 'tests'), ['.ts', '.tsx']);
  const spec = countFiles(join(cwd, 'spec'), ['.yaml', '.yml']);
  // include spec.yaml at root
  try {
    const masterLoc = readFileSync(join(cwd, 'spec.yaml'), 'utf8').split('\n').length;
    spec.files += 1;
    spec.loc += masterLoc;
  } catch {
    // not present in vanilla — no-op
  }
  const codeLoc = src.loc + tests.loc;
  const specToCodeRatio = codeLoc > 0 ? spec.loc / codeLoc : 0;
  return {
    captureDurationMs,
    srcFiles: src.files,
    srcLoc: src.loc,
    testFiles: tests.files,
    testLoc: tests.loc,
    specFiles: spec.files,
    specLoc: spec.loc,
    specToCodeRatio,
  };
}

/** Times a captureSnapshot call and returns the combined PerfSnapshot. */
export function capturePerfSnapshot(group: 'A' | 'B', milestone: number, cwd: string): PerfSnapshot {
  const start = performance.now();
  const snapshot = captureSnapshot(group, 'M1', cwd);
  const duration = performance.now() - start;
  const perf = measurePerf(cwd, duration);
  return {group, milestone, snapshot, perf};
}
