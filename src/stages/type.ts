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

import {detectToolchain} from './toolchain/detect.js';
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
  const toolchain = detectToolchain(cwd);
  const spec = toolchain.gates.type;
  const cmd = opts.cmd ?? spec?.cmd;
  const args = opts.args ?? spec?.args;
  if (!cmd || !args) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: `no type checker registered for language '${toolchain.language}'`,
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

// CLI entry — `tsx stages/type.ts` or `npm run stage:type`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runType();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
