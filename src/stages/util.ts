// Cladding · stage helpers — shared utilities

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {StageResult} from './types.js';

/**
 * Detects an absent tool binary from an `execaSync(…, {reject: false})`
 * result and returns a `skipped` StageResult, or null when the tool ran.
 *
 * IMPORTANT (empirically verified): `execaSync` with `reject: false` does
 * NOT throw when the command is missing — it RETURNS `{exitCode: undefined,
 * failed: true, code: 'ENOENT', …}`. A `try/catch` around the call therefore
 * never fires; ENOENT must be detected on the returned object. Without this,
 * a detected language whose tool simply isn't installed (e.g. a brownfield
 * Python repo without mypy) FALSE-FAILS the gate (exitCode 1) instead of
 * honestly skipping (exitCode 2) — the false-failure twin of Vacuous Green.
 *
 * @param stage - Ironclad stage id for the result.
 * @param cmd - The command that was attempted (for the message).
 * @param proc - The value returned by `execaSync(…, {reject: false})`.
 */
export function missingToolSkip(
  stage: string,
  cmd: string,
  proc: {readonly code?: string; readonly exitCode?: number | null},
): StageResult | null {
  if (proc.code === 'ENOENT') {
    return {stage, pass: false, exitCode: 2, stderr: `'${cmd}' not installed`};
  }
  return null;
}

/**
 * Returns true when `cwd/package.json` declares a `scripts.<name>` entry.
 * Used by stages that delegate to `npm run <name>` so they can report
 * `exitCode 2` (skipped) instead of `exitCode 1` (fail) when the
 * project simply hasn't wired up the script.
 */
export function isNpmScriptDefined(cwd: string, scriptName: string): boolean {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as {scripts?: Record<string, string>};
    return Boolean(parsed.scripts?.[scriptName]);
  } catch {
    return false;
  }
}
