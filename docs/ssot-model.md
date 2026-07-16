<!-- Cladding · Tier B · governance policy · Refreshed by: manual -->

# Cladding SSoT Governance Model

**The single policy document for cladding's artifact landscape.** Every persona, skill, and detector reads this once and references it instead of repeating policy in their own prompts.

## Why this document exists

Through v0.3.41–v0.3.44 the init/scan/refine pipeline grew several artifacts (`spec/architecture.yaml`, `spec/capabilities.yaml`, `docs/project-context.md`, `.cladding/onboarding/state.yaml`). Without a single governance doc, three problems emerged:

1. **Personas repeated tier policy** — each persona prompt told its own version of "read this, write that". Token cost grew linearly with persona count.
2. **Some artifacts became orphans** — `spec/capabilities.yaml` had no functional consumer; `docs/project-context.md` was only "soft AI context"; `spec/scenarios/*.yaml`'s `flow` field had no consumer.
3. **No path-encoded tier** — a reader had to know each artifact's role from memory.

This doc fixes all three: define tiers in one place, declare each artifact's producer + consumer, standardize headers so tier is encoded inline.

## The 4-Tier model

| Tier | Definition | Authority | Edit policy | Entry condition |
|---|---|---|---|---|
| **A — Spec SSoT** | Iron Law gated, schema-validated | sealed | edits flow through `clad_create_feature` MCP tool or hand-author with `clad sync` validation | code/detector consumes it directly |
| **B — Design SSoT** | user decisions, edit-friendly, cross-validated with A | equal to A; conflict resolution = A wins | hand-editable; next refresh diverts new body to `.cladding/scan/*.proposal` | **must have a clear consumer** (detector OR persona context input OR producer for another artifact) |
| **C — Derived / Observable** | derived from code or observation | mirror of code; can be refreshed | hand-editable; user edits become proposal-diverted on next scan | humans/AI reference when coding |
| **D — Audit / Transient** | append-only logs OR end-of-lifecycle state | history; do not hand-edit | append-only via `appendEvent` / `saveState` | diagnostics input (`clad doctor`), human audit |

### Tier B entry condition (strict)

A Tier B artifact must answer: **who reads this and what decision do they make?**

- "AI persona reads it for general context" — OK if at least one persona prompt names it specifically
- "Detector validates it" — OK
- "Other artifact derives from it" — OK
- "Someone might find it useful one day" — **NOT OK** (orphan)

Orphan artifacts get demoted (move to Tier D as historical reference) or removed. This cycle resolves the v0.3.45 orphans:
- `spec/capabilities.yaml` gains the `CAPABILITIES_FEATURE_MAPPING` detector
- `docs/project-context.md` becomes the scenario generator's source (clear, named role)
- `spec/scenarios/*.yaml` gains a clear producer (onboarding / `clad_create_scenario`) and consumer (the reference detectors + the host AI). The public `clad_create_feature` transaction may bind an existing scenario when its design impact is additive; the lower-level `createFeature` helper stays single-purpose.

## Artifact registry

### Tier A — Spec SSoT

| Artifact | Producer | Consumer | Refresh trigger |
|---|---|---|---|
| `spec.yaml` | `clad_create_feature` / hand-edit | `spec/load.ts` → every detector + MCP server + CLI verbs | manual edit; `clad sync` validates |
| `spec/features/<slug>-<hash6>.yaml` | `clad_create_feature` | merged into `Spec.features[]` on load | manual edit + validation |
| `spec/scenarios/<slug>-<hash6>.yaml` | `clad init <intent>` onboarding (NEW v0.3.45) OR `clad_create_scenario` OR hand-edit | `REFERENCE_INTEGRITY` / `SLUG_CONFLICT` / `ID_COLLISION` / `SCENARIO_COVERAGE` detectors | onboarding 7th sentinel emits; clarify refreshes; `clad_create_scenario` adds. *(`clad_create_feature` does NOT bind scenarios — corrected v0.4.x.)* |

### Tier B — Design SSoT

