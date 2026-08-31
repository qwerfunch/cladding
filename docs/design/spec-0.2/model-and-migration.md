<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — model and migration

> Canonical owner of D01–D10 and D14. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D01 — Objective and guarantee boundary

LLMs should be able to maintain the spec continuously without carrying a large authoring burden or creating internal contradictions.

The governing rule is:

> Each governed fact and authoritative forward relationship has one canonical owner. The compiler derives inverse edges, projections, observations, and indexes on every run, validates them against their owner, and seals the contract and proof inputs that earned the last GREEN gate.

Eliminating duplicate authority prevents structural contradiction; it does not prove that a requirement is semantically correct or complete. Cladding separately handles:

- missing intent or evidence through detectors;
- stale code, tests, or evidence through verification and attestation;
- concurrent edits through optimistic revisions and a journaled commit boundary;
- behavioral truth through executable tests, oracles, and evidence rather than schema shape alone.

The default authored semantic prose for a new feature is two sentences:

1. `feature.purpose` — why the feature exists;
2. `criterion.statement` — what observable promise must hold.

A `constraint` criterion adds one `rationale` sentence unless it references an architecture rule that already carries the rationale. IDs, titles, lifecycle state, paths, and forward links remain structural data, normally supplied or validated by tools.

## D02 — WHY / WHAT / HOW model and terminology

Intent is a directed graph, not a `project → scenario → feature` tree. A scenario crosses several features and may cover several capabilities.

```text
project.purpose
  └─ capability.outcome
       └─ feature.purpose
            └─ criterion.statement

scenario ── cross-feature user journey
architecture / constraint ── permitted implementation boundary
```

| Term | Canonical question | Normative meaning |
|---|---|---|
| `project.description` | WHAT | What the project is, in one line. |
| `project.purpose` | WHY | Why the project exists and which problem it exists to solve. |
| `capability.outcome` | WHAT | The user-visible result supplied by a capability. |
| `feature.title` | WHAT label | Human label; not the requirement body. |
| `feature.purpose` | WHY | Why this feature is needed within the project outcome. |
| `criterion.statement` | WHAT | One observable, testable EARS promise. |
| `criterion.kind` | classification | `behavior`, `quality`, or solution-limiting `constraint`. |
| `criterion.rationale` | WHY | Why a constraint is necessary. |
| `scenario.actor` | WHO | The party performing the journey. |
| `scenario.goal` | user WHY/WHAT | What the actor is trying to achieve. `purpose` is not used here because it ambiguously suggests the reason the scenario document exists. |
| `scenario.success` | observable outcome | The end state that makes the journey successful. |
| `scenario.steps` | journey sequence | User/system interaction order, never an implementation recipe. |
| `architecture.rules` | constrained HOW | Boundaries implementation must not cross. |
| `modules` | WHERE | Affected paths. The field is retained; it is not an implementation narrative. |
| `depends_on` | prerequisite | Authoritative forward dependency. Soft Shell describes it as “prerequisites.” |
| `notes` | non-normative context | Explanation that cannot add a hidden requirement, exception, or proof obligation. |

There is deliberately no generic `feature.how`. Ordinary implementation detail belongs in code. A HOW is admitted into the spec only when it is a durable constraint, a cross-cutting architecture rule, or a reviewed `design_impact` that points to the relevant design artifact.

## D03 — Artifact layout and necessity

### Target layout

```text
spec.yaml
spec/
├─ features/<slug>-<hash8>.yaml
├─ scenarios/<slug>-<hash8>.yaml
├─ architecture.yaml
├─ capabilities.yaml
├─ evidence/<F-id>/<sha256>.yaml
├─ generated/
│  ├─ README.md
│  ├─ migration-baseline-0.1-to-0.2.yaml
│  ├─ index.yaml
│  ├─ _doc-links.yaml
│  └─ attestation.yaml
```

- No tier directories: tier is mutable; feature, scenario, and architecture are semantic domains.
- `generated/` denotes machine-written bytes, not governance Tier C.
- `evidence/` holds externally issued content-addressed receipts: machine-issued but not regenerable, so not generated.
- Name the receipt `migration-baseline-0.1-to-0.2.yaml`, not `schema-upgrade-0.2.yaml`: project baseline, not algorithm.
- Generate `generated/README.md` from the artifact registry; it is never a hand-maintained policy source.
- Final 0.2 paths: `spec/generated/index.yaml`, `spec/generated/_doc-links.yaml`, and `spec/generated/attestation.yaml`. Schema migration and physical relocation are separate.
- Every managed plugin-build write, including a named manifest region, has one
  `ArtifactDescriptor`; generated persona/skill mirrors are derived from their
  canonical briefs by a pure byte-map policy. The read-only mirror census is an
  observation consumer, never a second artifact authority.

