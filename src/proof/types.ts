// Cladding · Spec 0.2 F5 · normalized proof facts.

/** A supported source carrier for a declared testcase binding. */
export type TestBindingCarrier = 'title' | 'metadata' | 'annotation';

/** One declared testcase binding, independent of any runner output. */
export interface TestBinding {
  /** Composite criterion address without the GraphIR prefix. */
  readonly criterion: string;
  /** The adapter that can round-trip this binding. */
  readonly framework: 'vitest' | 'jest';
  /** Repository-relative source file. */
  readonly file: string;
  /** Exact runner testcase title, including its source carrier. */
  readonly selector: string;
  /** How the adapter discovered the declaration. */
  readonly carrier: TestBindingCarrier;
}

/** One exact testcase observation emitted by a JUnit-compatible runner. */
export interface TestCaseObservation {
  /** A path-shaped testcase file key when the report exposes one. */
  readonly file?: string;
  /** All normalized path-shaped carriers emitted by the JUnit testcase. */
  readonly files: readonly string[];
  /** The raw JUnit class name, retained for diagnostics. */
  readonly className?: string;
  /** Exact testcase selector emitted by the runner. */
  readonly name: string;
  /**
   * Explicit source testcase title from an opaque runner payload. JUnit XML
   * does not expose this separate from its exact testcase name.
   */
  readonly sourceTitle?: string;
  /** Runner result; error remains distinct from an assertion failure. */
  readonly status: 'pass' | 'fail' | 'skip' | 'error';
}

/** Receipt-local testcase reduction; it deliberately does not model F6 obligations. */
export type BindingObservationState = 'failed' | 'verified' | 'unverified';

/** A criterion's exact binding reduction, retaining negative-channel precedence. */
export interface BindingObservation {
  readonly criterion: string;
  readonly state: BindingObservationState;
  readonly matched: number;
  readonly pass: number;
  readonly fail: number;
  readonly skip: number;
  readonly error: number;
}
