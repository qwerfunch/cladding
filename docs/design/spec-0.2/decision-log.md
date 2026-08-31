<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — decision log

> Canonical owner of claim boundaries, rejected alternatives, the evolution queue, and change history. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## Claim discipline

The graph claim ladder in D17 is cumulative but not substitutable: structural validity does not prove retrieval benefit, retrieval benefit when called does not prove adoption, and adoption does not prove implementation correctness.

### Claims allowed now

- Spec 0.2 reduces semantic prose to purpose, statement, and constraint rationale while retaining typed structural links.
- It removes internal duplicate AC representations for new/edited nodes.
- It eliminates shared capability-edge writes for ordinary feature creation.
- It can detect stale contract and proof inputs that attestation v2 cannot see.
- Verified repository scale makes feature-local mutation and proof closure materially relevant.
- The shipped role contract assigns execution form to the host and computes independence labels from recorded evidence rather than persona membership.
- D21–D23 define an obligation target in which existing runners are adapters, self policy persists L2, and a stronger one-run level requires a complete bounded current closure.
- Bounded background checking may provide speculative observations in 0.10, but only a foreground profile-complete reduction may change lifecycle state or write attestation.
- The current MCP server's declared catalog, in-memory negotiation, and bootstrap list-change path are executable wire facts; D24 makes MCP an optional adapter over shared kernels, not a second authority.

### Claims prohibited until new evidence exists

- **“34 features produced nine false blocks”** — the repository records nine prior false rejections and a separate 34-feature experiment, but no raw fixture ties them together.
- **“26% false-block class removed”** — this is the unsupported `9/34` conflation.
- **“Landmine protection 2/2”** — [`case-working-set-landmine.md`](../../ab-evaluation/case-working-set-landmine.md) reports a NULL real-agent outcome. Two structural instruments discriminated deterministically; that is not an effect measurement.
- **“37/37 design simulation”** — the 37 IDs are now a newly preregistered contract matrix, not a recovered session artifact. Claim a result only after all one-to-one committed fixtures run.
- **“Done proof 100%”** — 277/277 measures declared proof addresses and attestation markers, not observed testcase-level verification.
- **“Cost falls from +45% to +20–30%”** — the latter is an acceptance projection until measured under the new authoring loop.
- **“N=300 prevents 25–50 latent defects”** — model projection, not observed defect count.
- **“Feature count below eight has no value”** — existing eight-feature constants are detector grace thresholds, not an economic break-even result.
- **“Every `blind: true` record is structurally blind”** — the packaged role restricts tools, but generic MCP currently accepts a caller assertion without a runtime isolation receipt.
- **“General persona prompts are unnecessary”** — deterministic gates must be prompt-independent, but the briefs have affected agent interpretation. Claim only topology-invariant gate behavior after D19's committed ablation; do not claim equal authoring quality without a live benchmark.
- **“A smaller task payload proves lower total input cost”** — the current full MCP list bundle is 53,960 bytes before server instructions and host framing; the historical 29,866-byte subset used a narrower serializer. Cache reuse is host-dependent. Compare payload, resident, total, retries, and provider-reported cache tokens separately in a live A/B.
- **“Background checking makes completion faster”** — availability is not a latency result. Measure foreground active wait, total CPU, cancellation/stale-result rate, cache-hit promotion, and authoritative completion wall time against the same edit trace.
- **“A latency budget is a performance guarantee”** — D22 budgets are product targets and downgrade rules. Claim an achieved percentile only from a dated, environment-labelled benchmark.
- **“A speculative pass is proof”** — a background result has no lifecycle or attestation authority until a foreground reducer revalidates its exact input, tool, policy, and environment closure.
- **“A fired hook or background result proves adoption”** — pushed delivery proves that Cladding spoke, not that an agent used the result. Preserve the existing pull/completed-cycle adoption protocol and report background reuse separately.
- **“The new cadence improves correctness”** — cadence may reduce time-to-finding without changing the authoritative obligation set. Correctness or defect-prevention claims require a preregistered fault corpus or live controlled comparison.
- **“MCP availability proves efficacy, efficiency, or adoption”** — wire conformance is only the first rung. Require a reference-host Spec 0.2 cycle for efficacy, an equivalent-task A/B for efficiency when used, and voluntary pull telemetry for adoption.
- **“A fixture signature, legacy L3/L4 history, or host smoke is live human L4 evidence”** — fixtures prove protocol/mechanism only. Require real human-signed receipts in both blocking MCP11 cycles.