### Why each artifact remains

| Artifact | Canonical role | Presence |
|---|---|---|
| `spec.yaml` | Schema anchor, project identity, policies, and generated inventory region. | Required. |
| `features/` | One independently mergeable behavior contract per feature. | Scaffolded; shards appear with features. |
| `capabilities.yaml` | Stable catalog of user outcomes. Feature links live in feature shards. | Scaffolded; may be empty during early onboarding. |
| `architecture.yaml` | Enforced layers and solution constraints. | Scaffolded; may be empty until architecture is known. |
| `scenarios/` | Cross-feature user journeys. | Governed by `scenario_policy`. |
| `evidence/` | Immutable, signed proof receipts keyed by feature and receipt digest. | Created only by a registered evidence channel. |
| `generated/migration-baseline-0.1-to-0.2.yaml` | Immutable-by-tool legacy exemption and binding receipt. | Only for upgraded 0.1 projects. |
| `generated/index.yaml` | Committed lookup projection for sharded specs. | Generated when sharded. |
| `generated/_doc-links.yaml` | Committed document-link projection. | Generated when document declarations exist. |
| `generated/attestation.yaml` | Last-GREEN verification signature. | Generated only by a qualifying GREEN gate. |

`docs/project-context.md` remains outside `spec/`: it explains, never redefines, the normative project purpose.

## D04 — Identity and sharding

- New IDs use `F-<8hex>`, `AC-<8hex>`, `S-<8hex>`, and `AR-<8hex>`.
- An AC's complete external address is `F-id/AC-id`. An AC ID alone is feature-scoped and cannot bind a test.
- New feature and scenario files use `<slug>-<hash8>.yaml`.
- The filename is the canonical slug owner. Schema 0.2 removes `slug` from feature/scenario bodies, and the compiler injects it into IR from the source path.
- The body `id` is the logical graph address. Its hash must equal the filename suffix; this is an address checksum, not a second slug owner.
- A title may change without moving the path. The path slug is a stable locator, not a derived copy of the latest title.
- The 0.1 reader continues to accept legacy sequential and six-or-more-hex IDs. New writers emit eight hex characters only.
- Put ID policy, examples, schema descriptions, and MCP tool wording behind one executable ID-policy registry so the current `hash6`/`hash8` documentation split cannot recur.

## D05 — Project contract

### New or human-edited 0.2 target

```yaml
schema: "0.2"
project:
  name: cladding
  language: typescript
  description: Reference implementation of the Ironclad harness.
  purpose: Make AI-coupled development measurably safer and more honest.
  assurance_level: L2
  scenario_policy: advisory
```

