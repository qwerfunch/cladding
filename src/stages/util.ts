// Cladding · stage helpers — shared utilities

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {DriftFinding, StageResult} from './types.js';

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
/**
 * True when an `execaSync(…, {reject: false})` result indicates the binary was
 * not found. CRITICAL: execaSync with `reject: false` RETURNS this state
 * (`{code: 'ENOENT', exitCode: undefined}`) — it does NOT throw — so callers
 * must inspect the RESULT, never a try/catch. A try/catch around the call is
 * dead code and lets a missing tool fall through to a false failure.
 */
export function isMissingBinary(proc: {readonly code?: string}): boolean {
  return proc.code === 'ENOENT';
}

/**
 * Classifies the non-zero exit of a registered external SCANNER (secretlint, an
 * arch validator) that RAN (its binary was present — see {@link isMissingBinary}).
 * Distinguishes a REAL finding (block, error) from "could not run — config/setup
 * gap" (non-blocking, info — the same category as a missing binary). The setup-gap
 * signal is matched on the tool's own output with config/setup-error patterns that
 * a genuine finding never carries (a secret hit or a cycle report does not say
 * "config not found" / ENOENT), so this is tool-agnostic and never masks a true
 * positive. WHY: a fresh project that simply hasn't configured the scanner (no
 * `.secretlintrc`) was false-RED'd — secretlint exits non-zero with "config is not
 * found", which was mis-reported as a hardcoded secret. A config gap is not a
 * finding; it skips, like a missing binary does.
 *
 * `canceled due to missing packages` / `could not determine executable` are npm
 * exec's refusals when `npx --no-install <tool>` cannot resolve the tool — the
 * tool never ran, so it cannot have found anything. Missed in the first
 * `--no-install` pass: local runs hid it because ~/.npm/_npx still cached tools
 * from the pre-`--no-install` era, while fresh CI runners exposed it as a false
 * ARCHITECTURE_VIOLATION error (breaking the committed A/B report baselines).
 */
const SCANNER_SETUP_FAILURE =
  /config (is |file )?not found|no such file|ENOENT|cannot find (a |the )?(config|module|package|preset)|require[sd]?\b.{0,40}\bconfig|canceled due to missing packages|could not determine executable/i;

export function classifyScannerExit(
  proc: {readonly exitCode?: number | null; readonly stdout?: unknown; readonly stderr?: unknown},
  detector: string,
  foundMsg: (detail: string) => string,
  skippedMsg: (detail: string) => string,
): DriftFinding[] {
  const exitCode = proc.exitCode ?? 1;
  if (exitCode === 0) return [];
  const stderr = (proc.stderr ?? '').toString().trim();
  const stdout = (proc.stdout ?? '').toString().trim();
  const detail = (stderr || stdout || `exit ${exitCode}`).slice(0, 200);
  if (SCANNER_SETUP_FAILURE.test(stderr) || SCANNER_SETUP_FAILURE.test(stdout)) {
    return [{detector, severity: 'info', message: skippedMsg(detail)}];
  }
  return [{detector, severity: 'error', message: foundMsg(detail)}];
}

export function missingToolSkip(
  stage: string,
  cmd: string,
  proc: {readonly code?: string; readonly exitCode?: number | null},
): StageResult | null {
  if (isMissingBinary(proc)) {
    return {stage, pass: false, exitCode: 2, stderr: `'${cmd}' not installed`};
  }
  return null;
}

/**
 * Builds a StageResult from a tool process that ACTUALLY RAN — i.e. the
 * stage's skip pre-checks (unknown language, undefined npm script, missing
 * binary via {@link missingToolSkip}) have already returned. Every command
 * stage uses this for the post-run mapping.
 *
 * CRITICAL — exit-code semantics (the gate's pass/fail spine). `clad check`
 * (clad.ts::runCheckCommand) RESERVES stage `exitCode === 2` for "cladding
 * chose not to run" (skipped — NON-blocking). A tool that ran and found a real
 * problem must therefore map to the blocking code 1 — NEVER the tool's raw
 * exit code. `tsc --noEmit` exits 2 on type errors; relaying that 2 verbatim
 * made the aggregator misclassify a real type failure as a skip, so the type
 * gate was structurally incapable of failing — the canonical "Vacuous Green".
 * This helper collapses ANY non-zero ran-tool exit to 1, so a stage exit 2 can
 * only ever mean "skipped". Routing every command stage through here makes that
 * invariant structural rather than per-stage discipline.
 *
 * Diagnostics: surfaces stderr, falling back to stdout — `tsc` writes its
 * diagnostics to stdout, not stderr, so a failing gate still shows WHY.
 *
 * @param stage - Ironclad stage id for the result.
 * @param proc - The value returned by `execaSync(…, {reject: false})`.
 */
export function ranToolResult(
  stage: string,
  proc: {readonly exitCode?: number | null; readonly stdout?: unknown; readonly stderr?: unknown},
): StageResult {
  const ran = proc.exitCode ?? 1;
  if (ran === 0) return {stage, pass: true, exitCode: 0};
  const detail = String(proc.stderr ?? '').trim() || String(proc.stdout ?? '').trim();
  return detail
    ? {stage, pass: false, exitCode: 1, stderr: detail}
    : {stage, pass: false, exitCode: 1};
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