## Rejected decisions

Do not reopen these without new evidence that invalidates the stated reason.

| Rejected | Reason / reopen condition |
|---|---|
| Tier-named spec directories | Tier is mutable and path changes would break consumers. Reopen only with a path-independent external standard and measured migration benefit. |
| Rename `modules` or `depends_on` | Adds vocabulary migration without removing an active ambiguity. Use Soft Shell descriptions instead. |
| Rename the scenario concept to journey | Scenario is established and unambiguous as a user-journey artifact; only its field grammar changes. |
| Add `interface` criterion kind | No consumer or distinct enforcement exists. |
| Six-axis assurance taxonomy | Existing verdict/disposition surfaces already separate outcomes; add only when a concrete consumer cannot express a needed distinction. |
| Persist `traceability.yaml` | Authored-edge projections and reverse edges are live IR and would otherwise become stale committed copies. |
| Runtime `L ∪ N` capability edges | Creates two simultaneous authorities. Comparison is upgrade-preview-only. |
| Allow multiple `shall` modals | Violates atomic AC and case-level binding granularity. Split the AC. |
| Automatically write inferred dependencies | Current candidate graph can introduce large cyclic components. `dependency.promote` remains explicit and cycle-checked. |
| ~~Move existing generated files in 0.10~~ — superseded 2026-08-29 | Original rationale: registry and aliases must land before movement. F11 now satisfies that condition, then relocates only the three projections separately from schema migration with D14 state/recovery fixtures. |
| Generic filesystem/JSON-Patch MCP editor | Cannot provide domain invariants or honest write-set calculation. |
| Automatically classify legacy ACs as behavior | Converts meaning without evidence. Use `legacy_unclassified` until the node changes. |
| Guess test selectors for path-only refs | Manufactures proof. Use the accepted node-level baseline fallback. |
| Claim duplicate elimination proves correctness | Omission, stale evidence, unobserved behavior, and concurrency remain independent failure classes. |
| Persist a graph or vector index as authority | Live compiler IR already has deterministic identities and exact links; another store adds freshness and opaque-retrieval failure modes. |
| Preserve a v1 graph compatibility serializer | It would keep kind twins and criterion loss alive as a second public model. Cut the graph surface atomically. |
| Change frozen `clad_get_context` to resemble GraphIR | It is a distinct accepted wire contract, and pull adoption is not confirmed. Use per-surface versions. |
| Use generic undirected BFS as the default query | Direction and containment semantics matter, and the corpus simulation shows depth-2 token blow-up. |
| Require a fixed planner→developer→reviewer→observability topology | Host orchestration is already the shipped contract, and deterministic guarantees must not depend on general persona membership. Reopen only if an ablation proves a necessary negative capability. |
| Delete the specialist role briefs | They are optional interface manuals and their wording has changed agent interpretation. Remove a brief only after a committed ablation shows that no supported host or contract loses needed guidance. |
| Add an F7.5 `clad_get_context` v2 | `clad_get_context` v1 stays frozen throughout 0.10; F8 versions the graph surface only. A future context successor needs its own adoption and compatibility decision. |
| Treat raw `blind: true` or a free-form human claim as verified evidence in 0.2 | A Boolean assertion cannot prove isolation or a human channel. Require a receipt from a supported adapter and preserve unverified input as asserted history. |
| Treat TTY/pseudo-TTY presence or hand-written receipt YAML as verified | The process cannot prove user presence or a trusted issuer from workspace-controlled input. Bare `clad signoff` is asserted; verified paths require an offline-verifiable external signature. |
| Perform network identity lookup during a strict gate | Violates synchronous deterministic gating and makes old commits depend on remote state. Verify pinned signed receipts offline; online integrations may issue portable proof at ingestion only. |
| Embed evidence receipt bodies in attestation | Creates a second receipt authority and merge surface. Keep immutable receipts under `spec/evidence/`; attestation seals their current identities and closure only. |
| Put workspace schema markers in child spec documents | Mixed selectors permit partial interpretation. `spec.yaml#schema` is the single workspace switch; `receipt_schema` versions only the independent receipt protocol. |
| Add `feature.unarchive` to the mutation API | Archive is an integration-terminal historical decision. Correct mistakes through VCS before integration instead of adding a second lifecycle transition with unclear proof semantics. |
| Use feature `contract_sha256` for every criterion receipt | Sibling criteria would invalidate unrelated proof. Bind criterion receipts to their subject closure and keep the broad hash for feature attestation. |
| Seed impact from every declared feature module | Shared modules amplify one focused edit into dozens of unrelated owners and dependents. Seed from predicted/observed write scope; keep module fan-out lazy when scope is unknown. |
| Use one revision for both context reuse and writes | Projection retention and byte-level write concurrency are different claims. Keep `context_revision` and `input_revisions` separate. |
| Apply one payload ceiling by content class or by a two-task aggregate | The measured 27,854-byte value combines implement and verify and made the former wording ambiguous. Enforce 16/24 KiB per task profile after operation-scoped packing; do not raise a class limit from an aggregate. |
| Make an atomicity heuristic blocking | One modal does not ensure one obligation, while length/conjunction heuristics also flag valid prose. Keep the hard grammar deterministic and the semantic risk advisory. |
| Defer all cleanup to a final cleanup-only phase | Superseded authorities would coexist through several features and become new dependencies. Retire them in the same proven cutover cycle; keep F1 additive by design. |
| Require monotonically lower LOC or a monotonically higher test count | Both reward the wrong proxy. Require one authority, no unjustified orphans, preserved behavior, and discriminating replacement tests. |
| Delete compatibility or historical paths before a replacement is adopted | Absence of a static import does not remove spec, entrypoint, generated, runtime-lookup, or external obligations. Apply the D18 deletion proof after consumer cutover. |
| Run the full gate after every edit | It multiplies active wait, executes environment/HITL work at the wrong boundary, and encourages hook bypass without strengthening the eventual authoritative obligation set. Keep bounded interactive feedback and one profile-complete completion reduction. |
| Make local hooks or a local background worker the sole authority | Local surfaces are optional, bypassable, and may lack the release environment or verified evidence channels. They reduce latency; completion, protected push, and release profiles retain authority at their declared boundaries. |
| Treat the number of registered stages as the Iron Law theory | The upstream draft defines 13 standard stages, while Cladding ships two extensions. Theory belongs to obligations, cumulative profiles, freshness, and failure reduction; preserve runner IDs only as compatibility/reporting surfaces. |
| Defer the persistent assurance scheduler to 0.10.x | The 0.10.0 design deliberately ships the scheduler with F9, but makes `auto` and `off` verdict-equivalent. Single-flight, stale-result rejection, cancellation, resource locks, and cache-key invariance are release gates; background availability never becomes proof authority. |
| Make MCP a second compiler, graph, or verdict authority | CLI, MCP, and in-process entry points must share domain kernels. Transport-specific facts would create exactly the drift Spec 0.2 removes. |
| Require MCP resources, prompts, subscriptions, or sampling for correctness | Supported tools-only hosts would lose the cycle, and optional delivery would become an authority. These surfaces may optimize use but cannot weaken the tools-only path. |
| Cut over to a task-scoped MCP catalog from byte reduction alone | Smaller metadata does not prove tool discoverability, equivalent task success, or adoption. Require the preregistered host A/B and dynamic-discovery controls. |

