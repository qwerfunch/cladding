// Cladding · gate disposition spine (F-e0f6c7, load-bearing #1)
//
// The legacy gate reducer collapsed every stage to a 3-bucket status derived
// from the exit code: pass (0) / skip (exit 2, NON-blocking) / fail (else). That
// is why the smoke stage's "couldn't run here" / "needs a human" / "nothing to
// run" states had nowhere to live and leaked into the non-blocking skip lane,
// reading GREEN. This module is the honest spine: a stage that emits a
// `disposition` overrides the exit-code mapping, and the blocking set
// {fail, pending_env, advisory} contributes a NON-ZERO exit — never the exit-2
// skip lane (which stays reserved for "cladding chose not to run a tool").
//
// Pure + side-effect-free so the reducer's core is unit-testable in isolation
// (the GATE 1 proof) without spinning the whole CLI.

import type {Disposition} from './types.js';

/** The legacy 3-bucket statuses widened with the smoke dispositions. */
export type GateStatus = 'pass' | 'skip' | 'fail' | 'pending_env' | 'advisory' | 'na' | 'liveness';

const BLOCKING_SET = new Set<GateStatus>(['fail', 'pending_env', 'advisory']);

/**
 * True iff this status blocks the gate (worst >= 1, anyFailed). pending_env and
 * advisory block by default — a deliverable's smoke that could not run, or that
 * needs a human, is NOT a green. `na` and `liveness` are non-green but
 * non-blocking; `skip`/`pass` are non-blocking.
 */
export function isBlocking(s: GateStatus): boolean {
  return BLOCKING_SET.has(s);
}

/**
 * Disposition-first status: a stage's `disposition` (when present) IS the
 * top-line status; otherwise fall back to the legacy exit-code mapping
 * (pass / exit-2 skip / fail). Legacy stages emit no disposition and are
 * therefore unaffected.
 */
export function gateStatusOf(r: {readonly pass: boolean; readonly exitCode: number; readonly disposition?: Disposition}): GateStatus {
  return r.disposition ?? (r.pass ? 'pass' : r.exitCode === 2 ? 'skip' : 'fail');
}

/**
 * The `worst` contribution of a stage result given its derived status. Non-
 * blocking → 0. A disposition-blocking stage contributes exactly 1 (never the
 * tool's raw exit, never 2 — exit 2 is the reserved non-blocking skip lane); a
 * legacy blocking fail contributes its exit code (already collapsed to 1 by
 * ranToolResult).
 */
export function worstContribution(r: {readonly exitCode: number; readonly disposition?: Disposition}, status: GateStatus): number {
  if (!isBlocking(status)) return 0;
  return r.disposition ? 1 : r.exitCode;
}
