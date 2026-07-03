// Cladding · stage_1.5 Arch
//
// Reference implementation of Ironclad iron-law.md stage_1.5.
//   pass criteria: zero error-severity findings from the architecture validator
//   determinism: deterministic
//   llm cost: 0
//
// Thin adapter over the ARCHITECTURE_VIOLATION drift detector — same
// layered pattern as `stages/secret.ts` over HARDCODED_SECRET. The
// detector owns the tool invocation; this stage folds the findings into
// a StageResult so callers that only want a binary pass/fail can use it
// without parsing the per-finding list.

import process from 'node:process';

import {readDetectorResult} from './detector-result-cache.js';
import {architectureViolation} from './detectors/architecture-violation.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_1.5';

/**
 * Runs the project's architecture validator via the ARCHITECTURE_VIOLATION
 * detector and folds the findings into an Ironclad stage result.
 * `info` findings (missing tool, unsupported language) never fail the stage.
 *
 * @param opts - Optional cwd override forwarded to the detector.
 * @returns A stage result.
 * @see iron-law.md stage_1.5 — "no architecture rule violations".
 * @see stages/detectors/architecture-violation.ts — underlying scanner call.
 */
export function runArch(opts: CommandStageOptions = {}): StageResult {
  // Reuse the drift stage's ARCHITECTURE_VIOLATION findings when a gate run
  // primed the session (F-e53596dd) — avoids a second madge spawn. On a miss
  // (no session / standalone) run the detector directly: byte-identical. The
  // detector emits only `error`/`info` severities (never `warn`), so a strict
  // drift run stores the same findings this filter expects.
  const cwd = opts.cwd ?? '.';
  const findings = readDetectorResult(architectureViolation.name, cwd) ?? architectureViolation.run(opts);
  const errors = findings.filter((f) => f.severity === 'error');
  const pass = errors.length === 0;
  const result: StageResult = {stage: STAGE, pass, exitCode: pass ? 0 : 1};
  if (!pass) return {...result, stderr: errors.map((f) => f.message).join('\n')};
  return result;
}

// CLI entry — `tsx stages/arch.ts` or `npm run stage:arch`.
const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runArch();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
