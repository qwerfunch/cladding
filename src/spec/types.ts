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
   * Path(s) to the impl-blind spec-conformance oracle file(s) that verify
   * this AC. Expected under `tests/oracle/` — the dir stage_2.3
   * (runSpecConformance) executes. Parallel to {@link test_refs} but carries
   * the SPEC-derived oracle (authored without sight of the impl), not the
   * author's own test.
   *
   * @see stages/detectors/spec-conformance.ts — resolves each ref to disk
   *      (INTEGRITY) and, when project.require_oracles is set, requires a
   *      done AC to declare at least one (MANDATORY).
   */
  readonly oracle_refs?: readonly string[];
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
  /** Kebab-slug (the shard filename stem); optional on legacy `F-NNN` shards. */
  readonly slug?: string;
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
  /**
   * ADVISORY (not yet enforced). Glob(s) naming the files in this layer.
   * `ARCHITECTURE_FROM_SPEC` currently derives a layer's directory from
   * `name` (`src/<name>/`) and does NOT consume these globs — so a declared
   * `modules` is documentation for humans/reviewers, not a live binding. The
   * LLM onboarding prompts no longer emit it (v0.4.x). Making the detector
   * consume these globs is a tracked follow-up (docs/ssot-audit.md, J5b).
   */
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

/**
 * One advisory preferred-pattern entry. Tells AI agents what to use
 * in a given context (e.g. `{when: "React state", prefer: "useState"}`).
 * Advisory only — no detector enforces these. AI agents read them at
 * session start and self-follow. v0.3.58+ (F-32b1e0).
 */
export interface PreferredPattern {
  /** Context where the preference applies. */
  readonly when: string;
  /** Pattern to prefer in that context. */
  readonly prefer: string;
  /** Optional — pattern to avoid in favor of `prefer`. */
  readonly over?: string;
}

/**
 * AI behavior hints. Loaded by AI agents (Claude Code, Cursor, etc.)
 * at session start so they don't have to grep CLAUDE.md or rediscover
 * conventions. All fields optional. Added v0.3.56 (F-5b9f9f).
 */
export interface AiHints {
  /** Persona prompt the AI should default to (e.g. 'software-engineer'). */
  readonly preferred_persona?: string;
  /** Soft per-session token budget. */
  readonly token_budget_per_session?: number;
  /** Preferred test framework slug (e.g. 'vitest'). */
  readonly test_framework?: string;
  /** Branch new feature work should target by default. */
  readonly primary_branch?: string;
  /** Identifier substrings the AI should refuse to introduce. */
  readonly forbidden_patterns?: readonly string[];
  /**
   * Advisory preferred-pattern triples (when / prefer / over?). AI
   * agents read these at session start; no detector enforces them.
   * Companion to forbidden_patterns. Added v0.3.58 (F-32b1e0).
   */
  readonly preferred_patterns?: readonly PreferredPattern[];
}

/**
 * Risk-weighted oracle requirement (v0.5.x). Replaces the all-or-nothing
 * `require_oracles` boolean: instead of demanding an impl-blind oracle for
 * EVERY done AC, demand one only for the high-risk EARS categories
 * (`always_ears`) plus a deterministic `sample` fraction of the rest. v8
 * showed exhaustive oracles add ~0 quality at ~30% cost — so the oracle is
 * priced as opt-in governance insurance. Takes precedence over
 * `require_oracles`. See oracle/policy.ts + stages/detectors/spec-conformance.ts.
 */
export interface OraclePolicy {
  /**
   * EARS categories whose `done` ACs ALWAYS require an oracle. Defaults to
   * `['unwanted']` (error/edge handling — where failures cluster) when omitted.
   */
  readonly always_ears?: readonly EarsPattern[];
  /**
   * Deterministic fraction [0,1] of the remaining (non-`always_ears`) done ACs
   * that also require an oracle. 0 = only `always_ears`; 1 = exhaustive.
   * Default 0 when omitted.
   */
  readonly sample?: number;
}

