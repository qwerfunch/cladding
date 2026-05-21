// Cladding · spec types — minimal v0.1
//
// SSoT data model. Captures the 3-tier shape from ironclad-design's
// 07-ssot-init.md (scenarios + features + architecture) plus the EARS
// 5-pattern AC structure from 11-ssot-refinement-ears.md. Scenarios and
// architecture are optional in this brick — they unlock with later T2
// bricks (sharding + per-tier validators).

/** EARS pattern enum — see ironclad/ears.md (5 canonical patterns). */
export type EarsPattern =
  | 'ubiquitous'
  | 'event'
  | 'state'
  | 'optional'
  | 'unwanted';

/** Feature lifecycle status. */
export type FeatureStatus =
  | 'planned'
  | 'in_progress'
  | 'done'
  | 'blocked'
  | 'archived';

/**
 * Acceptance criterion. Internal id is required (Iron Core); the
 * EARS-structured fields and the rendered `text` are optional — they
 * graduate from "skeleton" to "complete" as a feature matures.
 *
 * @see ironclad-design/11-ssot-refinement-ears.md §2.3 — YAML schema.
 */
export interface AcceptanceCriterion {
  /** Tracking-only id, never user-visible. */
  readonly id: string;
  /** EARS Trigger ('When/While/If …'). */
  readonly condition?: string;
  /** EARS Action ('the system shall …'). */
  readonly action?: string;
  /** EARS expected result. */
  readonly response?: string;
  /** Which of the 5 EARS patterns governs `condition`. */
  readonly ears?: EarsPattern;
  /** Pre-rendered user-facing sentence (Soft Shell). */
  readonly text?: string;
  /**
   * Concrete code-test paths that verify this AC.
   *
   * Restrict to executable test files (e.g. `tests/foo.test.ts`,
   * `*.test.ts`, `__tests__/*`). Non-test evidence — npm scripts,
   * fixtures, docs — belongs in {@link evidence_refs}.
   *
   * @see stages/detectors/missing-tests.ts — flags `done` ACs that
   *      have neither `test_refs` nor `evidence_refs`.
   */
  readonly test_refs?: readonly string[];
  /**
   * Non-test verification artifacts that satisfy MISSING_TESTS:
   * `script:NAME` (npm script), `fixture:NAME` (conformance
   * fixture), or a doc/report path. Use this when the AC's truth
   * is established by running a command or by a curated artifact
   * rather than a vitest assertion.
   *
   * @see spec/features/F-052.yaml — introduced 2026-05-19 to
   *      separate code-tests from other evidence kinds.
   */
  readonly evidence_refs?: readonly string[];
  /** Free-form context. */
  readonly notes?: string;
  /** ADR ids backing this AC. */
  readonly adr_refs?: readonly string[];
}

/** One atomic feature in the SSoT. */
export interface Feature {
  /** Stable id, e.g. `F-001`. */
  readonly id: string;
  readonly title: string;
  readonly status: FeatureStatus;
  /** File paths this feature touches. */
  readonly modules?: readonly string[];
  readonly acceptance_criteria?: readonly AcceptanceCriterion[];
  /** Feature ids this one depends on. */
  readonly depends_on?: readonly string[];
  readonly archived_at?: string;
  readonly archive_reason?: string;
  readonly superseded_by?: string;
}

/** Cross-feature user flow. */
export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly flow?: string;
  readonly features?: readonly string[];
}

/**
 * One layer entry in the object-form architecture schema. The LLM
 * onboarding pass emits this shape (`{name, modules, forbidden_imports[]}`)
 * because it lets each layer carry per-layer metadata (glob patterns,
 * destination-only forbid list). Cladding's own spec uses the canonical
 * tiered string[][] shape; both are valid since v0.3.49 (F-99c6e5).
 */
export interface ArchitectureLayerObject {
  readonly name?: string;
  readonly modules?: readonly string[];
  readonly forbidden_imports?: readonly string[];
}

/** Architecture constitution. */
export interface Architecture {
  /**
   * Allowed import topology. Two interchangeable shapes:
   *
   *   1. **Canonical** (cladding's own spec): `string[][]` — each entry is
   *      a tier (peer group of layer names) ordered top → bottom.
   *      Forbidden-import rules live at the top-level `forbidden_imports`.
   *
   *   2. **Object form** (LLM onboarding output): `ArchitectureLayerObject[]`
   *      — each entry is a single layer with its own `forbidden_imports[]`
   *      list naming the destinations it must not import.
   *
   * The `ARCHITECTURE_FROM_SPEC` detector normalizes both at runtime via
   * `normalizeArchitecture(arch)`.
   */
  readonly layers?: readonly (readonly string[] | ArchitectureLayerObject)[];
  /** Pairs `from -> to` that must not import each other (canonical form). */
  readonly forbidden_imports?: readonly {readonly from: string; readonly to: string}[];
}

/** Project-level metadata. */
export interface Project {
  readonly name: string;
  readonly language: string;
}

/** Root SSoT document. */
export interface Spec {
  /** Schema version. Bumped on breaking shape change. */
  readonly schema: string;
  readonly project: Project;
  readonly features: readonly Feature[];
  readonly scenarios?: readonly Scenario[];
  readonly architecture?: Architecture;
}
