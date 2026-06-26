// Cladding · stage_2.2 Cov
//
// Reference implementation of Ironclad iron-law.md stage_2.2.
//   pass criteria: coverage runner exit 0 (project-owned threshold)
//   determinism: deterministic
//   llm cost: 0
//
// Polyglot — TS→vitest --coverage, Python→coverage, Rust→cargo llvm-cov,
// Go→go test -cover. Threshold enforcement is project-owned (vitest
// config, .coveragerc, etc.); cladding only relays the exit signal.

import process from 'node:process';

import {execaSync} from 'execa';

import {resolveStageCommand} from './toolchain/scoped-command.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';

const STAGE = 'stage_2.2';

export function runCov(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  let cmd: string | undefined;
  let args: readonly string[] | undefined;
  let language: string;
  try {
    ({cmd, args, language} = resolveStageCommand('coverage', opts));
  } catch (err) {
    return {stage: STAGE, pass: false, exitCode: 1, stderr: (err as Error).message};
  }
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no coverage runner registered for language '${language}'`,
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
  const result = runCov();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
