// Cladding · stages · shared test-run cache — run-scoped, gate-seam-lifetimed
//
// WHY (issue #215). One `clad check --tier=pre-push` runs the SAME vitest suite
// TWICE: stage_2.1 (unit) spawns `vitest run` and stage_2.2 (coverage) spawns
// `vitest run --coverage`. On cladding's own ~1600-test suite that is the single
// biggest chunk of gate wall-clock. This module lets the unit stage spawn the
// COVERAGE command ONCE — augmented with the vacuous-test guard's dual json
// reporter — and publish that one process so the coverage stage folds the cached
// exit signal instead of re-spawning vitest.
//
// GUARD-COMPATIBLE (the reason PR #216 was rejected). #216 deduped by having the
// unit stage `return {pass:true}` off the shared coverage run, which silently
// disabled the vacuous-test guard (F-b81d203e) on the reuse path. Here the shared
// run ALWAYS carries `--reporter=json --outputFile=<tmp>` so the guard still has
// its per-test input, and unit.ts runs `vacuousDoneFindings` against that json
// BEFORE it may return a passing unit result (AC-6b2d81f7). This module owns only
// the run + its temp-json lifetime; the guard decision stays in unit.ts.
//
// LIFETIME (mirrors detector-result-cache.ts / spec/load.ts). The session is
// primed and cleared ONLY at the gate-run seam — cli/clad.ts runCheckStages —
// and the caller MUST clear in a `finally`. The stage loop is synchronous, so a
// session primed around it and cleared in finally cannot serve a stale run
// mid-gate. The MCP serve layer runs gates via a `bin/clad` subprocess, so the
// session lives entirely inside one process run; tests drive these functions
// in-process, so the finally-clear discipline is mandatory — a leaked session
// would hand one test's run (and its already-unlinked temp json) to the next.

import {randomBytes} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import process from 'node:process';

import type {StageResult} from './types.js';

/** The subset of an `execaSync(…, {reject: false})` result the two stages read —
 *  exit signal for both, plus stdout/stderr for the coverage stage's diagnostics.
 *  Structural (matches deliverable-smoke's `ProcLike`) so the execa result assigns
 *  without a nominal dependency on execa's exported types. */
export interface SharedProc {
  readonly code?: string;
  readonly exitCode?: number | null;
  readonly stdout?: unknown;
  readonly stderr?: unknown;
}

/** One gate's shared vitest run: the process result plus the temp json path the
 *  dual reporter wrote (the vacuous-test guard's input). */
export interface SharedRun {
  readonly proc: SharedProc;
  readonly jsonFile: string;
}

/** The active gate-run session, or null between runs. `cwd` is resolved so a
 *  relative-vs-absolute mismatch never yields a false hit. `run` memoizes the one
 *  shared vitest process; `jsonFile` is tracked separately from `run` so
 *  {@link clearTestRunCache} can unlink it even if the build closure throws after
 *  the path was chosen. */
let session: {readonly cwd: string; run: SharedRun | null; jsonFile: string | null} | null = null;

/**
 * Opens a fresh shared-test-run session for a gate run. Callers MUST pair this
 * with {@link clearTestRunCache} in a `finally` — a primed session that outlives
 * its run would serve one run's (already-unlinked) temp json to the next.
 *
 * @param cwd - The gate run's working directory; resolved for hit comparison.
 */
export function primeTestRunCache(cwd: string): void {
  session = {cwd: resolve(cwd), run: null, jsonFile: null};
}

/** True when a gate has primed a shared-run session (the dedup path is live). */
export function isTestRunPrimed(): boolean {
  return session !== null;
}

/**
 * Runs the shared coverage+dual-json vitest process ONCE per gate and memoizes
 * it, or returns the already-memoized run. Returns null — "the cache is a
 * pass-through, spawn your own" — when no session is primed or when `cwd` does
 * not match the session's (AC-2d4b9e63). The build closure receives the temp json
 * path this module chose (so it can append the reporter args); the path is stored
 * on the session BEFORE the closure runs so a mid-build throw still leaves it for
 * `clearTestRunCache` to unlink.
 *
 * @param cwd - The cwd the caller is running under.
 * @param buildRun - Spawns the shared process, writing per-test json to the given path.
 * @returns The shared run, or null to signal a direct (own) spawn.
 */
export function getOrRunSharedCoverage(cwd: string, buildRun: (jsonFile: string) => SharedProc): SharedRun | null {
  if (!session || session.cwd !== resolve(cwd)) return null;
  if (session.run) return session.run;
  const jsonFile = join(tmpdir(), `clad-shared-vitest-${process.pid}-${randomBytes(6).toString('hex')}.json`);
  // Record the path first: a throw inside buildRun must not orphan the temp file.
  session.jsonFile = jsonFile;
  const proc = buildRun(jsonFile);
  session.run = {proc, jsonFile};
  return session.run;
}

/**
 * Returns this gate's already-memoized shared run without spawning one, or null
 * on a miss (no session, cwd mismatch, or the unit stage never triggered a shared
 * run). The coverage stage uses this to fold the unit stage's run instead of
 * re-spawning vitest; a null means "spawn your own" (byte-identical fallback).
 *
 * @param cwd - The cwd the reader is running under.
 */
export function peekSharedRun(cwd: string): SharedRun | null {
  if (!session || session.cwd !== resolve(cwd)) return null;
  return session.run;
}

/**
 * Decides whether the unit stage may reuse the shared coverage run as its pass,
 * preserving PR #216's sound attribution: reuse ONLY when the shared coverage run
 * went fully green (exit 0). A non-green shared run is ambiguous — a real test
 * failure OR a coverage-threshold-only miss — so the unit stage falls back to its
 * own tests-only command, keeping a coverage miss out of stage_2.1 (AC-8c5a2fb0).
 *
 * @param cov - The shared run mapped to a coverage StageResult (pass + exitCode).
 */
export function unitActionFromCoverage(cov: Pick<StageResult, 'pass' | 'exitCode'>): 'reuse-pass' | 'fallback' {
  return cov.pass && cov.exitCode === 0 ? 'reuse-pass' : 'fallback';
}

/** Closes the active session and unlinks its shared temp json (best-effort — a
 *  missing temp file is not a gate concern). The json's lifetime belongs to the
 *  GATE, not either stage, because both stages read the one shared run. Idempotent
 *  — safe in a `finally` whether or not a session was primed. */
export function clearTestRunCache(): void {
  const file = session?.jsonFile;
  session = null;
  if (file) {
    try {
      unlinkSync(file);
    } catch {
      /* best-effort cleanup — a missing temp file is not a gate concern */
    }
  }
}
