# SSoT document-system audit — v0.4.x

*Audit date: 2026-05-31. Method: 8-agent workflow (4 mappers + 4 adversarial verifiers) reading the
real repo + the A/B evaluation evidence (`/tmp/clad-abtest/B` 23-feature passive build,
`/tmp/clad-abtest/B2` 6-feature driver build). Every claim below was independently verified against
source.*

## Why this audit exists

The A/B builds both produced a healthy **feature** tier and an **empty design tier**: `scenarios = 0`,
`spec/capabilities.yaml` = `capabilities: []`, `spec/architecture.yaml` = `layers: []`,
`project-context.md`/`conventions.md` = unrefined init seeds — and `clad check --strict` stayed
**GREEN**. That prompted the question "are the *other* SSoT documents actually managed?". The answer
is no — and chasing it surfaced deeper structural fractures between what `docs/ssot-model.md` declares
and what the code loads, validates, and binds.

## The verdict in one line

The 4-tier **model is sound**, but only the **feature** tier is actually enforced and continuously
fired; the design tier (B), the derived tier (C), and scenarios are asymmetric across necessity,
structure, firing, and honesty.

---

## Q1 — Is each document needed?

At the **file** level, yes; each file has a distinct consumer. The one clear redundancy is at the
**field** level:

- **`project.description` ≡ `project.intent_summary`** — the schema defines them as the same semantic
  slot, `clad init` seeds both from the identical `oneLine(intent)` string (byte-identical in both A/B
  specs), and `intent_summary` has **zero runtime consumers** (no detector, no persona reads it). It
  can be collapsed into `description`.
- `project-context.md` is the **weakest** file — its only runtime reader is `clad refine`
  (`refine.ts:243`); its §3 prose near-duplicates `intent_summary`.