| Artifact | Producer | Consumer | Refresh trigger |
|---|---|---|---|
| `spec/architecture.yaml` | `clad init --scan` (observed) OR `clad init <intent>` (LLM) OR `clad clarify` OR hand-edit | `ARCHITECTURE_FROM_SPEC` detector + `reviewer` (Layered Integrity guardrail) + `developer` (layer boundary check when placing modules) | re-scan diverts to `.cladding/scan/*.proposal` |
| `spec/capabilities.yaml` | `clad init <intent>` (LLM) OR `clad clarify` OR hand-edit | **schema-validated + merged into `Spec.capabilities` on load (v0.4.x, J2)** + `CAPABILITIES_FEATURE_MAPPING` (reference validity) + `HOLLOW_GOVERNANCE` (empty-tier guard, v0.4.x) | re-scan diverts to proposal |
| `docs/project-context.md` | `clad init` (template/LLM-refined) OR `clad clarify` OR hand-edit | AI personas (orchestrator/developer) as Why/What/Purpose context input + **scenario generator (NEW v0.3.45) uses prose for user-journey extraction** + human onboarding readers | LLM-refined on init/clarify; hand-edits preserved between |

### Tier C — Derived / Observable

| Artifact | Producer | Consumer | Refresh trigger |
|---|---|---|---|
| `docs/conventions.md` | `clad init --scan` (observed 14-signal table) OR greenfield seed (toolchain defaults) | `developer` (when writing code) + human reviewers | re-scan diverts to proposal |
| `docs/code-style.md` | hand-authored (legacy; cladding-self only) | cladding contributors (legacy reference) | manual; will deprecate in favour of conventions.md |

### Tier D — Audit / Transient

| Artifact | Producer | Consumer | Refresh trigger |
|---|---|---|---|
| `.cladding/events.log.jsonl` | every stage runner, checkpoint, drive loop, sentinel-miss emitter | `observability` persona + `clad doctor` + MCP resource subscriptions | append-only |
| `.cladding/audit.log.jsonl` | evidence recorders (checkpoint, postmortem, manual signoff) | anti-self-cert validator + `clad rollback` | append-only |
| `.cladding/onboarding/state.yaml` | `clad init <intent>` + `clad clarify` | `orchestrator` (drives Q&A loop) + `clad clarify` itself | mutated on each clarify; persists post-`status: done` as audit |
| `.cladding/scan/*.proposal` | `writeArtifact` divert when target file already exists | humans review + manually accept/reject | one-shot per scan run |

## Authoring verbs — create vs link vs refine (v0.4.x)