## Evolution queue

These are intentionally outside the 0.10.0 core and may evolve independently.

| Item | Entry condition |
|---|---|
| ~~Move `index`, `_doc-links`, and `attestation` into `spec/generated/` (0.11)~~ — superseded 2026-08-29 | Original entry condition: registry aliases, old/new reader fixtures, and measured compatibility green. F11 satisfies it in 0.10.0, then owns relocation/recovery. |
| Additional test-framework adapters | Each adapter has source→selector→JUnit round-trip fixtures and a real adopter. |
| Executable scenario verification | A scenario runner or binding carrier exists; only then may `scenario_policy: required` imply runtime proof. |
| Authoring-provider bridge, including Spec Kit input | The canonical IR is stable and a provider can map without weakening identity, proof, or transaction contracts. |
| Advisory semantic comparison | Deterministic compiler is complete; LLM comparison remains labelled advisory and never defines GREEN. |
| Cost and false-block benchmark | F1–F6 land and the preregistered new benchmark can compare 0.1 and 0.2 maintenance. |
| Broader LLM GraphIR retrieval study (40 tasks is the current scale candidate) | AB01–AB12 has first established task-scoped efficiency-when-used; a separately preregistered expansion may test generalization without altering adoption telemetry. Target: optional 0.10.x. |
| Viewer proof-detail polish and public graph cursor/`not_modified` support | The minimum v2 viewer/export cutover is stable; add only against a measured payload or navigation need. F9's session-bound diagnostic continuation is not this public surface. Target: 0.10.x. |
| ~~F10 task-state headless loop (0.10.x)~~ — superseded 2026-08-29 | F10 ships in 0.10.0 after its stated F9 prerequisites. |
| ~~Generated-file physical migration~~ — superseded 2026-08-29 | Original condition: do not combine it with schema migration. F11 satisfies this as the separate 0.10.0 relocation feature. |