- `conventions.md` (Tier C, observed) vs `ai_hints` (Tier B, policy) are **not** redundant — different
  roles, and only `ai_hints.forbidden_patterns` is enforced (`AI_HINTS_FORBIDDEN_PATTERN`, #27).
- `scenarios` are distinct from acceptance_criteria (cross-feature flow vs in-feature verification).

## Q2 — Is the structure correct? (the surprising findings)

The model is coherent, but policy and code have diverged:

| # | severity | fracture |
|---|---|---|
| 1 | 🔴 high | **`capabilities.yaml` is absent from `schema.json` and never loaded into the typed `Spec`** — `ssot-model.md` calls Tier B "equal authority, cross-validated", but capabilities has no schema, no parse-time validation; one soft detector + the inventory counter read it ad-hoc. |
| 2 | 🔴 high | **`architecture` object-form `layer.modules: [<glob>]` is a dead link** — the schema invites it and LLM onboarding emits it, but `ARCHITECTURE_FROM_SPEC` never reads it (it treats `layer.name` as a `src/` dir). |
| 3 | 🔴 high | **`depends_on` DAG has no cycle detection** — a cycle makes `nextReady` silently deadlock (misreported `BLOCKED_FEATURE`); `REFERENCE_INTEGRITY` checks existence, not acyclicity. |
| 4 | 🔴 high | **Policy-vs-code drift** — `ssot-model.md:48,165` claim `clad_create_feature` binds scenarios via `features[]`, but `new.ts createFeature` takes no scenario argument and writes none. |
| 5 | 🟡 med | **AC ids are sequential-only** (`^AC-\d{3,}$`) while features/scenarios are hash-safe — reintroduces the merge collision the hash model eliminated, inside a shared shard. |
| 6 | 🟡 med | **`Feature` has no scenario/capability back-reference** — links are one-directional (capability→feature, scenario→feature). |
| 7 | 🟡 med | `INVENTORY_DRIFT` only fires when an `inventory:` block is declared — omit the block and the check is skipped. |

The sharded-vs-inline heuristic and the tier-by-directory layout are **sound**.

## Q3 — Where does each document fire (create + sync)?

Firing is **bimodal**:

| tier | created by | kept in sync during development |
|---|---|---|
| features / scenarios | create tools + the cycle | **thick detector suite + `clad done`** ✓ |
| events / audit (D) | append-only runners | observability / doctor ✓ |
| capabilities (B) | `clad init` seed (`[]`) / refine | **nothing** — write-once, then orphaned |
| architecture (B) | `clad init` seed (`layers:[]`) / scan / refine | **nothing** |
| project-context (B) | `clad init` / refine | **nothing** (`PROJECT_CONTEXT_DRIFT` deferred) |
| conventions (C) | `clad init --scan` / seed | `CONVENTION_DRIFT` (warn, anchor-dependent) |

The design tier (B) and derived tier (C) are **write-once at onboarding, then orphaned** — no
per-feature step re-touches them. And when the onboarding LLM does not fire (headless, no key), the
deterministic **empty seeds are written to disk**, satisfying the existence check and passing GREEN.

## Q4 — Enforcement & honesty: the two-layer Vacuous Green (confirmed, reproduced)

1. **Existence-only governance** — `ABSENCE_OF_GOVERNANCE` checks `existsSync` only; `clad init` seeds
   every file, so the check is always satisfied (a seeded-but-empty file is "present").
2. **Empty-content no-op** — `CAPABILITIES_FEATURE_MAPPING` does `if (capabilities.length === 0) return []`;
   `ARCHITECTURE_FROM_SPEC` gates its checks behind `if (layers.size > 0)`. Empty content → zero findings.

Verified empirically: running the three detectors against `/tmp/clad-abtest/B` (23 features,
`capabilities:[]`, `layers:[]`) yields **0 blocking findings under `--strict`**.

**Enforcement asymmetry:** features carry ~10 error-grade detectors + the `clad done` floor; capabilities
and architecture each get one *empty-tolerant* soft detector; scenarios get only referential validation
(0 scenarios = 0 work); project-context and conventions get **no** content detector.

> **Important nuance (verifier-caught):** the fix is **not** a literal `PLANNED_BACKLOG` mirror.
> `PLANNED_BACKLOG` is status-aware (counts only `planned`/`in_progress`), but the A/B's 23 features are
> all `done` — a faithful mirror would no-op on the exact case we want to catch. The design-tier gate
> must be **status-blind** on total feature/source count.

---

## Fix roadmap (this branch — "no vacuous green")

- [x] **J1 · 🔴 `HOLLOW_GOVERNANCE` detector (#30)** — status-blind, scale-aware (features ≥ 8 AND
  `capabilities`/`architecture.layers` present-but-empty → `warn`, strict-blocking). Closes the
  two-layer Vacuous Green; division of labour with ABSENCE (existence) vs HOLLOW (present-but-empty).
  Verified: arm B (23 feat) → 2 warns, B2 (6) → 0, cladding (full tiers) → 0. Shard F-f44d1b (done).
- [x] **J2 · 🔴 capabilities → `schema.json` + `Spec`** — `Capability` type + `definitions.capability`
  + `load.ts` merges `spec/capabilities.yaml` into `Spec.capabilities`, so Tier B is schema-validated
  at parse time (a malformed capability now fails `loadSpec`). Feature-ref pattern matches scenarios;
  existence stays CAPABILITIES_FEATURE_MAPPING's job. Shard F-f6d13e (done).
- [x] **J3 · 🔴 `DEPENDENCY_CYCLE` detector (#31)** — DFS three-colour cycle detection over
  `features[].depends_on`; error per distinct cycle (deduped). Only edges to existing features are
  traversed (dangling deps stay REFERENCE_INTEGRITY's job). Closes the silent `nextReady` deadlock.
  Shard F-a4b512 (done).
- [x] **J4 · 🔴 reconcile `ssot-model.md` with code** — corrected the false "`clad_create_feature`
  binds scenarios" claim (it has no scenario arg); updated the capabilities row to reflect J2
  (schema-loaded) + HOLLOW_GOVERNANCE; added the v0.4.x detectors (INVENTORY_DRIFT, PLANNED_BACKLOG,
  HOLLOW_GOVERNANCE, DEPENDENCY_CYCLE, AI_HINTS_FORBIDDEN_PATTERN) to the enforced list and noted
  what the deferred detectors now partly cover. (`layer.modules` dead-link + `intent_summary` collapse → J5.)
- [ ] **J5 · 🟡 MED, as scope allows** — AC hash-ids (dual pattern), `layer.modules` consume-or-remove,
  collapse `intent_summary` into `description`.

*This document is the living record of the journey; each item is ticked as its fix lands.*