The write surface uses three verbs, picked by the *shape* of the artifact — not one
catch-all "create". Matching the verb to the artifact's nature keeps each tool
single-responsibility (and keeps a tool's name honest as it grows).

| Verb | Artifact shape | Operation | Tools |
|---|---|---|---|
| **create** | enumerable ENTITY (many per project, each distinct) | mint a NEW shard | `clad_create_feature`, `clad_create_scenario` |
| **link** | accumulative RELATIONSHIP (a grouping that grows over time) | UPSERT — ensure-and-add | `clad_link_capability` (add a feature to a capability, creating it if absent) |
| **refine** | holistic DOCUMENT (one per project, not enumerated) | LLM/manual rewrite | `clad clarify` (formerly `refine`) → `architecture.yaml`, `project-context.md`, `conventions.md` |

A capability is **accumulative** (created once, then features land on it over time),
so its underlying verb remains `link`, not `create`. The public `clad_create_feature`
transaction requires a design-impact decision: `additive` composes that link (and an
optional scenario link) with feature creation; `structural` records the affected Tier-B
artifacts as `review_required` until their approved contents actually change.

## Capturing WHY — the decision micro-format (Tier A content)

An `acceptance_criteria` entry captures **WHAT** (`action`) and the **outcome** (`response`); the **WHY** — the
decision, the invariant it protects, the trade-off it accepts — has no designated home, so it leaks
inconsistently into `text`/`response` (e.g. `F-7afbd4` AC-002/AC-004) or is missing (AC-003's flip-before-gate
ordering), letting a future reader/agent "fix" an AC the wrong way.

**Convention:** record WHY in the existing free-form `notes` field — no schema change, no detector:

```yaml
    notes: |
      ## Decision  flip status→done BEFORE the gate, not after.
      ## Why       a still-`planned` feature lets UNTESTED_AC/MISSING_TESTS skip it → done without test evidence.
      ## Trade-off mutating before verifying forces the byte-exact revert in AC-002.
```

It is the inverse of spec-kit's per-feature `plan.md`/`research.md` files — the same concern-separation at ~1%
of the volume, inside the shard. Two disciplines keep it compact and rot-resistant:

- **TRIGGER** — write a note ONLY when a future reader could "fix" the AC the wrong way without the reason
  (non-obvious ordering, invariant, trade-off); skip obvious ACs. Load-bearing notes get re-touched with the
  code, so they rot less than boilerplate.
- **LOCATION** — requirement-level WHY → `notes`; implementation-level WHY → a code comment co-edited with the impl.

**Advisory, not gated, on purpose:** a mandatory-empty field would mass-fail the gate, and soft fields reach
<20% adoption. Partial coverage on load-bearing decisions still beats zero. Promote to a typed field +
warn-only detector ONLY if sustained adoption proves it maintained.

## Header convention

Every cladding-managed artifact carries a one-line tier banner as its **first line**:

```
<!-- Cladding · Tier <A|B|C|D> · <authority claim> · Refreshed by: <verb-or-manual> -->
```

For YAML files, use `# ` comments. For JSON/TOML, the convention defers to the first available comment syntax (or a key prefix where comments aren't allowed).

### Examples

| Path | Header |
|---|---|
| `spec.yaml` | `# Cladding · Tier A · SSoT — Iron Law sealed · Refreshed by: clad_create_feature / manual` |
| `spec/architecture.yaml` | `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify` |
| `spec/capabilities.yaml` | `# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify` |
| `spec/scenarios/<slug>-<hash6>.yaml` | `# Cladding · Tier A · SSoT — onboarding output, edit-friendly · Refreshed by: clad init / clad clarify` |
| `docs/project-context.md` | `<!-- Cladding · Tier B · SSoT — intent + Why/What/Purpose · Refreshed by: clad init / clad clarify -->` |
| `docs/conventions.md` | `<!-- Cladding · Tier C · derived from observed code · Refreshed by: clad init --scan -->` |
| `.cladding/onboarding/state.yaml` | `# Cladding · Tier D · transient — Q&A audit · Refreshed by: clad init / clad clarify` |

**Why first line, not embedded metadata?** A reading persona (or AI host) can fetch the first line via a cheap read (`head -1`) without loading the body. Tier identification becomes a constant-cost operation regardless of artifact size.

## Directory policy

**Directories encode domain; tier is encoded by the header banner + this registry.**

| Directory | Domain | Tier mix |
|---|---|---|
| `spec/` | structured spec data | A (spec.yaml, features/, scenarios/) + B (architecture.yaml, capabilities.yaml) |
| `docs/` | human-readable documentation | B (project-context.md) + C (conventions.md, code-style.md) |
| `.cladding/` | runtime + audit | D (events.log, audit.log, onboarding/, scan/) |
| `src/` | implementation code | (not artifact tier — code lives here) |
| `tests/` | test suites | (not artifact tier) |

Mixed-tier directories are **intentional**:
- `spec/architecture.yaml` belongs next to `spec.yaml` (same format, related schema) — placing it under a `tier-b/` directory would obscure its sibling relationship to features.
- `docs/project-context.md` belongs in `docs/` because it's prose for human reading — placing it under `tier-b/` would obscure its prose role.

Reorganizing to `tier-a/`/`tier-b/`/`tier-c/` was considered and rejected:
- ~1500 LOC change across all detectors (every detector hardcodes paths like `spec/`, `docs/`)
- breaks upstream Ironclad standard compatibility
- breaks every external project's cladding workspace
- benefit (path-encoded tier) is already provided by the header banner

Directory README pointers (`spec/README.md`, `docs/README.md`) carry a small "Tier index" paragraph so a reader landing in a directory sees the tier map for that directory's contents without leaving.

## Persona reading map (what to load when)

Personas should load only the tiers they need for the task. Token cost scales with what's loaded; loading less is faster.

| Persona | Always reads | When relevant | Never reads |
|---|---|---|---|
| `planner` | Tier A (write target) | Tier B (cross-validate with current feature edit) | Tier D (let observability handle audit) |
| `developer` | Tier B (project-context for intent, architecture for layer boundary) + Tier C (conventions when writing) | Tier A (current feature slice only — see Least Context principle 5) | Tier D |
| `reviewer` | Tier A + Tier B + Tier C (whole context for audit) | Tier D evidence when validating anti-self-cert | — |
| `orchestrator` | Tier B (project-context for routing) + Tier D `state.yaml` (Q&A loop) + Tier D `events.log` (audit-log slice for hand-off) | Tier A dispatch slice only (never the whole spec — Least Context principle 5) | — |
| `observability` | Tier D (events.log + audit.log + perf + coverage) | — | Tier A / B / C (out of scope) |

## Cross-document consistency rules

Detector-enforced (today + this cycle):
- `UNMAPPED_ARTIFACT`: every `src/` file claimed by `features[].modules`
- `MISSING_IMPLEMENTATION`: every `features[].modules` path exists on disk
- `UNTESTED_AC`: `test_refs` resolve to real test files
- `STATUS_DRIFT`: `status: done` features have modules
- `ARCHITECTURE_FROM_SPEC`: imports don't cross `forbidden_imports` boundaries
- `REFERENCE_INTEGRITY`: scenario `features[]`, feature `depends_on[]`, `superseded_by` resolve (existence)
- `HARNESS_INTEGRITY`: plugin manifest version sync, detector count
- **`CAPABILITIES_FEATURE_MAPPING` (NEW v0.3.45)**: capability `features[]` resolve to real features;
  unbound capabilities remain warnings unless the project carries Cladding's onboarding-seeded marker; marked seeds are informational below eight features and graduate to warnings once the project is grown
- **`INVENTORY_DRIFT` (v0.4.x)**: the `inventory:` counts match the on-disk shard reality
- **`PLANNED_BACKLOG` (v0.4.x)**: too many `planned`/`in_progress` features with no code on disk (the spec racing ahead of the code)
- **`HOLLOW_GOVERNANCE` (v0.4.x, J1)**: a grown project with a present-but-empty `capabilities`/`architecture` design tier
- **`DEPENDENCY_CYCLE` (v0.4.x, J3)**: `features[].depends_on` is acyclic (pairs with `REFERENCE_INTEGRITY`'s existence check)
- **`AI_HINTS_FORBIDDEN_PATTERN` (v0.3.57)**: code avoids `ai_hints.forbidden_patterns`
- **`SCENARIO_COVERAGE` (v0.4.x, S-b)**: a grown project declares ≥1 scenario, no grown-project scenario binds an empty `features[]`, and no scenario under-states its coverage (its `flow` names a feature slug it doesn't bind); only explicitly marked onboarding journeys stay informational below eight features, while unmarked projects keep the established warning
- **`PROJECT_CONTEXT_DRIFT` (v0.4.x, S-c)**: a grown project's `project-context.md` is not still the unrefined init template

Detector-enforced (deferred to future cycles):
- `ARTIFACT_HEADER_STALE`: the header banner accurately describes file state
- `ORPHAN_FIXTURE`: registered fixtures actually cited

Conflict resolution (when same information lives in multiple tiers):
- **Tier A wins over Tier B** — if `spec.yaml` features and `spec/capabilities.yaml` disagree on a name, spec wins
- **Tier B wins over Tier C** — if `docs/project-context.md` describes a layer and `docs/conventions.md` doesn't, project-context wins
- **Same-tier conflicts**: resolved by the producer's authority chain (e.g., scenario produced by onboarding > scenario produced by manual edit when both exist for same slug)

## Refresh semantics

| Trigger | What it refreshes | Divert policy |
|---|---|---|
| `clad init` (bare, greenfield) | spec.yaml seed, .cladding/, .gitignore, project-context template, scenarios README, conventions/architecture/capabilities greenfield seeds | new files only — existing files skip via idempotency |
| `clad init <intent>` (onboarding) | + project-context.md (LLM-refined), capabilities.yaml (LLM-inferred), architecture.yaml (LLM-inferred), spec.yaml F-001 title, **scenarios stubs (NEW v0.3.45)**, onboarding state.yaml | existing files divert to `.cladding/scan/*.proposal` |
| `clad init --scan` (existing-project) | conventions.md (observed), architecture.yaml (observed), capabilities.yaml (README headings), project-context.md (LLM-refined) | existing files divert to proposal |
| `clad clarify <answer>` | project-context.md, capabilities.yaml, architecture.yaml, scenarios stubs (refined Q-A history) | untouched generated design updates in place; user-edited design diverts to proposal and remains `needs_review` until explicitly accepted |
| `clad_create_feature` MCP tool | spec/features/<slug>-<hash>.yaml + durable design-impact decision; additive capability/scenario links | structural impact remains review-required and blocks `clad done` |
| append-only (Tier D) | events.log, audit.log entries | no divert — strict append |

## Quick decision flowchart for adding a new artifact

```
1. Will any code (detector / verb / loader) read this file as input?
   YES → Tier A or B
     Schema-validated and Iron-Law-gated? → A
     User-editable, cross-validated with A? → B
       (Tier B entry condition: must have at least ONE specific consumer)
   NO → continue to 2

2. Is this derived from code or environment observation?
   YES → Tier C
   NO → continue to 3

3. Is this an append-only log or transient state?
   YES → Tier D
   NO → reconsider whether this artifact should exist at all (potential orphan)
```

## References

- `spec/README.md` — Tier A directory index
- `docs/README.md` — Tier B/C directory index
- `src/agents/README.md` — persona role table
- `commands/clad.md` — full CLI verb manifest

This document is read once per session by every cladding-aware persona/skill; downstream prompts reference it by name rather than repeating policy.