- Require `project.purpose` for new 0.2 projects.
- `intent_summary` is a 0.1 source field, not a 0.2 alias. The 0.2 validator rejects it.
- During migration, exact-copy `intent_summary` into a proposed `purpose` when it exists. A project without one receives a node-level legacy exemption until its project intent is edited.
- Exact-copy means the complete current value, including any detector-count or policy suffix. A human may revise the proposed purpose before apply; the example above is such a reviewed target, not a byte-for-byte rendering of this repository's 0.1 value.
- Writers persist `scenario_policy`; they do not rely on an invisible default.
- Writers persist `assurance_level`. New 0.2 projects start at `L2`; the level selects the cumulative proof obligations a completion must satisfy, as defined by [D21–D23](assurance.md#d21--iron-law-assurance-kernel).
- Migration does not infer an assurance claim from the old stage layout. Preview proposes `L2`, the operator confirms or changes it, and unresolved policy writes nothing.
- Retain existing project runtime, oracle, independence, deliverable, smoke, and AI-hint policies unless a dedicated feature changes them.

`docs/project-context.md` must point to `spec.yaml#project.purpose` as the normative one-line purpose. Its prose may explain the evidence and trade-offs behind that purpose but may not create a competing summary field.

## D06 — Feature and criterion contract

### Target

```yaml
id: F-ab12cd34
title: Login flow
status: planned
purpose: Allow a customer to begin an authenticated session safely.
modules:
  - src/auth/session.ts
depends_on: []
capability_refs:
  - authentication
acceptance_criteria:
  - id: AC-12ab34cd
    kind: behavior
    statement: When valid credentials are submitted, the system shall create a session.
```

- Require `purpose` on a new feature.
- Require an explicitly persisted `capability_refs` on a new feature and on the first intent-bearing edit of an exempt legacy feature. An empty list is a deliberate statement that the feature contributes directly to project purpose; it is valid but advisory-visible, never an omitted/unknown alias.
- Require `statement` and a persisted `kind` on a new criterion. Authoring tools may suggest `behavior`, but the schema does not hide the value behind a default.
- Begin with `behavior | quality | constraint`. Add kinds only after a real consumer exists.
- A `constraint` requires either a local `rationale` or one or more `constraint_refs` resolving to architecture rules with rationales.
- Retain `modules`, `depends_on`, `design_impact`, lifecycle state, archive metadata, oracle refs, evidence refs, and free-form `notes`.
- Persist `blocked_reason` exactly when `status: blocked`: it is required and non-empty for blocked features, forbidden otherwise, cleared by `feature.begin` and archive, and excluded from intent triggers and contract hashing.
- Treat `design_impact` as governance state, not default semantic prose. An unresolved structural impact still blocks completion.
- Exclude `notes` from intent-change triggers and canonical contract serialization. A requirement hidden only in notes is invalid authoring.
- Reject `ears`, `condition`, `action`, `response`, `text`, `test_refs`, and `adr_refs` in schema 0.2.

### Strict statement grammar

Use the [Ironclad EARS grammar](https://github.com/qwerfunch/ironclad/blob/main/ears.md) without inventing a second dialect.

- Support five basic patterns plus compound.
- Compound clauses appear at most once and in fixed `When → While → Where → If` order.
- Require the grammar's comma boundaries; an `If` clause requires `then`.
- Require exactly one unprotected `shall` or `shall not` modal.
- Reject multiple modals as a non-atomic AC and instruct the author to split it.
- Treat the response predicate as opaque; do not manufacture structured subfields.
- Ignore modal-looking text inside protected backticks, quotes, and balanced parentheses while scanning.
- Reject unbalanced protected spans and statement fragments in new authoring.
- Apply strict parsing to new or intent-edited 0.2 nodes. Preserve the existing 0.1 gate result for legacy input.

The single-modal rule is a syntactic floor, not a proof that an AC is semantically atomic. `ATOMICITY_RISK` may report an advisory when a one-modal statement still contains signals such as a top-level obligation list, coordinated independent predicates, excessive length, or several independently selectable outcomes. It must identify the signals it observed, never auto-split prose, and never block authoring or a strict gate by itself. Corpus fixtures include both a genuine multi-obligation statement and a long-but-acceptable false-positive control so this heuristic cannot silently become a second grammar.

## D07 — Capability contract and edge ownership

### Target

```yaml
capabilities:
  - id: spec-governance
    title: Spec governance
    outcome: Teams detect code and specification divergence before release.
```

- Keep only `id`, `title`, and required `outcome` on each 0.2 capability.
- Remove top-level `source` and capability `summary`, `surface`, and `features[]` from 0.2.
- Own the forward edge in `feature.capability_refs`; derive capability-to-feature projections live.
- A new or intent-edited 0.2 feature must confirm this edge set explicitly, including the empty set. The existing `CAPABILITIES_FEATURE_MAPPING` surface may advise on an explicit empty set when a capability catalog exists, but emptiness remains valid direct-to-project contribution.
- A 0.1 runtime consumes legacy capability `features[]` only. A 0.2 runtime consumes feature `capability_refs` only. Never use `L ∪ N` at runtime.
- The upgrade planner may compare legacy edge set `L` with candidate edge set `N` in memory and must prove `L = N` before cutover.
- Migration may suggest likely capability links for human review, but it never persists a non-legacy edge by inference. A feature with no legacy edge migrates to an explicit empty `capability_refs` unless a human resolves a different edge before apply.
- Present each exact `summary → outcome` copy as a human-confirmation item because `outcome` makes a stronger semantic promise than `summary`.

## D08 — Architecture contract

### Target

```yaml
layers:
  - [spec, core, report]
  - [stages, adapters]
  - [cli]
rules:
  - id: AR-ab12cd34
    kind: forbidden_import
    from: spec
    to: stages
    rationale: The specification compiler must not depend on stage runners.
```

- Accept one 0.2 layer spelling: ordered `string[][]`, from foundation to outer entry layers.
- Replace top-level `forbidden_imports` with `rules`; start with `kind: forbidden_import` only.
- Require stable rule `id`, `from`, `to`, and `rationale`.
- Define `from` as the importing layer and `to` as the imported dependency in schema text and Soft Shell output.
- Use `AR-*` as the address space for criterion `constraint_refs`.
- Treat a legacy object-form layer as a human-resolution item unless the upgrade can prove that converting it loses no path or layer meaning.

## D09 — Scenario contract

### Target

```yaml
id: S-ab12cd34
title: First login
actor: New customer
goal: Begin an authenticated session.
success: The authenticated home screen is visible.
steps:
  - Open the login screen.
  - Submit valid credentials.
feature_refs:
  - F-ab12cd34
```

- Keep the `scenario` concept and `spec/scenarios/` path; do not rename it to journey.
- Use `goal`, not `purpose`, for actor intent.
- Require non-empty `actor`, `goal`, `success`, ordered `steps`, and at least one resolving `feature_ref` for a new scenario.
- `scenario_policy: off` disables coverage demand but retains schema/reference checks.
- `advisory` is the persisted default and emits non-blocking information for absent or hollow scenarios.
- `required` makes scenario presence and structural completeness blocking. In 0.10 it does not claim executable journey verification.
- Only a `required` scenario participates in the referenced feature's contract hash. Executable scenario proof is a later feature.

## D10 — Artifact registry and compiler boundary

Create one code-owned `ArtifactDescriptor[]` registry. Each descriptor declares:

- logical artifact or byte-region ID;
- path matcher and supported schema versions;
- domain and authority class (`canonical`, `generated`, `migration`, `evidence`, `transient`);
- mutability and persistence;
- producer, consumers, inputs, and refresh policy;
- current path and compatibility aliases;
- file or region ownership.

The registry owns create-only `spec/evidence/<F-id>/<sha256>.yaml`: directory equals receipt feature, filename equals canonical signed-receipt digest, distinct from regenerable artifacts.

Model `spec.yaml#project` and `spec.yaml#inventory` as separate logical regions. An inventory refresh must not invalidate a project-purpose revision.

All spec consumers use one compiler pipeline:

```text
version dispatch
→ parse with source locations
→ normalize to canonical IR
→ validate identities, references, lifecycle, and ownership
→ derive reverse edges, bindings, and projections
→ expose detector and query inputs
→ optionally cache disposable digests
```

- Sort shard paths before loading.
- Preserve provenance and source ranges on IR nodes and edges.
- Make unknown schema versions a hard error.
- Keep 0.1 validation and blocking results compatible.
- Store no committed `traceability.yaml`; reverse edges and authored-edge projections have a live, non-stale home in IR.
- Store only disposable compiler digests under `.cladding/cache/`.
- Require every Cladding-managed write target and every managed region to resolve to exactly one descriptor.
- Generate the prose artifact table and generated-directory notice from the executable registry rather than maintaining another list by hand.

## D14 — Schema migration

CLI and MCP use one engine:

```text
clad migrate --to 0.2          # read-only preview
clad migrate --to 0.2 --apply  # explicit transaction
clad relocate-generated         # read-only relocation preview
clad relocate-generated --apply # explicit relocation transaction
project.upgrade_schema         # MCP operation
```

`clad migrate` changes schema only; `clad relocate-generated` moves only the three D03 projections. `clad update` reconciles installed wiring, never authored meaning.

### Workspace states

`old` means root `spec/index.yaml`, `spec/_doc-links.yaml`, and `spec/attestation.yaml`; `new` means the three `spec/generated/` destinations.

Before F11, the F4/F7 engine treats old paths as the then-canonical transitional layout: F7–F10 complete normally. F11 aliases/relocates; its final engine applies this state machine:

| Detected state | Permitted operation | Result |
|---|---|---|
| 0.1 + old | normal | Ordinary 0.1 operation. |
| 0.2 + old | `relocation_required` | Read, diagnose, and relocate only. Other mutations and authoritative profiles are unresolved. |
| 0.2 + new | normal | Ordinary 0.2 operation. |
| both paths | conflict | Refuse mutation until the conflict is resolved. |
| active migration/relocation journal | recovery-only | Finish or restore the recorded transaction before every other operation. |

### Preview

Compile 0.1, scan legacy strings as `parsed | opaque | conflict`, and build the candidate in memory. Copy `text → statement` exactly, never reconstruct from structural EARS; propose `intent_summary → purpose` and `summary → outcome`, validate identity, remove redundant child markers, prove inverted capability equality, and classify human/blind evidence as asserted unless receipt-backed. A `require` project reports completed features that lose independence.

Preview retains raw refs without selectors; safe historic candidates record normalized path, state, and whole-file SHA-256. `CRITERION_STATEMENT_CONFLICT`/`CRITERION_TEXT_UNKNOWN` selects exact refs to `retain`/`drop` with final strict intent; `condition`/`action`/`response` differences alone are not conflicts. Other items cover capability outcomes, architecture rationale/lossy layers, scenario intent, `adr_refs`, and replacement evidence or 0.1 for asserted-only `require`.

Preview requires `PROJECT_LEGACY_L2_BASELINE: accept | reject`, separate from `PROJECT_ASSURANCE_LEVEL_CONFIRMATION`, with deterministic count+digest of exact-`done` source-feature 0.1 criteria. It infers neither decision nor eligibility from legacy stages, refs, agent claims, or L2 selection.

### Baseline and enforcement

The immutable node baseline covers project/feature intent, criterion intent/historic refs, scenario/architecture, and valid `surface` as deterministic `removed_by_schema_0.2` (never live). Unchanged ACs stay `legacy_unclassified`; their first intent edit needs strict statement/kind. Criterion add/remove or statement/kind/rationale/constraint-ref edit revokes only that criterion; feature/non-intent edits do not revoke unchanged siblings. An exempt feature's first intent edit persists `capability_refs`, including confirmed empty.

On `accept` only, atomic apply resolves every criterion, then writes immutable criterion-local L2 authorizations to `migration-baseline-0.1-to-0.2.yaml`. Each binds composite address, source `done`, exact final 0.2 intent digest (statement, kind, rationale, constraint refs, including explicit absence), exactly Unit `stage_2.1` and Coverage `stage_2.2`, plus deterministic `candidate_sha256` and `resolution_sha256`. `reject` writes none. Strict intent selected during reviewed migration becomes that immutable final target; only a criterion newly authored after migration or whose recorded final target later changes is ineligible/revoked. A source feature not exactly `done` (including F7 before completion) is ineligible. D11/D23 define runtime use.

Reviewed strict carry-forward is immutable history, not relaxed exemption: it binds final intent and selected raw refs with whole-file hashes. Selection is `live > reviewed carry-forward > unchanged exempt legacy > none`, never a union; changed selected bytes are stale/RED. Historic refs and `identity.author: human`/`blind: true` are not verified receipts.

### Apply and rollout

- Abort for unresolved items; recheck preview before journaling, so a selected-byte change is `STALE_INPUT`. Prove feature/criterion identity/count, statement transfer, and `L = N`.
- `spec.yaml#schema` is the sole selector; child/shard markers are forbidden and receipt-local `receipt_schema` only versions its protocol.
- Before F11, one journal writes baseline, conversion, old-path projections, and root switch; final F11 names `clad relocate-generated --apply`. Relocation moves three projections only and changes neither schema nor F7–F10 acceptance.
- Apply plans exact paths, rejects dirt there, records `HEAD`/sorted paths, and is zero-diff on second success. Failure writes nothing; recovery finishes/restores byte-identical originals or supports exact-path `git restore --source=<HEAD> -- <paths...>`.
- Continue reading 0.1; reject old 0.2 spellings/unknown versions. Upgrade: install 0.10+, close/rebase branches, preview, resolve, apply once on integration.

### Cladding self-migration sequence

F3 proves candidate capability/architecture edges in memory without byte cutover; F4 supplies the journaled apply boundary. At F7 end, Cladding:

1. implements/tests the 0.2 reader/writer while self remains 0.1;
2. previews and resolves every human item on that tree;
3. performs the one atomic F4-backed apply;
4. completes F7 with `clad done` on the resulting 0.2 workspace; and
5. writes its first pure-0.2 v3.

The F7 preview separately resolves `PROJECT_ASSURANCE_LEVEL_CONFIRMATION` and
`PROJECT_LEGACY_L2_BASELINE`; F7 is ineligible for the latter while incomplete.
For self, the self release attestation remains L2; legacy L3/L4 is no waiver.
F9–F11 signed fixtures are mechanism/protocol evidence. Only real human-signed Codex and Claude Code MCP11 cycles prove L4. A stronger bounded-closure self completion is optional. F11 relocates self before final enforcement without invalidating F7–F10.
