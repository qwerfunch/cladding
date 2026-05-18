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
