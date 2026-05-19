// Cladding · stage_4.2 UAT
//
// Reference implementation of Ironclad iron-law.md stage_4.2.
//   pass criteria: every `status=done` feature has at least one
//                  human-authored `kind=pass` evidence
//   determinism: deterministic
//   llm cost: 0
//
// UAT (User Acceptance Test) goes one step beyond the stage_4.1 audit:
// it requires not just *any* human evidence per AC, but specifically
// a human PASS verdict per shipped feature. The intent: a feature is
// only considered "done" once a human signs off, end-to-end.

import process from 'node:process';

import {readEvidence} from '../hitl/audit.js';
import {loadSpec} from '../spec/load.js';
import type {CommandStageOptions, StageResult} from './types.js';

const STAGE = 'stage_4.2';

export function runUat(opts: CommandStageOptions = {}): StageResult {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return {stage: STAGE, pass: false, exitCode: 2, stderr: `spec.yaml not loaded: ${(err as Error).message}`};
  }
  const evidence = readEvidence(cwd);
  if (evidence.length === 0) {
    return {
      stage: STAGE,
      pass: false,
      exitCode: 2,
      stderr: 'no audit log present — record evidence before running stage_4.2',
    };
  }
  const doneFeatures = spec.features.filter((f) => f.status === 'done');
  const missing: string[] = [];
  for (const feature of doneFeatures) {
    const humanPass = evidence.some(
      (e) =>
        e.featureId === feature.id &&
        e.kind === 'pass' &&
        e.identity.author === 'human',
    );
    if (!humanPass) missing.push(feature.id);
  }
  if (missing.length === 0) return {stage: STAGE, pass: true, exitCode: 0};
  return {
    stage: STAGE,
    pass: false,
    exitCode: 1,
    stderr: `${missing.length} done feature(s) lack human pass evidence: ${missing.join(', ')}`,
  };
}

const isCliEntry = !(globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED && import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  const result = runUat();
  console.log(JSON.stringify(result));
  process.exit(result.exitCode);
}
