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
│  └─ migration-baseline-0.1-to-0.2.yaml
├─ index.yaml
├─ _doc-links.yaml
└─ attestation.yaml
```

- Do not add tier-named directories. Tier is mutable governance metadata; feature, scenario, and architecture are stable semantic domains.
- `generated/` names an operational property: every byte is machine-written. It is not a synonym for governance Tier C.
- `evidence/` stores externally issued, content-addressed proof receipts. They are machine-issued but cannot be regenerated from workspace state, so they do not belong under `generated/`.
- Name the migration receipt `migration-baseline-0.1-to-0.2.yaml`, not `schema-upgrade-0.2.yaml`; the file stores a project-specific baseline, not the upgrade algorithm.
- Generate `generated/README.md` from the artifact registry. It must never become another hand-maintained policy source.
- Keep `index.yaml`, `_doc-links.yaml`, and `attestation.yaml` at their current paths in 0.10.0. Introduce registry aliases before moving them in 0.11.

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
| `index.yaml` | Committed lookup projection for sharded specs. | Generated when sharded. |
| `_doc-links.yaml` | Committed document-link projection. | Generated when document declarations exist. |
| `attestation.yaml` | Last-GREEN verification signature. | Generated only by a qualifying GREEN gate. |

`docs/project-context.md` remains outside `spec/`. It expands audience, problem context, scope, constraints, and trade-offs, but does not independently redefine the normative project purpose.

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

The registry owns `spec/evidence/<F-id>/<sha256>.yaml` as create-only canonical evidence. It validates that the directory equals the receipt subject's feature and that the filename equals the full digest of the canonical signed receipt. This authority is distinct from regenerable artifacts.

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
project.upgrade_schema         # MCP operation
```

Do not overload `clad update`; that command reconciles installed Cladding wiring and intentionally does not rewrite authored spec meaning.

### Preview

1. Compile 0.1 through its existing compatibility path.
2. Run a separate total legacy scanner that returns `parsed | opaque | conflict` for every string and never throws.
3. Build the entire 0.2 candidate in memory.
4. Copy legacy `text` exactly into `statement`; do not derive it from structured fields.
5. Propose exact `intent_summary → purpose` and `summary → outcome` values.
6. Validate filename/body identity, remove redundant body slugs, and remove child `schema`/legacy `source` markers from capability and architecture candidates.
7. Move legacy test refs into node-level baseline entries without inventing selectors.
8. Invert capability edges and prove exact edge-set equality.
9. Classify legacy human/blind evidence as asserted unless it carries a receipt from a supported verification channel. For a project with `independence_policy: require`, report every done feature that would lose independent status under the 0.2 rule.

Human-resolution items are:

- legacy EARS pattern/leading-keyword structural conflicts;
- capability outcome confirmation;
- architecture rule rationales and any lossy legacy layer conversion;
- scenario actor/goal/success/steps meaning;
- any actual `adr_refs` in an adopter corpus.
- a `require` project's choice to obtain verified replacement evidence or remain on 0.1 when legacy asserted evidence is its only independence basis.

Text disagreement with legacy `condition/action/response` is not itself a conflict: those fields cover only part of the corpus and encode materially different prose. The universally present authored `text` is the migration source.

### Baseline and enforcement

Make the baseline node-granular:

- project-intent projection;
- feature title/purpose projection;
- each criterion's intent projection and legacy binding list;
- scenario and architecture migration records.

Do not write `kind: behavior` onto a legacy criterion by assumption. An unchanged migrated AC remains internally `legacy_unclassified`. On its first intent-bearing edit, require an explicit kind and strict statement. A new node has no baseline and is strict immediately.

Intent-bearing changes are feature title/purpose changes and criterion add/remove or statement/kind/rationale/constraint-ref changes. Status, modules, dependencies, capability links, proof bindings, notes, ordering, and dependency promotion do not revoke unrelated intent exemptions.

Before committing the first intent-bearing edit of an exempt feature, require the author to persist `capability_refs`, including an explicitly confirmed empty list. Changing only capability links remains non-intent-bearing and does not revoke criterion exemptions.

The baseline is immutable through public tools and has no refresh command. Live bindings can supersede a criterion's baseline binding, but the historical receipt stays byte-stable.

Do not transform a legacy `identity.author: human` or `blind: true` flag into a verified 0.2 evidence receipt. A supported human-confirmation or capability-isolation channel must issue the new receipt against the current contract. This is a proof refresh, not a schema spelling migration.

### Apply and rollout

- Abort with no writes while any resolution item remains.
- Prove feature/criterion identity and count preservation, exact statement transfer, and `L = N` capability edges.
- Treat `spec.yaml#schema` as the sole workspace schema selector. Child spec documents and shards carry no workspace schema field; receipt-local `receipt_schema` versions the receipt protocol independently.
- Write the baseline, converted artifacts, derived projections, and root schema switch in one journaled transaction.
- A second successful run produces zero diff.
- A failed normal run writes nothing; crash recovery returns byte-identical originals or finishes an already committed transaction.
- Continue reading schema 0.1 indefinitely. Reject old spellings inside a 0.2 document and reject unknown versions.
- Treat upgrade as a coordinated team event: install 0.10+, close or rebase open spec branches, preview, resolve, then apply once on the integration branch.

### Cladding self-migration sequence

F3 implements and proves the candidate capability/architecture edge set entirely in memory; it does not cut over repository bytes. F4 supplies the journaled apply boundary. At the end of F7, Cladding then:

1. implements and tests the complete 0.2 reader/writer surface while its own repository remains 0.1;
2. runs preview and resolves every human item on that 0.1 tree;
3. performs the one atomic F4-backed apply;
4. completes F7 with `clad done` against the resulting 0.2 workspace; and
5. writes the first pure-0.2 attestation v3.

The F7 preview explicitly selects `L2`; the existing self-declared L4 history is
not converted into verified 0.2 evidence. F8 therefore dogfoods a real 0.2
GraphIR rather than a hybrid transition state. After F9 ships and exercises the
registered human and blind issuer paths, Cladding uses `project.set_policy` to
raise its own workspace to L4 and earns the 0.10 release attestation under that
policy.
