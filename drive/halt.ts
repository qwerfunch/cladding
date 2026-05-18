// Cladding · drive · halt classes
//
// An autonomous loop must stop. The 10 halt classes below are the
// closed enumeration of *why* the loop ends, borrowed from
// harness-boot's `src/drive/halt.ts`. Every drive run ends with
// exactly one `HaltReason`; the report cites it verbatim.
//
// Half of these protect the user (budget, wall-clock, human-required).
// The other half protect the system (blocked-feature, retry-threshold,
// gate-no-progress) — they detect the loop has stopped *making progress*
// and bail before spinning forever.

/** Closed enum of every reason the drive loop may stop. */
export type HaltClass =
  | 'ALL_FEATURES_DONE'   // happy path
  | 'MAX_ITERATIONS'      // user-set cap
  | 'WALL_CLOCK'          // time-box exceeded
  | 'BUDGET_EXCEEDED'     // token/$ cap (placeholder until LLM wiring)
  | 'BLOCKED_FEATURE'     // every remaining feature has unresolved depends_on
  | 'RETRY_THRESHOLD'     // same feature failed N times in a row
  | 'GATE_NO_PROGRESS'    // every gate run returns identical findings
  | 'HUMAN_REQUIRED'      // L4 anti-self-cert blocks (need human evidence)
  | 'LLM_UNAVAILABLE'     // model call failed past retry budget
  | 'UNCAUGHT_ERROR';     // anything else — surfaced for triage

export interface HaltReason {
  readonly class: HaltClass;
  readonly detail: string;
  readonly iteration: number;
}

/** Loop budget. Every field is checked on every iteration. */
export interface LoopBudget {
  readonly maxIterations: number;
  readonly maxWallClockMs: number;
  readonly maxRetriesPerFeature: number;
}

export const DEFAULT_BUDGET: LoopBudget = {
  maxIterations: 50,
  maxWallClockMs: 600_000, // 10 min default
  maxRetriesPerFeature: 3,
};

/** Returns a HaltReason when any budget invariant is exceeded; null otherwise. */
export function checkBudget(
  iteration: number,
  startedAtMs: number,
  retriesPerFeature: ReadonlyMap<string, number>,
  budget: LoopBudget = DEFAULT_BUDGET,
): HaltReason | null {
  if (iteration >= budget.maxIterations) {
    return {class: 'MAX_ITERATIONS', detail: `iteration ${iteration} ≥ ${budget.maxIterations}`, iteration};
  }
  const elapsed = Date.now() - startedAtMs;
  if (elapsed >= budget.maxWallClockMs) {
    return {class: 'WALL_CLOCK', detail: `${elapsed}ms ≥ ${budget.maxWallClockMs}ms`, iteration};
  }
  for (const [featureId, count] of retriesPerFeature) {
    if (count >= budget.maxRetriesPerFeature) {
      return {class: 'RETRY_THRESHOLD', detail: `${featureId} retried ${count} times`, iteration};
    }
  }
  return null;
}
