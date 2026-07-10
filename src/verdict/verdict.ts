// Cladding · verdict reducer (F-2e28cc72, load-bearing)
//
// One poll → one decision. A host loop calls `clad verdict` each turn and reads
// ONE of {DONE, ITERATE, ESCALATE, BLOCKED, BOOTSTRAP} instead of re-deriving
// the disposition→decision mapping over the raw gate dump. This module is the
// PURE reducer: it takes an already-computed gate outcome + the spec and returns
// the verdict. No IO, no spawn, no process.exit — unit-testable in isolation
// (the GATE 1 proof), and it imports NOTHING from src/cli/* or src/serve/*
// (topology: cli → serve → verdict). It may read the disposition spine
// (src/stages/*) and the spec types (src/spec/*).
//
// The DONE guarantee is structural, not cosmetic: DONE requires a GREEN gate AND
// every non-archived feature status:done AND at least one non-liveness
// behavioral proof (a real unit/oracle/smoke pass). A gate that is green only
// because its behavioral stages were skip/na/liveness returns ITERATE — never
// the confident-garbage "finished" signal the gate exists to prevent.

import {isBlocking, type GateStatus} from '../stages/disposition.js';
import type {DriftFinding} from '../stages/types.js';
import type {Feature, Spec} from '../spec/types.js';

/**
 * Per-stage record read by the reducer. A structural mirror of the CLI's
 * `StageOutcome` (src/cli/clad.ts) — declared HERE, not imported from src/cli/*,
 * to keep the reducer's topology clean. The CLI's `StageOutcome` is structurally
 * assignable to this, so `runCheckStages(...)`'s result flows in unchanged.
 */
export interface VerdictStage {
  readonly stage: string;
  readonly label: string;
  readonly status: GateStatus;
  readonly exitCode: number;
  readonly stderr?: string;
  readonly findings?: readonly DriftFinding[];
}

/**
 * Structural mirror of the CLI's `CheckOutcome`. Same rationale as
 * {@link VerdictStage} — the reducer defines its own input contract so it never
 * reaches up into the cli layer. The CLI passes its `CheckOutcome` in directly
 * (structurally compatible).
 */
export interface VerdictOutcome {
  readonly worst: number;
  readonly anyFailed: boolean;
  readonly stages?: readonly VerdictStage[];
}

/** The five loop decisions. Exactly one is returned per poll. */
export type VerdictKind = 'DONE' | 'ITERATE' | 'ESCALATE' | 'BLOCKED' | 'BOOTSTRAP';

/** The reduced decision a host loop reads each turn. */
export interface Verdict {
  readonly verdict: VerdictKind;
  /** The single next thing to do, or null when DONE. */
  readonly next_action: string | null;
  /** Non-done, non-archived features still standing between here and DONE. */
  readonly remaining: {id: string; slug: string; status: string}[];
  /** Present only for ESCALATE — why a human/environment is required. */
  readonly halt_class?: string;
}

/** The behavioral-proof stages. A green among THESE (status === 'pass', not
 *  liveness/na/skip) is the honest evidence DONE requires (AC-acc5ae0a). */
const BEHAVIORAL_STAGES = new Set(['stage_2.1', 'stage_2.3', 'stage_2.4']);

/** A feature counts toward the goal iff it is not archived. */
function isLive(f: Feature): boolean {
  return f.status !== 'archived';
}

/** Display slug — never empty, so next_action pointers always resolve. */
function slugOf(f: Feature): string {
  return f.slug ?? f.id;
}

/** First non-empty, trimmed line of a captured stderr (the raw-tail pointer). */
function firstLine(s: string | undefined): string | undefined {
  if (!s) return undefined;
  for (const line of s.split('\n')) {
    const t = line.trim();
    if (t) return t;
  }
  return undefined;
}

/**
 * The single most-actionable pointer over a set of BLOCKING stages — the one
 * string both ITERATE and the stuck-escalate (GATE_NO_PROGRESS) surface, so they
 * point at the identical finding. First path-bearing finding wins (preferring
 * one that also carries a line), else the first stage's stderr raw-tail, else a
 * bare stage-failed / gate-failed message.
 */
function mostActionable(blocking: readonly VerdictStage[]): string {
  for (const s of blocking) {
    const withPath = (s.findings ?? []).filter((f) => f.path && f.severity !== 'info');
    if (withPath.length === 0) continue;
    const pick = withPath.find((f) => f.line !== undefined) ?? withPath[0];
    const loc = pick.line !== undefined ? `${pick.path}:${pick.line}` : pick.path;
    return `${loc} ${pick.detector}: ${pick.message}`;
  }
  const first = blocking[0];
  const tail = firstLine(first?.stderr);
  return first ? (tail ? `${first.label}: ${tail}` : `${first.label} failed`) : 'gate failed';
}

