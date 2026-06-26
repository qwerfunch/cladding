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

import {resolveStageCommand} from './toolchain/scoped-command.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';

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
  let cmd: string | undefined;
  let args: readonly string[] | undefined;
  let language: string;
  try {
    ({cmd, args, language} = resolveStageCommand('lint', opts));
  } catch (err) {
    return {stage: STAGE, pass: false, exitCode: 1, stderr: (err as Error).message};
  }
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no linter registered for language '${language}'`,
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

// CLI entry — `tsx stages/lint.ts` or `npm run stage:lint`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runLint();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
