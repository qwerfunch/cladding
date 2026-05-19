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
