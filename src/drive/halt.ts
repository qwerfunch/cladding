// Cladding · drive · halt classes
//
// An autonomous loop must stop. The closed enumeration below names
// every reason the loop ends — borrowed from harness-boot's
// `src/drive/halt.ts`. Every drive run ends with exactly one
// `HaltReason`; the report cites it verbatim.
//
// Half of these protect the user (budget, wall-clock, human-required).
// The other half protect the system (blocked-feature, retry-threshold,
// gate-no-progress) — they detect the loop has stopped *making progress*
// and bail before spinning forever.
//
// v0.2.22 (F-071) added three transport-specific classes
// (`TRANSPORT_AUTH_FAILED`, `TRANSPORT_RATE_LIMITED`,
// `TRANSPORT_NETWORK`) so users get an actionable category instead
// of the generic `LLM_UNAVAILABLE` when a real-LLM transport throws.
// `LLM_UNAVAILABLE` stays as the catch-all for transport errors that
// don't match a more specific class.

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
  | 'TRANSPORT_AUTH_FAILED'   // 401 / 403 / invalid API key
  | 'TRANSPORT_RATE_LIMITED'  // 429 / quota exceeded
  | 'TRANSPORT_NETWORK'       // ENOENT / ECONNREFUSED / ETIMEDOUT / connection lost
  | 'LLM_UNAVAILABLE'     // any other model-call failure (catch-all)
  | 'UNCAUGHT_ERROR';     // anything else — surfaced for triage

/**
 * Classifies a thrown error from a Transport into a HaltClass. Returns
 * the most specific transport-failure class when the error pattern
 * matches; falls through to `LLM_UNAVAILABLE` for anything else.
 *
 * The matcher reads the error message (case-insensitive) plus, when
 * present, the `code` property a NodeJS.ErrnoException would carry.
 * Real SDKs (Anthropic, OpenAI, …) throw errors whose message starts
 * with the HTTP status code; cladding's classifier just reads the
 * prefix and the well-known phrases — no SDK-specific coupling.
 */
export function classifyTransportError(err: unknown): HaltClass {
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err);
  const lower = message.toLowerCase();
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  // Auth failures — HTTP status prefixes + well-known phrases. The
  // `api key` / `api_key` patterns also catch the common "API key is
  // not set" / "API_KEY missing" pre-flight reason returned by
  // adapter.healthCheck() when credentials are absent (v0.2.23, F-072).
  if (
    lower.startsWith('401') ||
    lower.startsWith('403') ||
    lower.includes('invalid api key') ||
    lower.includes('invalid x-api-key') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('api key') ||
    lower.includes('api_key')
  ) {
    return 'TRANSPORT_AUTH_FAILED';
  }
  // Rate limit
  if (
    lower.startsWith('429') ||
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('quota exceeded') ||
    lower.includes('too many requests')
  ) {
    return 'TRANSPORT_RATE_LIMITED';
  }
  // Network — Node.js ErrnoException codes + common SDK timeout strings
  if (
    code === 'ENOENT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ENOTFOUND' ||
    lower.includes('network') ||
    lower.includes('connection') ||
    lower.includes('timeout')
  ) {
    return 'TRANSPORT_NETWORK';
  }
  return 'LLM_UNAVAILABLE';
}

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
