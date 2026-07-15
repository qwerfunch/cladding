// Cladding · stage_2.1 Unit
//
// Reference implementation of Ironclad iron-law.md stage_2.1.
//   pass criteria: unit test runner exit 0, all suites pass
//   determinism: deterministic
//   llm cost: 0
//
// Polyglot — TS→vitest, Python→pytest, Rust→cargo test, Go→go test, …
// The actual runner is resolved by `detectToolchain` per project manifest.

import {randomBytes} from 'node:crypto';
import {unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import process from 'node:process';

import {execaSync} from 'execa';

import {withFindings} from './finding-parser.js';
import {getOrRunSharedCoverage, isTestRunPrimed, unitActionFromCoverage} from './test-run-cache.js';
import {resolveStageCommand} from './toolchain/scoped-command.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';
import {vacuousDoneFindings} from './vacuous-tests.js';

const STAGE = 'stage_2.1';

/** Options for the unit stage — the shared command options plus the guard flag. */
export interface UnitStageOptions extends CommandStageOptions {
  /**
   * F-b81d203e — under --strict, run the vacuous-test guard: a done feature
   * whose declared test files ALL fail to execute a passing test makes the gate
   * RED (so `clad done` reverts it). Absent/false → the plain exit-code behavior,
   * byte-for-byte unchanged (no extra reporter, no temp file, no spec load).
   */
  readonly strict?: boolean;
}

/** True when the resolved runner is vitest (the only runner the guard understands). */
function isVitestRunner(cmd: string, args: readonly string[]): boolean {
  return cmd === 'vitest' || cmd.endsWith('/vitest') || args.includes('vitest');
}

/**
 * Returns true only when a successful runner output definitively reports that
 * every aggregate test count was zero. Multiple summaries can occur in npm
 * workspaces; any positive count prevents a false alarm.
 */
function reportsZeroExecutedTests(proc: {readonly stdout?: unknown; readonly stderr?: unknown}): boolean {
  const output = `${String(proc.stdout ?? '')}\n${String(proc.stderr ?? '')}`;
  const counts: number[] = [];
  const patterns = [
    /^\s*#\s*tests\s+(\d+)\s*$/gim,
    /^\s*ℹ\s+tests\s+(\d+)\s*$/gim,
    /^\s*Tests:\s+.*?\b(\d+)\s+total\b.*$/gim,
  ];
  for (const pattern of patterns) {
    for (const match of output.matchAll(pattern)) counts.push(Number(match[1]));
  }
  return counts.length > 0 && counts.every((count) => count === 0);
}

/**
 * Gate-scoped dedup fast path (F-49f6f2d2). On a primed vitest gate, the unit
 * stage reuses the ONE shared coverage+dual-json vitest run the coverage stage
 * (stage_2.2) will also fold — so `clad check --tier=pre-push` runs the suite
 * once, not twice (issue #215). Returns a unit StageResult when it can serve the
 * reuse-pass, or null to fall through to the unit stage's own tests-only run:
 *   - the coverage command does not resolve, or is not vitest → null (own run);
 *   - the shared run's binary is missing → null (the own run reports the skip);
 *   - the shared run is not green → null (AC-8c5a2fb0: a coverage-threshold-only
 *     miss must not be mis-attributed to the unit stage; own tests-only run
 *     attributes correctly);
 *   - the shared run is GREEN → run the vacuous-test guard against the shared
 *     json when `guardOn` and return the guarded pass/fail. NEVER returns a
 *     passing unit result before the guard (AC-6b2d81f7 — the #216 defect).
 *
 * @param opts - The unit stage's options (for coverage-command resolution + cwd).
 * @param cwd - The gate's working directory (shared-run key + guard spec root).
 * @param guardOn - True under --strict on a vitest runner: run the vacuous guard.
 */
function tryReuseSharedRun(opts: UnitStageOptions, cwd: string, guardOn: boolean): StageResult | null {
  // The shared run IS the coverage command (+ the guard's dual json reporter), so
  // resolve THAT command. An unresolvable / non-vitest coverage gate → own run.
  let covCmd: string | undefined;
  let covArgs: readonly string[] | undefined;
  try {
    ({cmd: covCmd, args: covArgs} = resolveStageCommand('coverage', opts));
  } catch {
    return null;
  }
  if (!covCmd || !covArgs || !isVitestRunner(covCmd, covArgs)) return null;
  // Capture the narrowed values as consts so the build closure sees `string` /
  // `readonly string[]` (a `let` narrowing does not flow into the closure).
  const runCmd = covCmd;
  const baseArgs = covArgs;
  // Spawn (or fold) the one shared run. vitest reporters are orthogonal to
  // --coverage, so one invocation yields the coverage report AND per-test json.
  const shared = getOrRunSharedCoverage(cwd, (jsonFile) =>
    execaSync(runCmd, [...baseArgs, '--reporter=default', '--reporter=json', `--outputFile=${jsonFile}`], {
      cwd,
      reject: false,
    }),
  );
  if (!shared) return null; // cwd mismatch / unprimed → own run
  const {proc, jsonFile} = shared;
  // Missing binary → let the own-run path surface the honest skip (exit 2).
  if (missingToolSkip(STAGE, covCmd, proc, baseArgs)) return null;
  const covResult = ranToolResult(STAGE, proc);
  if (unitActionFromCoverage(covResult) === 'fallback') return null; // not green → own tests-only run
  // reuse-pass: the shared run is GREEN. Under --strict the vacuous-test guard
  // (F-b81d203e) is MANDATORY here — evaluate it on the shared json BEFORE
  // returning any passing unit result (AC-6b2d81f7). vacuousDoneFindings is total.
  if (guardOn) {
    const findings = vacuousDoneFindings(jsonFile, cwd);
    if (findings.length > 0) {
      return {stage: STAGE, pass: false, exitCode: 1, findings, stderr: findings[0].message};
    }
  }
  return {stage: STAGE, pass: true, exitCode: 0};
}

/**
 * Runs the project's unit-test suite and returns an Ironclad-shaped result.
 *
 * Under --strict on a vitest project (F-b81d203e), the runner is invoked with a
 * dual reporter — the default reporter stays on stdout (human-readable,
 * AC-4f3d74ee) while a json reporter writes per-test results to a temp file. On
 * an otherwise-GREEN run, {@link vacuousDoneFindings} escalates a done feature
 * whose declared tests never executed a passing test to a blocking finding. Any
 * ambiguity falls back to the plain exit-code behavior (AC-1a0b1b26).
 *
 * @param opts - Optional cwd / cmd / args override and the strict guard flag.
 * @returns A stage result.
 * @see iron-law.md stage_2.1 — "unit tests exit 0, all suites pass".
 * @see toolchain/detect.ts — polyglot test runner chain.
 */
export function runUnit(opts: UnitStageOptions = {}): StageResult {
  const {cwd = '.', strict = false} = opts;
  let cmd: string | undefined;
  let args: readonly string[] | undefined;
  let language: string;
  try {
    ({cmd, args, language} = resolveStageCommand('test', opts));
  } catch (err) {
    return {stage: STAGE, pass: false, exitCode: 1, stderr: (err as Error).message};
  }
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no unit test runner registered for language '${language}'`,
    };
  }
  // Guard applies only under --strict on a vitest runner (the only path we can
  // capture per-file json for). Otherwise the invocation is unchanged.
  const testIsVitest = isVitestRunner(cmd, args);
  const guardOn = strict && testIsVitest;
  // Dedup fast path (F-49f6f2d2): on a primed vitest gate, reuse the ONE shared
  // coverage+dual-json run stage_2.2 also folds, so the suite runs once (#215).
  // Only when the TEST runner is vitest too — a jest/pytest unit gate must not be
  // served by a vitest coverage run. Returns null → own-run path below (unchanged).
  if (isTestRunPrimed() && testIsVitest) {
    const reused = tryReuseSharedRun(opts, cwd, guardOn);
    if (reused) return reused;
  }
  let jsonFile: string | undefined;
  let runArgs: readonly string[] = args;
  if (guardOn) {
    jsonFile = join(tmpdir(), `clad-vitest-${process.pid}-${randomBytes(6).toString('hex')}.json`);
    // Dual reporter: default → stdout (human view preserved), json → temp file
    // (per-test results for the vacuity check). Verified on vitest 4.x.
    runArgs = [...args, '--reporter=default', '--reporter=json', `--outputFile=${jsonFile}`];
  }
  try {
    const proc = execaSync(cmd, [...runArgs], {cwd, reject: false});
    // execaSync(reject:false) RETURNS (does not throw) on a missing binary;
    // detect ENOENT on the result so a missing tool skips, not false-fails.
    const skip = missingToolSkip(STAGE, cmd, proc, runArgs);
    if (skip) return skip;
    // The tool RAN. Map its result to cladding's pass/fail/skip contract:
    // any non-zero exit → blocking fail (1), never the tool's raw 2 (= skip).
    // ADDITIVE (F-b7873005): on failure, attach structured findings parsed from
    // the test runner's own output — the raw stderr is preserved unchanged.
    const base = withFindings('unit', ranToolResult(STAGE, proc), proc);
    if (strict && base.pass && reportsZeroExecutedTests(proc)) {
      const finding = {
        detector: 'VACUOUS_TESTS',
        severity: 'error' as const,
        message: 'The unit test command exited successfully but reported zero executed tests.',
      };
      return {stage: STAGE, pass: false, exitCode: 1, findings: [finding], stderr: finding.message};
    }
    // Vacuous-test guard (F-b81d203e): only escalate an otherwise-GREEN run — a
    // failing suite already blocks; a vacuous run exits 0 (skips don't fail) yet
    // must not read as verified. vacuousDoneFindings is total (never throws).
    if (guardOn && base.pass && jsonFile) {
      const findings = vacuousDoneFindings(jsonFile, cwd);
      if (findings.length > 0) {
        return {stage: STAGE, pass: false, exitCode: 1, findings, stderr: findings[0].message};
      }
    }
    return base;
  } finally {
    if (jsonFile) {
      try {
        unlinkSync(jsonFile);
      } catch {
        /* best-effort cleanup — a missing temp file is not a gate concern */
      }
    }
  }
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runUnit();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
