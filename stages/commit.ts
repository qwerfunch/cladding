// Cladding · stage_1.4 Commit
//
// Reference implementation of Ironclad iron-law.md stage_1.4.
//   pass criteria: working tree + index both clean (git status --porcelain empty)
//   determinism: deterministic
//   llm cost: 0
//
// Language-agnostic — git is the only dependency. No toolchain chain
// lookup needed: a working tree is a working tree regardless of language.
// Intended use: invoked *after* a commit so the stage proves "every change
// has been recorded". Called mid-edit it will (correctly) fail.

import process from 'node:process';

import {execaSync} from 'execa';

import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_1.4';

/**
 * Verifies the working tree and index are both clean.
 *
 * Uses `git status --porcelain` rather than `git diff --quiet` so a single
 * spawn covers untracked files, staged-but-uncommitted changes, and merge
 * states. Non-git directories are treated as `skipped` (exitCode 2), not
 * a failure, so projects without git can still call the stage.
 *
 * @param opts - Optional cwd override (only `cwd` is consulted; `cmd`/`args` are
 *               ignored because this stage doesn't compose with a toolchain).
 * @returns A stage result.
 * @see iron-law.md stage_1.4 — "every change has been committed".
 */
export function runCommit(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  let proc;
  try {
    proc = execaSync('git', ['status', '--porcelain'], {cwd, reject: false});
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return {stage: STAGE, pass: false, exitCode: 2, stderr: 'git binary not found'};
    }
    throw err;
  }
  if (proc.exitCode !== 0) {
    const stderr = (proc.stderr ?? '').toString().trim() || 'not a git repository';
    return {stage: STAGE, pass: false, exitCode: 2, stderr};
  }
  const dirty = (proc.stdout ?? '').toString().trim();
  if (dirty.length === 0) return {stage: STAGE, pass: true, exitCode: 0};
  return {stage: STAGE, pass: false, exitCode: 1, stderr: `working tree dirty:\n${dirty}`};
}

// CLI entry — `tsx stages/commit.ts` or `npm run stage:commit`.
const isCliEntry = import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runCommit();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
