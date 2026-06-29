// Cladding · gate-scoped test-run dedup (F-97abf5db).
//
// pre-push runs BOTH the unit stage (`vitest run`) and the coverage stage
// (`vitest run --coverage`) — the full suite executes TWICE (~9.5s + ~10.7s).
// But the coverage run already runs every test, so the unit run is redundant.
//
// This shares ONE coverage run across both stages, keyed by cwd, primed around
// the gate's stage loop (mirrors the run-scoped spec cache F-cd0415). The unit
// stage (2.1) runs first, triggers + caches the coverage run; the coverage
// stage (2.2) gets a cache hit. Sound by construction (see unitActionFromCoverage):
// a GREEN coverage run proves every test passed, so the unit stage reuses it; a
// NON-green run sends the unit stage to a tests-only fallback so a coverage-
// threshold miss is never mis-attributed as a unit-test failure.
//
// Pass-through when no cache is primed (standalone stage call / MCP) → behavior
// is byte-for-byte unchanged. A fresh Map per gate run; the long-lived MCP
// server never serves a stale test result across runs.

import {resolve} from 'node:path';

let cache: Map<string, unknown> | null = null;

export function primeTestRunCache(on: boolean): void {
  cache = on ? new Map() : null;
}

export function isTestRunPrimed(): boolean {
  return cache !== null;
}

/**
 * Run the shared suite memoized by cwd within a primed gate; pass-through when
 * unprimed. Generic so callers get back their full runner result (exitCode,
 * stderr, …) — the cache just dedups the expensive execution.
 */
export function memoizeTestRun<T>(cwd: string, run: () => T): T {
  if (!cache) return run();
  const key = resolve(cwd);
  if (cache.has(key)) return cache.get(key) as T;
  const r = run();
  cache.set(key, r);
  return r;
}

/**
 * Decide what the unit stage should do given the shared coverage run:
 *   - `reuse-pass` — the coverage run was GREEN (exit 0), proving every test
 *     passed; the unit stage reports pass WITHOUT re-running the suite.
 *   - `fallback`   — no coverage runner, the tool was missing, or the run was
 *     non-green; the unit stage must run the tests-only command so a real test
 *     failure is caught and a coverage-threshold-only miss is NOT mis-charged
 *     to the unit stage.
 */
export function unitActionFromCoverage(
  cov: {readonly exitCode?: number; readonly missingTool: boolean} | null,
): 'reuse-pass' | 'fallback' {
  if (!cov || cov.missingTool) return 'fallback';
  return cov.exitCode === 0 ? 'reuse-pass' : 'fallback';
}
