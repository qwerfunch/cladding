// Cladding · stages · shared types
//
// Common types for every Ironclad stage runner. Each `stages/<name>.ts`
// returns a {@link StageResult} so downstream consumers (CLI, future
// orchestrator) can treat all stages uniformly.

/**
 * Honest gate dispositions for the smoke stage (F-e0f6c7). The 14 legacy stages
 * keep the exit-code spine (pass / exit-2 skip / fail); a stage that emits a
 * `disposition` overrides that mapping in the gate reducer. Blocking set =
 * {fail, pending_env, advisory} → exit 1, NEVER the non-blocking exit-2 skip lane.
 *   pass        — gate re-executed the recipe; expect met.
 *   fail        — gate re-executed; expect not met → blocking.
 *   pending_env — `requires` not satisfiable here; never exercised → non-green, blocking.
 *   advisory    — un-gate-able (device/GUI/mutating); needs human sign-off → non-green, blocking until signed.
 *   na          — nothing to run (library/static) → non-green, non-blocking.
 *   liveness    — legacy exit-only deliverable ran clean but NOT AC-verified → non-green, non-blocking.
 */
export type Disposition = 'pass' | 'fail' | 'pending_env' | 'advisory' | 'na' | 'liveness';

/** One probe's outcome within the smoke stage. `kind` widens to ProbeKind with the schema (F-g'). */
export interface ProbeOutcome {
  readonly id: string;
  readonly kind: string;
  readonly disposition: Disposition;
  readonly bindsFeature?: string;
  readonly bindsModules?: readonly string[];
  readonly why?: string;
  readonly detail?: string;
}

/** Result emitted by every Ironclad stage runner. JSON-serializable. */
export interface StageResult {
  /** Ironclad stage id, e.g. `stage_1.1`. */
  readonly stage: string;
  /** True iff the stage's pass criteria are met. */
  readonly pass: boolean;
  /** Underlying process exit code; 0 when pass=true. */
  readonly exitCode: number;
  /** Captured stderr; populated only on failure. */
  readonly stderr?: string;
  /**
   * NEW (F-e0f6c7) — when present, the gate reducer uses this as the stage's
   * top-line status INSTEAD of the exit-code mapping. Absent for the 14 legacy
   * stages. Blocking dispositions carry `exitCode: 1`, never 2.
   */
  readonly disposition?: Disposition;
  /** NEW (F-e0f6c7) — per-probe outcomes for JSON/audit/demand reconciliation. */
  readonly probes?: readonly ProbeOutcome[];
  /**
   * NEW (F-b7873005) — structured findings parsed from a FAILING tool stage's
   * own output (tsc/eslint/vitest), each carrying path/line/detector/message.
   * Additive: absent on green and on the legacy stages. The `DriftReport`
   * subtype redeclares this required (drift always emits a findings array). The
   * verdict reducer prefers the first path-bearing finding for `next_action`.
   */
  readonly findings?: readonly DriftFinding[];
  /**
   * NEW (F-4643d99d) — a one-line remediation hint the check renderer prints
   * under a failing tool stage's findings (e.g. `dart format .`). Additive;
   * absent on green stages and on stages with no known fix command.
   */
  readonly hint?: string;
}

/** Shared options for any stage that wraps an external command. */
export interface CommandStageOptions {
  /** Working directory for the underlying tool. Defaults to `'.'`. */
  readonly cwd?: string;
  /** Executable to invoke (default depends on the stage). */
  readonly cmd?: string;
  /** Arguments passed to the executable (default depends on the stage). */
  readonly args?: readonly string[];
  /**
   * Repo-relative module paths of the focus feature. When present (and the
   * project is a Gradle monorepo under the default `feature` scope), the
   * command stages narrow their Gradle tasks to just these modules' projects
   * instead of the root aggregate. Empty/absent → whole-repo (unchanged).
   * @see toolchain/scoped-command.ts — resolution precedence.
   */
  readonly focusModules?: readonly string[];
}

/**
 * Optional remediation hint attached to a drift finding. Surfaced by
 * the `clad sync` subcommand when invoked with a filter flag (for
 * example `--propose-archive` filters findings whose suggestion.action
 * equals `'propose-archive'`). The `action` string is the contract a
 * downstream CLI handler keys on; `args` carries action-specific
 * payload (feature id, reason draft, etc.).
 *
 * Phased Decommissioning Tier 2 (ironclad-design 07-ssot-init §5) is
 * the first consumer — STALE_SPECIFICATION emits `propose-archive`
 * suggestions and `sync --propose-archive` walks them.
 */
export interface DriftSuggestion {
  /** Stable verb the CLI dispatches on, e.g. `'propose-archive'`. */
  readonly action: string;
  /** Action-specific payload, JSON-serializable. */
  readonly args?: Record<string, unknown>;
}

/**
 * A single drift finding produced by a detector. Distinct from `StageResult`
 * because one drift run can surface many findings of varying severity.
 *
 * @see iron-law.md stage_1.3 — drift detection.
 */
export interface DriftFinding {
  /** Detector identity, e.g. `'SECRETS_PRESENT'`, `'AC_DRIFT'`. */
  readonly detector: string;
  /** Findings of severity `'error'` fail the stage; others are advisory. */
  readonly severity: 'error' | 'warn' | 'info';
  /** Optional file path the finding refers to. */
  readonly path?: string;
  /** Optional 1-based line number within `path`. */
  readonly line?: number;
  /** Human-readable explanation; one short line preferred. */
  readonly message: string;
  /**
   * Optional remediation hint. Detectors populate this when the
   * finding has a known, machine-actionable resolution path; consumers
   * (e.g. `clad sync --propose-archive`) filter on `suggestion.action`.
   */
  readonly suggestion?: DriftSuggestion;
}

/** Aggregate drift result. `pass=false` iff any finding has severity `'error'`. */
export interface DriftReport extends StageResult {
  /** Findings from every registered detector, in registration order. */
  readonly findings: readonly DriftFinding[];
  /** Subprocess detectors excluded under the interactive profile; `[]` when full. */
  readonly skippedDetectors: readonly string[];
}

/**
 * Plug-in contract for a drift detector. Detectors register into the
 * `stages/drift.ts` registry; `runDrift` invokes each and aggregates findings.
 *
 * Detectors must be synchronous and deterministic — the Ironclad spec
 * forbids LLM-assisted detectors at this layer.
 *
 * @see iron-law.md stage_1.3 — detector catalog.
 */
export interface DriftDetector {
  /** Stable identifier; matches `DriftFinding.detector`. */
  readonly name: string;
  /** True for detectors that spawn a child process; excluded by the interactive profile. */
  readonly subprocess?: true;
  /** Runs the detector and returns its findings (possibly empty). */
  run(opts: CommandStageOptions): readonly DriftFinding[];
}
