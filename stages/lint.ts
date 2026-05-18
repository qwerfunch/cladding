// Cladding · stage_1.2 Lint
//
// Reference implementation of Ironclad iron-law.md stage_1.2.
//   pass criteria: linter exit 0, no errors
//   determinism: deterministic
//   llm cost: 0
//
// Wraps the project's linter (default: `npx eslint`). Same shape as stage_1.1;
// only the underlying tool differs. Project owns the rule set; this stage
// merely translates the exit signal.

import {spawnSync} from 'node:child_process';
import process from 'node:process';

import type {CommandStageOptions, StageResult} from './types.js';

/**
 * Runs the project's linter and returns an Ironclad-shaped stage result.
 *
 * The lint rule set is project-owned (e.g. `eslint.config.js`); Ironclad only
 * codifies that *some* deterministic linter must return exit 0. Override `cmd`
 * or `args` to target ruff, biome, golangci-lint, etc.
 *
 * @param opts - Optional cwd, command, or argument override.
 * @returns A stage result. `pass=true` exactly when `exitCode === 0`.
 * @see iron-law.md stage_1.2 — "linter exit 0, no errors".
 */
export function runLint(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.', cmd = 'npx', args = ['eslint', '.']} = opts;
  const proc = spawnSync(cmd, [...args], {cwd, encoding: 'utf8'});
  const exitCode = proc.status ?? 1;
  const pass = exitCode === 0;
  const result: StageResult = {stage: 'stage_1.2', pass, exitCode};
  if (!pass && proc.stderr) {
    return {...result, stderr: proc.stderr.trim()};
  }
  return result;
}

// CLI entry — `tsx stages/lint.ts` or `npm run stage:lint`.
const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runLint();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
