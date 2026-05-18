// Cladding · stage_4.1 Audit
//
// Reference implementation of Ironclad iron-law.md stage_4.1.
//   pass criteria: every AC mentioned in the audit log has at least
//                  one human-authored evidence entry
//   determinism: deterministic (reads the audit log + spec.yaml)
//   llm cost: 0
//
// This stage is where the anti-self-cert guard fires. If the project
// has not produced an audit log yet, the stage returns exitCode 2
// (skipped) — better than failing every spec-less project's CI on day
// one.

import process from 'node:process';

import {failingAcs} from '../hitl/anti-self-cert.js';
import {readEvidence} from '../hitl/audit.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_4.1';

export function runAudit(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  const evidence = readEvidence(cwd);
  if (evidence.length === 0) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: 'no audit log present — record evidence before running stage_4.1',
    };
  }
  const failing = failingAcs(evidence);
  if (failing.length === 0) {
    return {stage: STAGE, pass: true, exitCode: 0};
  }
  const reasons = failing.map((r) => `${r.acId}: ${r.reason}`).join('; ');
  return {stage: STAGE, pass: false, exitCode: 1, stderr: `anti-self-cert guard: ${reasons}`};
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runAudit();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
