// Cladding · stage_1.1 Type
//
// Reference implementation of Ironclad iron-law.md stage_1.1.
//   pass criteria: type checker exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// Polyglot: the actual command is chosen by `detectToolchain` based on the
// project's manifest (package.json → tsc, pyproject.toml → mypy, Cargo.toml
// → cargo check, …). cladding stays language-agnostic.

import process from 'node:process';

import {execaSync} from 'execa';

import {withFindings} from './finding-parser.js';
import {resolveStageCommand} from './toolchain/scoped-command.js';
import type {CommandStageOptions, StageResult} from './types.js';
import {missingToolSkip, ranToolResult} from './util.js';

const STAGE = 'stage_1.1';

/**
 * Runs the project's type checker and returns an Ironclad-shaped stage result.
 *
 * The tool is resolved in this priority:
 *   1. Explicit `opts.cmd` + `opts.args` (full override)
 *   2. `detectToolchain(cwd).gates.type` (manifest-driven default)
 *   3. When `language: 'unknown'` and no override → `pass=false, exitCode=2`
 *      with a `stderr` explaining the gap (not a true failure — caller can
 *      treat code 2 as "skipped").
 *
 * @param opts - Optional cwd / cmd / args override.
 * @returns A stage result. `pass=true` exactly when `exitCode === 0`.
 * @see iron-law.md stage_1.1 — "type checker exit 0, no errors".
 * @see toolchain/detect.ts — polyglot manifest chain.
 */
export function runType(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  let cmd: string | undefined;
  let args: readonly string[] | undefined;
  let language: string;
  try {
    ({cmd, args, language} = resolveStageCommand('type', opts));
  } catch (err) {
    // A focus feature whose modules cannot map to a Gradle project is a loud
    // configuration error, never a silent whole-repo fallback.
    return {stage: STAGE, pass: false, exitCode: 1, stderr: (err as Error).message};
  }
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no type checker registered for language '${language}'`,
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
  // the tool's own output — the raw stderr is preserved unchanged.
  return withFindings('type', ranToolResult(STAGE, proc), proc);
}

// CLI entry — `tsx stages/type.ts` or `npm run stage:type`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runType();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
