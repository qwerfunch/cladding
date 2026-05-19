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

import {detectToolchain} from './toolchain/detect.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_2.2';

export function runCov(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.coverage;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no coverage runner registered for language '${toolchain.language}'`,
    };
  }
  const proc = execaSync(cmd, [...args], {cwd, reject: false});
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
  const result = runCov();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
