// Cladding · spec types — minimal v0.1
//
// SSoT data model. Captures the 3-tier shape from ironclad-design's
// 07-ssot-init.md (scenarios + features + architecture) plus the EARS
// 5-pattern AC structure from 11-ssot-refinement-ears.md. Scenarios and
// architecture are optional in this brick — they unlock with later T2
// bricks (sharding + per-tier validators).

/** EARS pattern enum — see ironclad/ears.md (6 canonical patterns). */
export type EarsPattern =
  | 'ubiquitous'
  | 'event'
  | 'state'
  | 'optional'
  | 'unwanted'
  | 'complex';

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
  /** Feature-bound decision recording whether Tier-B design must evolve. */
  readonly design_impact?: {
    readonly classification: 'none' | 'additive' | 'structural';
    readonly rationale: string;
    readonly status: 'resolved' | 'review_required';
    readonly artifacts?: readonly string[];
    readonly baseline_digests?: Readonly<Record<string, string>>;
  };
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
   * Glob(s) naming the files in this layer, as the deterministic scan
   * renderer emits them (`renderArchitectureYaml`, src/cli/scan/llm.ts) on
   * `clad init --scan`.
   *
   * PARTIALLY CONSUMED, by exactly one detector:
   *   · `UNMAPPED_ARTIFACT` (F-87bb7ed3, AC-96ff696f) takes these globs as
   *     the layer's scan universe, so a layer whose `name` is not a literal
   *     path segment is still scanned where its declaration points.
   *   · `ARCHITECTURE_FROM_SPEC` still derives a layer's directory from
   *     `name` (`<mainRoot>/<name>/`) and does NOT read these globs — the
   *     deliberate J5b decision recorded in
   *     spec/features/ac-hash-ids-a04cd9.yaml (AC-003). Its forbidden-import
   *     and empty-layer checks therefore remain name-based.
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

/**
 * The project's primary runnable deliverable (entry point) — the artifact a user
 * actually invokes (e.g. `./run`, `./bin/cli`). DELIVERABLE_SMOKE (stage_2.4)
 * EXECUTES it on `smoke_args` once any feature is `done`, asserting it does not
 * crash — closing the "broken entry shipped green" gap that unit tests (which
 * import internals, never the entry) structurally miss. Side-effect-bearing, so
 * the gate runs it ONLY when the author vouches via `is_safe_to_smoke`. The
 * companion pure detector DELIVERABLE_INTEGRITY flags a declared-but-missing path
 * and warns when done features ship modules with no deliverable declared.
 * v0.5.x. See stages/deliverable-smoke.ts.
 */
export interface Deliverable {
  /** Executable entry path relative to the project root (e.g. `./run`). Must be directly runnable (shebang + exec bit) or an interpreter. */
  readonly path: string;
  /** Args passed to the entry for the smoke run (e.g. `['--version']`). Default `[]`. */
  readonly smoke_args?: readonly string[];
  /** Exit code that means success. Default `0`. */
  readonly expect_exit?: number;
  /** Hard timeout for the smoke run, ms. Default `5000`. */
  readonly timeout_ms?: number;
  /**
   * The gate executes the entry ONLY when this is `true` — the author's explicit
   * vouch that running it on `smoke_args` has no harmful side effects. Default
   * falsy ⇒ DELIVERABLE_SMOKE skips (declaration-gated; never auto-runs arbitrary
   * project code). A server/stateful entry should leave this false and rely on the
   * impl-blind oracle instead.
   */
  readonly is_safe_to_smoke?: boolean;
}

/** Expected result of a smoke probe (F-g'). */
export interface SmokeProbeExpect {
  /** AC id this probe verifies. */
  readonly ac?: string;
  /** Exit code that means success. Default 0. */
  readonly exit?: number;
  /**
   * AC-observable token the deliverable must emit on stdout. Present + matched ⇒
   * a green PASS; ABSENT ⇒ the clean run is exit-only LIVENESS (non-green).
   */
  readonly token?: string;
}

/**
 * A functional smoke probe (F-g'). The gate RE-EXECUTES it (LLM proposes / gate
 * disposes): kind:cli runs `run` argv and asserts exit (+ optional token);
 * kind:none has nothing to run (library/static) ⇒ N/A. Disposition mapping lives
 * in stages/disposition.ts; the runner is stages/deliverable-smoke.ts.
 */
export interface SmokeProbe {
  readonly kind: 'cli' | 'none';
  /** argv for kind:cli (no shell); cwd = project root. */
  readonly run?: readonly string[];
  readonly expect?: SmokeProbeExpect;
  /**
   * Per-feature binding (F-4ef09f38) — the F-id this probe demands. Makes probe
   * demand per-feature instead of project-global:
   *   bound to a NOT-done feature ⇒ disposition `na`, argv NOT executed (nothing
   *     shipped yet ⇒ nothing to smoke);
   *   bound to a DONE feature ⇒ executes regardless of the project-global anyDone
   *     rule (that specific thing shipped, so smoke it);
   *   UNBOUND (omitted) ⇒ keeps the project-global anyDone gating unchanged.
   * A dangling id (no matching feature in the spec) is annotation drift —
   * SMOKE_PROBE_DEMAND warns (same disease as stale test_refs).
   */
  readonly feature?: string;
  readonly binds?: {readonly feature?: string; readonly modules?: readonly string[]};
  /** Why this probe proves the AC (Why>What). */
  readonly why?: string;
}

/** Project-level metadata. */
export interface Project {
  readonly name: string;
  readonly language: string;
  /**
   * True only for workspaces scaffolded by Cladding onboarding. Detectors use
   * this durable marker to distinguish intentional future-design seeds from
   * empty governance in legacy or hand-authored projects.
   */
  readonly onboarding_seeded?: boolean;
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
   * Independence policy (F-c566f590). Governs the evidence-based independence
   * label (`independent` | `self-certified`) that `clad done` / `clad verdict`
   * compute per feature:
   *   - `'label'`   — the default when absent: annotate only, never block.
   *   - `'require'` — additionally REFUSE to keep a self-certified feature done;
   *     a GREEN gate no longer suffices, the feature needs human or blind
   *     (independent) evidence first.
   * Additive: absent = today's label-only behavior. See hitl/independence.ts.
   */
  readonly independence_policy?: 'label' | 'require';
  /**
   * AI behavior hints — preferred persona, token budget, forbidden patterns.
   * Added v0.3.56 (F-5b9f9f).
   */
  readonly ai_hints?: AiHints;
  /**
   * The project's runnable deliverable/entry. When declared with
   * `is_safe_to_smoke: true`, DELIVERABLE_SMOKE (stage_2.4) executes it once a
   * feature is done to prove the shipped entry actually runs. See Deliverable.
   */
  readonly deliverable?: Deliverable;
  /**
   * Functional smoke probes (F-g'). The gate RE-EXECUTES each: a cli probe whose
   * stdout contains `expect.token` reads PASS; an exit-only probe (no token) reads
   * LIVENESS (non-green); kind:none reads N/A. When present, takes precedence over
   * the legacy `deliverable` in stage_2.4. See stages/deliverable-smoke.ts.
   */
  readonly smoke?: readonly SmokeProbe[];
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
  /** Legacy — no longer written (F-6e49fd24). Kept optional so older spec.yaml files still parse + validate. */
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
