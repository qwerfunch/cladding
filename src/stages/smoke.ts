// Cladding · stage_3.1 Smoke
//
// Reference implementation of Ironclad iron-law.md stage_3.1.
//   pass criteria: smoke / e2e test runner exit 0
//   determinism: probabilistic (real I/O)
//   llm cost: 0 (heuristic interpretation may consume 1 in T9)
//
// Smoke is intentionally project-owned: cladding's default is to call
// `npm run smoke` (or the toolchain's equivalent script). When no
// such script exists, the stage returns exitCode 2 ('skipped') rather
// than failing — running a stage with no implementation is not the
// project author's fault.

import process from 'node:process';

import {execaSync} from 'execa';

import {detectToolchain} from './toolchain/detect.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {isNpmScriptDefined, missingToolSkip} from './util.js';

const STAGE = 'stage_3.1';

export function runSmoke(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.smoke;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no smoke runner registered for language '${toolchain.language}'`,
    };
  }
  // npm run <missing-script> exits 1 with `--silent` and no stderr — pre-check
  // package.json so skipped looks like skipped, not fail.
  if (cmd === 'npm' && args[0] === 'run' && !isNpmScriptDefined(cwd, args[args.length - 1])) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'smoke npm script not defined'};
  }
  const proc = execaSync(cmd, [...args], {cwd, reject: false});
  // execaSync(reject:false) RETURNS (does not throw) on a missing binary;
  // detect ENOENT on the result so a missing runner skips, not false-fails.
  const skip = missingToolSkip(STAGE, cmd, proc);
  if (skip) return skip;
  const exitCode = proc.exitCode ?? 1;
  const pass = exitCode === 0;
  const result: StageResult = {stage: STAGE, pass, exitCode};
  if (!pass) return {...result, stderr: (proc.stderr ?? '').toString().trim()};
  return result;
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runSmoke();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