/** Project-level metadata. */
export interface Project {
  readonly name: string;
  readonly language: string;
  /**
   * One-line summary of what the project is for. Renders as the
   * spec.yaml "front door" hint. Optional — kept opt-in so legacy
   * minimal spec.yaml (`{name, language}` only) remains valid.
   *
   * Added v0.3.49 (F-3a5339).
   */
  readonly description?: string;
  /** Current project version, free-form (e.g. '0.3.49'). Optional. */
  readonly version?: string;
  /** Source-repository URL. Optional. */
  readonly repository?: string;
  /**
   * TL;DR of `docs/project-context.md`. One sentence answering
   * "what problem does this project solve?". Optional.
   */
  readonly intent_summary?: string;
  /**
   * Opt-in: when true, every `status: done` AC must declare `oracle_refs`
   * (the SPEC_CONFORMANCE MANDATORY rule, EXHAUSTIVE). Default falsy → the
   * detector enforces only INTEGRITY of declared refs, staying inert on legacy
   * projects. Superseded by `oracle_policy` when that is present (risk-weighted
   * wins over the all-or-nothing boolean). See stages/detectors/spec-conformance.ts.
   */
  readonly require_oracles?: boolean;
  /**
   * Risk-weighted alternative to `require_oracles` — demand oracles only for
   * high-risk + a deterministic sample of done ACs. Takes precedence over
   * `require_oracles`. See OraclePolicy + oracle/policy.ts.
   */
  readonly oracle_policy?: OraclePolicy;
  /**
   * AI behavior hints — preferred persona, token budget, forbidden patterns.
   * Added v0.3.56 (F-5b9f9f).
   */
  readonly ai_hints?: AiHints;
}

/**
 * Auto-maintained shard counts written by `clad sync`. Provides
 * 1-file lookup for AI agents asking "how big is this spec?" so they
 * don't have to walk spec/features/, spec/scenarios/, etc. Added
 * v0.3.56 (F-5b9f9f).
 */
export interface Inventory {
  readonly features?: number;
  readonly scenarios?: number;
  readonly capabilities?: number;
  readonly test_files?: number;
  /** ISO-8601 timestamp of the last sync that touched this block. */
  readonly last_synced?: string;
}

/** Where a capability surfaces to its consumer. */
export type CapabilitySurface = 'feature' | 'platform' | 'tool' | 'infrastructure';

/**
 * One Tier-B capability — a user-facing or platform-level grouping that
 * `features[]` implement. Loaded from `spec/capabilities.yaml` into the typed
 * Spec so it is schema-validated at parse time (not just read ad-hoc by a
 * detector). `CAPABILITIES_FEATURE_MAPPING` validates each `features[]` id
 * resolves to a real feature. Added v0.4.x (J2 of the SSoT-audit roadmap).
 */
export interface Capability {
  /** kebab-slug id, unique within capabilities.yaml. */
  readonly id: string;
  readonly title?: string;
  readonly summary?: string;
  readonly surface?: CapabilitySurface;
  /** Feature ids that implement this capability. */
  readonly features?: readonly string[];
}

/** Root SSoT document. */
export interface Spec {
  /** Schema version. Bumped on breaking shape change. */
  readonly schema: string;
  readonly project: Project;
  readonly features: readonly Feature[];
  readonly scenarios?: readonly Scenario[];
  readonly architecture?: Architecture;
  /**
   * Tier-B capabilities, merged from `spec/capabilities.yaml`. Optional —
   * a small project may have none. Added v0.4.x (J2).
   */
  readonly capabilities?: readonly Capability[];
  /**
   * Auto-maintained shard counts. `clad sync` rewrites this block on
   * every run. Added v0.3.56 (F-5b9f9f).
   */
  readonly inventory?: Inventory;
}