/**
 * Reduce a gate outcome + spec to a single verdict. Pure — no IO, no spawn.
 * The order below is the contract (BOOTSTRAP → red split → green split).
 */
export function computeVerdict(input: {outcome: VerdictOutcome; spec: Spec; stuck?: boolean}): Verdict {
  const {outcome, spec} = input;
  const features = spec.features ?? [];
  const live = features.filter(isLive);
  const remaining = live
    .filter((f) => f.status !== 'done')
    .map((f) => ({id: f.id, slug: f.slug ?? '', status: f.status}));

  // 1. BOOTSTRAP — nothing declared yet; the gate has no goal to verify.
  if (features.length === 0) {
    return {
      verdict: 'BOOTSTRAP',
      next_action: 'no features declared — create one with clad_create_feature, then run the gate',
      remaining: [],
    };
  }

  const stages = outcome.stages ?? [];
  const red = outcome.anyFailed || outcome.worst > 0;

  // 2. RED — the gate found a blocking problem. Split escalate (needs a human /
  //    environment) vs iterate (a self-fixable finding to act on).
  if (red) {
    const blocking = stages.filter((s) => isBlocking(s.status));

    // ESCALATE — a stage could not self-supply what it needs: pending_env (a
    // requirement absent here) or advisory (device/GUI/mutating; needs sign-off).
    const humanGate = blocking.find((s) => s.status === 'pending_env' || s.status === 'advisory');
    if (humanGate) {
      const tail = firstLine(humanGate.stderr);
      return {
        verdict: 'ESCALATE',
        next_action: tail
          ? `${humanGate.label}: ${tail}`
          : `${humanGate.label} needs a human or an environment it cannot self-supply`,
        remaining,
        halt_class: 'HUMAN_REQUIRED',
      };
    }

    // The single most-actionable finding — surfaced by both the stuck-escalate
    // and the ITERATE below. Walk blocking stages in pipeline order; the first
    // with a path-bearing finding wins (preferring one that also carries a
    // line), else the first stage's stderr raw-tail. Only BLOCKING-severity
    // findings (error/warn — warn blocks under the poll's strict gate) count: an
    // `info` finding is advisory noise, never the reason the stage failed, so
    // pointing the loop at one would misdirect it.
    const actionable = mostActionable(blocking);

    // ESCALATE (GATE_NO_PROGRESS) — the previous poll produced an IDENTICAL
    // blocking-findings fingerprint (`stuck` computed by the handler from its own
    // gitignored state). The loop tried and made no progress on an otherwise-
    // iterable gate, so stop it and hand the SAME actionable pointer to a human
    // instead of billing forever (AC-3e435423). This sits AFTER the HUMAN_REQUIRED
    // check above so a genuine environment/human escalate keeps precedence, and
    // it is a RECOMMENDATION the host may override, never a hard block.
    if (input.stuck === true) {
      return {
        verdict: 'ESCALATE',
        next_action: `${actionable} — no progress: identical gate findings twice, needs a human`,
        remaining,
        halt_class: 'GATE_NO_PROGRESS',
      };
    }

    // ITERATE — a self-fixable finding to act on.
    return {verdict: 'ITERATE', next_action: actionable, remaining};
  }

  // 3. GREEN (worst === 0, nothing failed). DONE is over the WHOLE goal and
  //    demands honest behavioral proof — otherwise iterate, never DONE.
  const allDone = live.every((f) => f.status === 'done');
  const hasBehavioralProof = stages.some((s) => BEHAVIORAL_STAGES.has(s.stage) && s.status === 'pass');

  if (allDone && hasBehavioralProof) {
    return {verdict: 'DONE', next_action: null, remaining};
  }

  if (!allDone) {
    // Ready = every dependency is a done feature. Point the loop at the first
    // ready feature; if every unfinished feature is blocked on unfinished deps,
    // the loop is stuck on dependencies (BLOCKED).
    const doneIds = new Set(live.filter((f) => f.status === 'done').map((f) => f.id));
    const unfinished = live.filter((f) => f.status !== 'done');
    const ready = unfinished.find((f) => (f.depends_on ?? []).every((dep) => doneIds.has(dep)));
    if (ready) {
      return {verdict: 'ITERATE', next_action: `implement ${slugOf(ready)} (${ready.id})`, remaining};
    }
    return {
      verdict: 'BLOCKED',
      next_action: `${unfinished.length} feature(s) blocked on unfinished dependencies`,
      remaining,
    };
  }

  // 4. allDone && !hasBehavioralProof — green but vacuous: the gate never ran a
  //    behavioral proof. Refuse DONE; demand a real test/oracle/smoke.
  return {
    verdict: 'ITERATE',
    next_action: 'gate is green but no behavioral proof ran — add a test/oracle/smoke that actually executes the code',
    remaining,
  };
}
