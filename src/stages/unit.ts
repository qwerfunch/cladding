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
  const guardOn = strict && isVitestRunner(cmd, args);
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
    const skip = missingToolSkip(STAGE, cmd, proc);
    if (skip) return skip;
    // The tool RAN. Map its result to cladding's pass/fail/skip contract:
    // any non-zero exit → blocking fail (1), never the tool's raw 2 (= skip).
    // ADDITIVE (F-b7873005): on failure, attach structured findings parsed from
    // the test runner's own output — the raw stderr is preserved unchanged.
    const base = withFindings('unit', ranToolResult(STAGE, proc), proc);
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
