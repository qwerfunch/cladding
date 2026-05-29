// Cladding · stage_1.2 Lint
//
// Reference implementation of Ironclad iron-law.md stage_1.2.
//   pass criteria: linter exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// Polyglot: the lint tool is resolved by `detectToolchain` based on the
// project's manifest. Same shape as stage_1.1; only the gate differs.

import process from 'node:process';

import {execaSync} from 'execa';

import {detectToolchain} from './toolchain/detect.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_1.2';

/**
 * Runs the project's linter and returns an Ironclad-shaped stage result.
 *
 * The tool is resolved in this priority:
 *   1. Explicit `opts.cmd` + `opts.args` (full override)
 *   2. `detectToolchain(cwd).gates.lint` (manifest-driven default)
 *   3. When `language: 'unknown'` and no override → `pass=false, exitCode=2`
 *      with a `stderr` explaining the gap.
 *
 * @param opts - Optional cwd / cmd / args override.
 * @returns A stage result. `pass=true` exactly when `exitCode === 0`.
 * @see iron-law.md stage_1.2 — "linter exit 0, no errors".
 * @see toolchain/detect.ts — polyglot manifest chain.
 */
export function runLint(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.lint;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no linter registered for language '${toolchain.language}'`,
    };
  }
  let proc;
  try {
    proc = execaSync(cmd, [...args], {cwd, reject: false});
  } catch (err) {
    // Tool binary absent (ENOENT) → skip (exitCode 2), matching
    // smoke/perf/visual. Without this, a missing linter surfaces as a
    // crash / false failure instead of an honest skip.
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

// CLI entry — `tsx stages/lint.ts` or `npm run stage:lint`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runLint();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
