// Cladding · stages · shared types
//
// Common types for every Ironclad stage runner. Each `stages/<name>.ts`
// returns a {@link StageResult} so downstream consumers (CLI, future
// orchestrator) can treat all stages uniformly.

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
  /** Runs the detector and returns its findings (possibly empty). */
  run(opts: CommandStageOptions): readonly DriftFinding[];
}
