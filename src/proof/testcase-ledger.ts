// Cladding · Spec 0.2 F8 · sealed current-gate testcase ledger.

import type {TestCaseObservation} from './types.js';

/**
 * One sealed current-gate testcase ledger handed to a graph consumer.
 *
 * The stage seam validates gate evidence and parses it once; consumers receive
 * only normalized testcase carriers plus the observation identity, never the
 * report bytes, the runner command, or a workspace report path. Sealing is what
 * makes "this ledger came from the gate" a structural fact rather than a claim.
 *
 * @see spec/features/spec-02-graphir-v2-cutover-208eaa79.yaml AC-d452908b
 * @see docs/design/spec-0.2/proof-and-editing.md#d11--test-binding-and-observation
 * @since 0.10.0
 * @internal
 */
export interface CurrentGateTestcaseLedger {
  /** Compact observation locator derived from the gate-run proof evidence. */
  readonly identity: string;
  /** Closure input seal the captured evidence was validated against. */
  readonly inputSha256: string;
  /** Runner report format the carriers were parsed from. */
  readonly format: 'vitest-json' | 'junit-xml';
  /** Exact non-empty testcase carriers; absence is never sealed as proof. */
  readonly cases: readonly TestCaseObservation[];
}

const sealedLedgers = new WeakSet<object>();

/**
 * Seals one validated current-gate testcase ledger.
 *
 * Only the stage seam calls this: it is the single point that has already
 * proven the evidence brand, its input seal, and its report digests. A deep
 * frozen copy is registered so a later holder cannot mutate a sealed ledger
 * into a different claim.
 *
 * @param input - Validated identity, input seal, format, and testcase carriers.
 * @returns The deep-frozen sealed ledger.
 * @internal
 */
export function sealCurrentGateTestcaseLedger(input: CurrentGateTestcaseLedger): CurrentGateTestcaseLedger {
  const ledger: CurrentGateTestcaseLedger = Object.freeze({
    identity: input.identity,
    inputSha256: input.inputSha256,
    format: input.format,
    cases: Object.freeze(input.cases.map((observation) => Object.freeze({
      ...observation,
      files: Object.freeze([...observation.files]),
    }))),
  });
  sealedLedgers.add(ledger);
  return ledger;
}

/**
 * Verifies that a value is a ledger this module sealed at the stage seam.
 *
 * @param value - Any caller-supplied candidate.
 * @returns True only for a sealed ledger, so an unsealed look-alike stays unknown.
 * @internal
 */
export function isCurrentGateTestcaseLedger(value: unknown): value is CurrentGateTestcaseLedger {
  return value !== null && typeof value === 'object' && sealedLedgers.has(value);
}
