// Cladding · drive · best-of-N candidate selection (F-ac92c812).
//
// The 2025–26 thesis: with a strong VERIFIER, solution coverage scales with the
// number of candidate attempts — the verifier becomes a *selector*, not just a
// pass/fail judge. cladding owns an unusually strong deterministic verifier (the
// gate), so this turns the single-pass drive loop into best-of-N: generate K
// candidates, gate each, keep the green winner.
//
// This module is the PURE core — selection + orchestration — decoupled from the
// loop's I/O so it is fully unit-testable. Isolation/generation is injected via
// the `GenerateAndGate` callback.
//
// Anti-self-cert note: selection is by the GATE (an independent deterministic
// verifier), never by the author persona judging its own output. The tie-break
// among green candidates is a structural signal (fewer stub fallbacks = more
// real implementation), not a quality opinion.

import type {AgentMutation} from '../adapters/types.js';

/** One L1 gate outcome for a candidate (stage id + pass + exitCode). */
export interface CandidateGate {
  readonly stage: string;
  readonly pass: boolean;
  /** exitCode 2 == genuine skip (missing tool / unknown language) — not a failure. */
  readonly exitCode: number;
}

/** One generated implementation attempt and how it fared at the gate. */
export interface DriveCandidate {
  readonly attempt: number;
  readonly identityName: string | undefined;
  readonly mutations: readonly AgentMutation[];
  readonly gates: readonly CandidateGate[];
  /** How many module stubs this candidate fell back to (0 = authored everything). */
  readonly stubCount: number;
}

/** A gate counts against green only when it FAILED and did not merely skip. */
function failingGates(c: DriveCandidate): readonly string[] {
  return c.gates.filter((g) => !g.pass && g.exitCode !== 2).map((g) => g.stage);
}

/** Green ⟺ no gate failed (skips are fine) — mirrors the loop's `failed` check. */
export function isGreen(c: DriveCandidate): boolean {
  return failingGates(c).length === 0;
}

export interface RankedCandidate {
  readonly attempt: number;
  readonly green: boolean;
  readonly failingGates: readonly string[];
  readonly stubCount: number;
}

export interface Selection {
  /** The chosen candidate, or null when NONE is green (loop falls back to retry/halt). */
  readonly winner: DriveCandidate | null;
  /** Every candidate's verdict, in input order — for the audit log. */
  readonly ranked: readonly RankedCandidate[];
  readonly reason: string;
}

/**
 * Treat the gate as a SELECTOR over K candidates.
 *
 * Hard filter: only green candidates (all L1 gates pass) are eligible — best-of-N
 * never lowers the bar, so a round with no green candidate yields `winner: null`.
 * Among green candidates, rank deterministically: fewest stub fallbacks first
 * (more real implementation), then earliest attempt (stable tie-break).
 */
export function selectBest(candidates: readonly DriveCandidate[]): Selection {
  const ranked: RankedCandidate[] = candidates.map((c) => ({
    attempt: c.attempt,
    green: isGreen(c),
    failingGates: failingGates(c),
    stubCount: c.stubCount,
  }));
  const green = candidates.filter(isGreen);
  if (green.length === 0) {
    return {winner: null, ranked, reason: `0/${candidates.length} candidates green — falling back to retry/halt`};
  }
  const winner = [...green].sort((a, b) => a.stubCount - b.stubCount || a.attempt - b.attempt)[0];
  return {
    winner,
    ranked,
    reason: `selected attempt ${winner.attempt} (stubs=${winner.stubCount}) of ${green.length} green / ${candidates.length} total`,
  };
}

/** Produces one gated candidate for the given attempt index (generation + isolated gate). */
export type GenerateAndGate = (attempt: number) => Promise<DriveCandidate>;

/**
 * Run `n` candidate attempts sequentially and select the best. Generation +
 * gate isolation live inside `gen` (injected), so this orchestration stays pure
 * and unit-testable. `n` is clamped to >= 1.
 */
export async function runBestOfN(n: number, gen: GenerateAndGate): Promise<{candidates: DriveCandidate[]; selection: Selection}> {
  const count = Math.max(1, Math.floor(n));
  const candidates: DriveCandidate[] = [];
  for (let i = 0; i < count; i++) {
    candidates.push(await gen(i));
  }
  return {candidates, selection: selectBest(candidates)};
}
