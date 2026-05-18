// Cladding · stage_3.2 Perf
//
// Reference implementation of Ironclad iron-law.md stage_3.2.
//   pass criteria: performance budget runner exit 0
//   determinism: probabilistic (timing noise)
//   llm cost: 0
//
// Same project-owned-script pattern as smoke — toolchain.gates.perf
// defaults to `npm run perf`. Missing script → skipped exitCode 2.

import process from 'node:process';

import {execaSync} from 'execa';

import {detectToolchain} from './toolchain/detect.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {isNpmScriptDefined} from './util.js';

const STAGE = 'stage_3.2';

export function runPerf(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.perf;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no perf runner registered for language '${toolchain.language}'`,
    };
  }
  if (cmd === 'npm' && args[0] === 'run' && !isNpmScriptDefined(cwd, args[args.length - 1])) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: 'perf npm script not defined'};
  }
  let proc;
  try {
    proc = execaSync(cmd, [...args], {cwd, reject: false});
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {stage: STAGE, pass: false, exitCode: 2, stderr: `'${cmd}' not installed`};
    }
    throw err;
  }
  const exitCode = proc.exitCode ?? 1;
  const pass = exitCode === 0;
  const result: StageResult = {stage: STAGE, pass, exitCode};
  if (!pass) return {...result, stderr: (proc.stderr ?? '').toString().trim()};
  return result;
}

const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runPerf();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
