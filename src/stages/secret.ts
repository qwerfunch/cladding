// Cladding · stage_1.6 Secret
//
// Reference implementation of Ironclad iron-law.md stage_1.6.
//   pass criteria: zero error-severity findings from the secret scanner
//   determinism: deterministic
//   llm cost: 0
//
// Thin adapter over the HARDCODED_SECRET drift detector: the detector
// owns the tool invocation, this stage maps its findings to a StageResult.
// Keeping the two layered avoids spawning the scanner twice when both
// `runSecret` and `runDrift` execute in the same pipeline.

import process from 'node:process';

import {readDetectorResult} from './detector-result-cache.js';
import {hardcodedSecret} from './detectors/hardcoded-secret.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_1.6';

/**
 * Runs the project's secret scanner via the HARDCODED_SECRET detector and
 * folds the findings into an Ironclad stage result. `pass=true` exactly
 * when no finding has severity `'error'` — `info` findings (missing tool,
 * unsupported language) do not fail the stage.
 *
 * @param opts - Optional cwd / cmd / args override forwarded to the detector.
 * @returns A stage result.
 * @see iron-law.md stage_1.6 — "no hardcoded secrets in tracked code".
 * @see stages/detectors/hardcoded-secret.ts — the underlying scanner call.
 */
export function runSecret(opts: CommandStageOptions = {}): StageResult {
  // Reuse the drift stage's HARDCODED_SECRET findings when a gate run primed
  // the session (F-e53596dd) — avoids a second secretlint spawn. On a miss (no
  // session / standalone) run the detector directly: byte-identical. The
  // detector emits only `error`/`info` severities (never `warn`), so a strict
  // drift run stores the same findings this filter expects.
  const cwd = opts.cwd ?? '.';
  const findings = readDetectorResult(hardcodedSecret.name, cwd) ?? hardcodedSecret.run(opts);
  const errors = findings.filter((f) => f.severity === 'error');
  const pass = errors.length === 0;
  const result: StageResult = {stage: STAGE, pass, exitCode: pass ? 0 : 1};
  if (!pass) return {...result, stderr: errors.map((f) => f.message).join('\n')};
  return result;
}

// CLI entry — `tsx stages/secret.ts` or `npm run stage:secret`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runSecret();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
