// Cladding · stage_2.1 Unit
//
// Reference implementation of Ironclad iron-law.md stage_2.1.
//   pass criteria: unit test runner exit 0, all suites pass
//   determinism: deterministic
//   llm cost: 0
//
// Polyglot — TS→vitest, Python→pytest, Rust→cargo test, Go→go test, …
// The actual runner is resolved by `detectToolchain` per project manifest.

import process from 'node:process';

import {execaSync} from 'execa';

import {resolveStageCommand} from './toolchain/scoped-command.js';
import {isTestRunPrimed, memoizeTestRun, unitActionFromCoverage} from './test-run-cache.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {isMissingBinary, missingToolSkip, ranToolResult} from './util.js';

const STAGE = 'stage_2.1';

/** Resolve a stage command without throwing — returns null on any failure/absence. */
function tryResolve(stage: 'test' | 'coverage', opts: CommandStageOptions): {cmd: string; args: readonly string[]} | null {
  try {
    const {cmd, args} = resolveStageCommand(stage, opts);
    return cmd && args ? {cmd, args} : null;
  } catch {
    return null;
  }
}

/**
 * Runs the project's unit-test suite and returns an Ironclad-shaped result.
 *
 * @param opts - Optional cwd / cmd / args override.
 * @returns A stage result.
 * @see iron-law.md stage_2.1 — "unit tests exit 0, all suites pass".
 * @see toolchain/detect.ts — polyglot test runner chain.
 */
export function runUnit(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  // Test-run dedup (F-97abf5db): in a primed gate, the coverage stage will run
  // the full suite anyway. Share that one run — trigger it here (the unit stage
  // runs first) and reuse on GREEN. A non-green coverage run falls through to a
  // tests-only run below, so a coverage-threshold miss is never mis-attributed
  // to the unit stage. Unprimed (standalone / MCP) skips this entirely.
  if (isTestRunPrimed()) {
    const cov = tryResolve('coverage', opts);
    if (cov) {
      const covProc = memoizeTestRun(cwd, () => execaSync(cov.cmd, [...cov.args], {cwd, reject: false}));
      const action = unitActionFromCoverage({exitCode: covProc.exitCode, missingTool: isMissingBinary(covProc)});
      if (action === 'reuse-pass') return {stage: STAGE, pass: true, exitCode: 0};
    }
  }
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
  const proc = execaSync(cmd, [...args], {cwd, reject: false});
  // execaSync(reject:false) RETURNS (does not throw) on a missing binary;
  // detect ENOENT on the result so a missing tool skips, not false-fails.
  const skip = missingToolSkip(STAGE, cmd, proc);
  if (skip) return skip;
  // The tool RAN. Map its result to cladding's pass/fail/skip contract:
  // any non-zero exit → blocking fail (1), never the tool's raw 2 (= skip).
  return ranToolResult(STAGE, proc);
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runUnit();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
