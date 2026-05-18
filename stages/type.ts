// Cladding · stage_1.1 Type
//
// Reference implementation of Ironclad iron-law.md stage_1.1.
//   pass criteria: type checker exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// TypeScript so cladding can apply stage_1.1 to itself (self-dogfood).
// Required for L7 conformance: declaring `iron-law: L1` must mean the
// declaration's own codebase passes the declared stage.

import {spawnSync} from 'node:child_process';
import process from 'node:process';

/** Result emitted by every Ironclad stage runner. JSON-serializable. */
export interface StageResult {
  /** Ironclad stage id, e.g. `stage_1.1`. */
  readonly stage: string;
  /** True iff the stage's pass criteria are met. */
  readonly pass: boolean;
  /** Underlying process exit code; 0 when pass=true. */
  readonly exitCode: number;
  /** Captured stderr; populated only on failure. */
  readonly stderr?: string;
}

/** Overrides for {@link runType}. Defaults target a TypeScript project. */
export interface RunTypeOptions {
  /** Working directory for the type checker. Defaults to `'.'`. */
  readonly cwd?: string;
  /** Executable to invoke. Defaults to `'npx'`. */
  readonly cmd?: string;
  /** Arguments passed to the executable. Defaults to `['tsc', '--noEmit']`. */
  readonly args?: readonly string[];
}

/**
 * Runs the project's type checker and returns an Ironclad-shaped stage result.
 *
 * Defers *what counts as a type error* to the project's own toolchain — this
 * function only translates the process exit signal into {@link StageResult}.
 * Host-agnostic: any toolchain whose exit code follows the `0 = pass` convention
 * works (tsc, pyright, mypy via override, etc.).
 *
 * @param opts - Optional cwd, command, or argument override.
 * @returns A stage result. `pass=true` exactly when `exitCode === 0`.
 * @see iron-law.md stage_1.1 — "type checker exit 0, no errors".
 */
export function runType(opts: RunTypeOptions = {}): StageResult {
  const {cwd = '.', cmd = 'npx', args = ['tsc', '--noEmit']} = opts;
  const proc = spawnSync(cmd, [...args], {cwd, encoding: 'utf8'});
  const exitCode = proc.status ?? 1;
  const pass = exitCode === 0;
  const result: StageResult = {stage: 'stage_1.1', pass, exitCode};
  if (!pass && proc.stderr) {
    return {...result, stderr: proc.stderr.trim()};
  }
  return result;
}

// CLI entry — `tsx stages/type.ts` or `npm run stage:type`.
const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runType();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