## Change log

| Date | Decision | Change | Evidence |
|---|---|---|---|
| 2026-08-28 | D01–D16 | Initial accepted Spec 0.2 design recorded as the continuation SSoT. Chose node-level legacy binding baseline, strict-new/lenient-legacy grammar, live IR with no traceability file, scenario `goal`, proof-content attestation, and bounded commit locking. | Repository corpus audit and adversarial Claude/Codex review summarized in [Evidence snapshot](evidence.md#evidence-snapshot). |
| 2026-08-28 | D17 | Made GraphIR v2 the shared compiler model for contract/proof closures; separated its structural justification from optional LLM retrieval; preserved frozen `clad_get_context` v1 while requiring an atomic graph-v2 cutover; and fixed independent validity, efficiency-when-used, and adoption claim gates. | v1 fidelity census, v2 read-only query reconstruction, token/ablation simulation, source-reference audit, and adoption protocol review. |
| 2026-08-28 | D15–D17 refinement | Fixed the F1 schema-0.1 bootstrap, additive no-cutover boundary, independent sorted-record oracle, occurrence/unique/resolution census vocabulary, F1/F5 adapter boundary, and one authoritative completion-gate cadence. | Scoped import-graph census, YAML/CST locator prototype, typed evidence-reference census, known unresolved controls, and feature-cycle/CI audit. |
| 2026-08-28 | D18–D20 | Added adjacent-cleanup proof, complete physical context accounting, task-keyed projections, host-owned orchestration refinement, and verified human/blind evidence receipts; kept F8 as graph-v2 cutover and placed the task-state headless loop at F9. | Current role-contract/code-path audit, 281-feature dispatch-size census, generic-MCP blindness boundary review, and 46 focused GREEN tests. |
| 2026-08-28 | D06–D07, D12–D14, D16, D19–D20 refinement | Added an explicit cycle-begin boundary, subject-level evidence hashes, predicted/observed write scope, physical payload/resident/total accounting, explicit capability links, and advisory-only semantic atomicity checks. | One-cycle F-06dfdad6 simulation, current MCP catalog serialization, impact fan-out comparison, stale matrix, and 53 focused GREEN tests. |
| 2026-08-28 | D15–D18 routing and retirement | Split the continuation SSoT into a small task router and bounded semantic owners; added same-cycle code/document/test retirement, contract-aware orphan checks, and replacement-test rules without LOC or test-count quotas. | 92,189-byte monolith census, Madge orphan graph, and 1,608-line supersession-candidate census. |
| 2026-08-28 | D03, D06, D10, D12–D16, D19–D20 execution refinement | Made root schema selection singular; added canonical signed receipts and offline trust verification; completed lifecycle/link operations; separated F3 proof, F4 apply, and F7 self-migration; replaced the ambiguous content-class packet ceiling with operation-scoped task limits; preregistered the 37-case matrix; promoted envelope/A–E work to F9 core and moved the headless loop to F10. | Adversarial document audit, receipt/freshness simulations, task-envelope serialization, module fan-out census, and registered-detector recount. |
| 2026-08-28 | D21–D23 | Reframed Iron Law as profile-selected obligations over current closures; preserved the 13-stage standard plus two named Cladding extensions; selected default L2, explicit unknown escalation, bounded 0.10 background checks, profile-complete attestation, and host-owned topology. | Repository gate/hook/config audit, assurance-cadence simulation, upstream Ironclad draft comparison, current latency/adoption records, and independent strategy critique. |
| 2026-08-28 | D12, D16, D18, D20–D23 refinement | Defined receipt canonical bytes and author-set freshness, made one feature UAT receipt carry the complete per-criterion decision matrix, aligned stale gates to runtime closure, completed block/archive transitions, retained the F9 scheduler in 0.10 core, and split hygiene/cadence evidence owners for routing headroom. | Current document/schema audit, upstream per-criterion Stage 4 comparison, doc-link extraction parity, lifecycle simulation, and owner-byte census. |
| 2026-08-29 | D15–D16, D24 | Added an additive V0 validation ledger and made MCP an optional, bounded adapter with separate conformance, efficacy, efficiency-when-used, and adoption gates; preregistered twelve MCP scenarios and preserved unrun/pending states. | Executable owner/case ledger, in-memory MCP negotiation and bootstrap transition, canonical catalog-byte census, and legacy host-smoke/adoption evidence audit. |
| 2026-08-29 | D16–D17, D19, D24 evidence refinement | Scoped AB01–AB12 to the first task-scoped MCP decision, retained a 40-task GraphIR study only as optional later generalization, refreshed physical-context and catalog evidence, and restored router editing headroom without changing the accepted architecture. | `npm run validate:spec-0.2`, exact UTF-8 census, graph/cadence model controls, and owner/anchor integrity tests. |
| 2026-08-29 | D09, D14–D16, D20–D24 final audit closure | Separated upstream hard/report strictness from Cladding's strict blocking policy, assigned receipt protocol consumption to F5 and real issuer paths to F9, defined required-scenario criterion freshness, fixed L2→L4 self-migration staging, and widened normative-owner validation. | Upstream Iron Law comparison, policy/scenario truth-table simulations, duplicate-heading fault injection, and the full contributor test suite. |
| 2026-08-29 | V0 rebaseline | Set V0 and F1–F11 as 0.10.0 scope; separated schema migration from F11 relocation; kept self policy at L2; required bounded one-run L4 plus Codex and Claude Code MCP11 evidence; and aligned release/governance wording. | Maintainer decision; implementation, fixtures, and live-host evidence remain pending. |
| 2026-08-31 | F7-B2 atomic remediation | Remediated 13 historical compound criteria into 51 atomic children plus two scoped restores: retained each old address on child 1, minted canonical sibling IDs, and kept displaced text non-normative; retired F-12d740 for F-048's compact F6 observer; self remains schema 0.1. No release claim. | B2 implementation and contract fixtures. |
| 2026-08-31 | F7-B3 derived measurement contracts | Replaced 23 historical measurement criteria with current semantic invariants, exact live selectors, and feature-owned source/runtime plus runner/observation closure; Audit/UAT are trusted-receipt mechanism proof only and real ingress remains B5. Fixed totals, percentages, and byte baselines are dated non-normative history; self remains schema 0.1 with no release claim. | Focused behavioral/proof suites, live-binding census, and context compaction. |
| 2026-08-31 | F7-B4 criterion observations | Normalized the four replacement statements to strict grammar without changing their addresses or meaning. Added a code-owned exact-address criterion observation registry: static Unit/Coverage NA needs a current registered adapter, complete seal, and true predicate; behavior remains required, failures RED, and GraphIR structural. The mirror has one pure byte-map policy for writing and read-only census. Self remains schema 0.1 with no release claim. | Criterion-registry, parser, locale, compaction, and mirror fault fixtures. |
