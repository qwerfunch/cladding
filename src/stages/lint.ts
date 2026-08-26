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

import {withFindings} from './finding-parser.js';
import {resolveStageCommand} from './toolchain/scoped-command.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';

const STAGE = 'stage_1.2';

/**
 * Fix command for a recognised check-only formatter, else undefined. These tools
 * verify formatting and exit non-zero on any diff but do not fix in place; the
 * hint tells the user which one command makes the stage green (F-4643d99d).
 */
function formatterFixHint(cmd: string, args: readonly string[]): string | undefined {
  if (cmd === 'dart' && args[0] === 'format') return 'dart format .';
  if (cmd === 'dotnet' && args.includes('format')) return 'dotnet format';
  return undefined;
}

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
      // F-c17e1edc — curable skip: declaring gate.commands.lint turns this on.
      skipReason: 'no-runner',
    };
  }
  const proc = execaSync(cmd, [...args], {cwd, reject: false});
  // execaSync(reject:false) RETURNS (does not throw) on a missing binary;
  // detect ENOENT on the result so a missing tool skips, not false-fails.
  const skip = missingToolSkip(STAGE, cmd, proc, args);
  if (skip) return skip;
  // The tool RAN. Map its result to cladding's pass/fail/skip contract:
  // any non-zero exit → blocking fail (1), never the tool's raw 2 (= skip).
  // ADDITIVE (F-b7873005): on failure, attach structured findings parsed from
  // the linter's own output — the raw stderr is preserved unchanged.
  const result = withFindings('lint', ranToolResult(STAGE, proc), proc);
  // ADDITIVE (F-4643d99d): on a failing check-only formatter, carry a one-line
  // fix hint the renderer prints under the per-file findings.
  if (!result.pass) {
    const hint = formatterFixHint(cmd, args);
    if (hint) return {...result, hint};
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
