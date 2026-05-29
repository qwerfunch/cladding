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

import {detectToolchain} from './toolchain/detect.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_2.1';

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
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.test;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no unit test runner registered for language '${toolchain.language}'`,
    };
  }
  let proc;
  try {
    proc = execaSync(cmd, [...args], {cwd, reject: false});
  } catch (err) {
    // Tool binary absent (ENOENT) → skip (exitCode 2), matching
    // smoke/perf/visual. Without this, a missing test runner surfaces as
    // a crash / false failure instead of an honest skip.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {stage: STAGE, pass: false, exitCode: 2, stderr: `'${cmd}' not installed`};
    }
    throw err;
  }
  const exitCode = proc.exitCode ?? 1;
  const pass = exitCode === 0;
  const result: StageResult = {stage: STAGE, pass, exitCode};
  if (!pass) {
    const stderr = (proc.stderr ?? '').toString().trim();
    if (stderr) return {...result, stderr};
  }
  return result;
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runUnit();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
