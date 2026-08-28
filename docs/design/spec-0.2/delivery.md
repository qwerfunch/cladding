<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — delivery and acceptance

> Canonical owner of D15 and D16. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D15 — Implementation sequence

**V0 precedes F1:** land the additive design-validation ledger, deterministic simulator, token accounting, and MCP wire/efficacy boundary described by [D24](mcp.md#d24--mcp-as-optional-transport-and-bounded-projection). V0 may pass its own infrastructure while target decisions remain `implementation_pending`; it may not call preregistered cases implemented or a host E2E run completed. Challengers produced by validation remain proposals until a maintainer changes the canonical owner and decision log.

Follow one feature cycle at a time; author each shard immediately before implementation.

F1 is necessarily bootstrapped under schema 0.1 because the 0.2 reader does not exist until F2. Author the F1 shard with the current EARS/`text` contract, put its WHY under the established `notes: "## Why\n..."` convention, and point it at D10 and D17. Do not pre-author 0.2-only `purpose`, `statement`, or `kind` fields. The F1 node then becomes a normal input to the later self-migration rather than a privileged exception.

F1 begins with an independent, sorted corpus-record snapshot. Its oracle scans source YAML without importing the production loader, reverse index, GraphIR builder, or query closures. The additive compiler proves parity while existing consumers remain unchanged, keeping a failed F1 local and discardable.

1. **F1:** commit this design, executable artifact/ID registries, the GraphIR v2 address/role/provenance skeleton, and the node-baseline schema. Preserve the stale `hash6` wording as a parity negative control until the ID registry owns the policy, then repair that comment before F1 completion.
2. **F2:** version dispatch, strict 0.2 parser, non-blocking atomicity advisory, total legacy scanner, and migration preview.
3. **F3:** project, explicit feature-capability links, capability catalog, and architecture 0.2 contracts; prove the candidate `L = N` edge set in memory without changing repository schema or bytes.
4. **F4:** `clad_edit_spec`, `feature.begin`/`clad begin`, context/input revision separation, commit lock, journal recovery, journaled migration apply, and existing-tool adapters.
5. **F5:** doc/source/test/oracle/evidence adapters, covers and case-level observations, legacy binding fallback, receipt framing/offline verification/ingestion/storage/revocation, asserted signoff fallback, and verification detector rewiring. Test issuers prove the protocol; no verified product issuer ships here.
6. **F6:** shared contract/subject/runtime-dependency/verification closures, the [D21–D23](assurance.md#d21--iron-law-assurance-kernel) obligation DAG and profile reducer, legacy 15-stage compatibility projection, profile-aware `clad done`, and attestation v3.
7. **F7:** scenario v2 and `off | advisory | required` policy, including its GraphIR edges; then preview, resolve, and atomically self-migrate Cladding from 0.1 to 0.2, complete F7 on 0.2, and write the first pure-0.2 v3 attestation.
8. **F8:** atomically cut `clad_get_graph`, CLI graph queries/JSON, and the existing exporters/viewer to GraphIR v2; do not retain a v1 graph adapter.
9. **F9:** ship `CycleContextEnvelope`, operation-scoped task projections, the content-addressed single-flight background scheduler, registered human and blind receipt issuer paths, and the A–E topology/context/cadence invariance suite as 0.10.0 core; keep the existing experimental headless loop compatible.
10. **F10 (0.10.x tail):** after F9 is green, replace that loop's hard-coded developer→reviewer choreography with task-state dispatch. Rich public graph cursors, viewer detail UX, and any broader GraphIR retrieval study remain independent tail work.
11. **0.11:** move existing generated index, doc-link, and attestation files only after registry aliases are proven.

There is no F7.5 context-wire migration. F8 remains the graph-v2 public cutover. Standards, canonical documentation, glossary entries, and generated plugin mirrors update inside the feature that changes their contract; they are completion work, not a separate numbered feature.

### Cutover and retirement map

F1 is the deliberate exception to same-cycle retirement: it establishes an additive parity boundary and deletes no shipped compiler, loader, graph, detector, or optimizer path. From F2 onward, every cycle inventories the authority it supersedes before implementation and retires that authority after all consumers cross the proven boundary.

| Boundary | Required retirement after cutover |
|---|---|
| F4 transactional writer | Move direct shard/status mutation in `src/spec/new.ts` and `src/cli/done.ts` behind the transaction engine. Remove forwarding-only or second-writer logic once existing commands are thin domain adapters; retain 0.1 reading, not a second write authority. |
| F5/F6 proof compiler | Remove duplicate reference normalization, binding joins, and proof-closure calculations after detectors, report paths, and attestation consume the shared implementations. Keep legacy references as input compatibility, not as a parallel proof model. |
| F8 GraphIR cutover | Retire graph v1 identities, reverse-index materialization, undirected/repeated traversal, and tests that assert those obsolete internals. CLI, MCP, report, impact, working-set, export, and viewer paths become queries or serializers over GraphIR; no v1 adapter survives. |
| F9 context-envelope implementation | Revise the F-041/F-063 contracts that currently protect `src/optimizer/preamble.ts` and `src/optimizer/tail.ts`, then retire those production orphans after equivalent omission, tail, budget, and fixed-point behavior is covered by the envelope packer. |
| F10 task-state loop | Retire hard-coded developer/reviewer identity choreography and loop-only mock/stub dispatch after topology invariance and real evidence ingress are green. Product transport fallbacks remain until their separately owned compatibility contracts are intentionally revised. |

A path may survive only when it still owns a distinct public contract or compatibility obligation; that owner and exit condition are recorded in the feature rationale or test. There is no permanent retirement manifest and no separate cleanup-only release phase.

Each cycle follows simulation → implementation → verification → `clad done`. Edit feedback compiles without subprocess work; checkpoint checks changed inputs; `clad done` authoritatively checks the proven impact closure and escalates unknown scope to the whole repository. Push and release remain integration boundaries. Exact-digest results may be reused; background work never writes lifecycle or attestation state. Rebuild plugin mirrors before completion and still run contributor push checks.

## D16 — Acceptance gates

Corpus gates compare sorted semantic records, not hand-maintained totals. The independent scanner snapshot stores owner, composite criterion address, channel, raw reference, normalized target, selector, resolution state, source path, YAML path, and source range. Occurrence count, unique-address count, and resolved/unresolved count are separate derived views. An intentional corpus edit updates the reviewed record diff; it must not require editing a second literal total in the assertion. Dated totals remain below in [Evidence snapshot](evidence.md#evidence-snapshot) as design evidence rather than permanent acceptance constants.

### Compatibility and grammar

- Every feature and criterion record in the canonical self-corpus snapshot compiles as 0.1 with an identical owner, address, source locator, and unchanged blocking result.
- New strict parser fixtures cover five patterns, compound ordering, comma rules, a single modal, negation, protected spans, fragments, and unbalanced spans.
- `ATOMICITY_RISK` reports its observed advisory signals on a one-modal multi-obligation control, while a long atomic control proves that any heuristic false positive remains non-blocking under strict mode.
- Property tests show the legacy scanner returns `parsed | opaque | conflict` and throws zero times for arbitrary strings.
- Unknown schema versions hard-fail before artifact merging.
- `spec.yaml#schema` alone selects workspace schema. Child `schema` fields and mixed 0.1/0.2 spellings are rejected in 0.2; independent `receipt_schema` dispatch cannot switch workspace interpretation.

### Migration

- One changed node loses only its own exemption; unrelated criteria in the same feature remain grandfathered.
- Every legacy test-reference record in the canonical snapshot survives in the baseline without changing its raw address or fabricating a selector.
- Live binding and baseline fallback never union for one criterion.
- Capability edge cutover proves `L = N` before schema switch.
- F3 performs that proof without disk cutover; only F4's journaled apply may remove legacy child `schema`/`source`, write new edges, and switch the root schema.
- A feature with no legacy capability edge receives an explicit empty `capability_refs`; suggested candidates never enter the applied candidate without human confirmation.
- Unresolved preview and normal failure write zero bytes.
- Crash recovery is byte-exact, and a second successful apply is zero-diff.
- The F7 self-migration proves preview-on-0.1, human resolution, one atomic apply, post-switch `clad done`, and pure-0.2 v3 output; F8 begins from that real 0.2 tree.

### Binding and proof

- Adapter fixtures prove source carrier → normalized selector → JUnit testcase → composite criterion round trips.
- Bare IDs produce no bindings; unknown addresses block.
- Unrelated same-file passes, skipped-only cases, mixed pass/fail, and multiple valid bindings follow D11 exactly.
- A fresh preregistered benchmark contains nine valid bindings plus unbound, unknown, unrelated, skipped, and failing injections. Do not call it a reproduction of the old 34-feature run without its raw fixture.
- A verified criterion Audit receipt satisfies only its matching Audit obligation. One verified feature UAT receipt may satisfy all matching UAT obligations only when its signed matrix contains every current composite criterion and every row plus both feature checks passes; a verified blind receipt may satisfy independence but never UAT.
- A generic MCP `blind: true`, a free-form human claim, same-author review, and receipt-free legacy evidence do not gain verified 0.2 status.
- With project scenario policy `required`, every scenario referencing the parent feature contributes its ID and intent fields to every criterion subject in that feature. Changing that set or intent stales those receipts; `off | advisory`, unrelated scenarios, and sibling criteria do not. No receipt transfers to another address or hash.
- Receipt fixtures verify RFC 8785 serialization, the `cladding.receipt/1` length-prefixed domain frame, detached Ed25519 signatures offline with a pinned out-of-workspace key, full-digest filenames, subject-derived feature directories, create-only writes, and exact revocation. Missing trust or a network-only verifier is unresolved/asserted and never GREEN proof.
- Bare TTY and pseudo-TTY signoff, hand-written receipt YAML, caller strings, and OS/git identity remain asserted. Registered host elicitation/external signing produces a portable verified human receipt; absent that adapter, verified signoff returns `HUMAN_REQUIRED`.
- A human receipt becomes stale when its subject, reviewed inputs, complete runtime-dependency byte/sentinel closure, implementation-author set, trust snapshot, or signature changes. A direct feature-module edit is only one member of that closure. Two branches adding different content-addressed receipts merge with both files preserved; deleting one is possible only through explicit revocation.
- A blind receipt contributes independence only with a current matching testcase pass and never clears UAT. A past pass, skipped-only observation, or unexecuted generated test is insufficient.

### Transactions and attestation

- `feature.begin` covers `planned | blocked | done → in_progress`, idempotent `in_progress`, archived/unknown refusal, and a begin-plus-intent-edit batch. Every successful transition has exactly one recoverable pre-batch checkpoint; every refusal or interrupted rollback leaves the shard, inventory, and event stream at the specified boundary.
- Schema 0.2 `clad done` rejects every source status except `in_progress` without running a completion transition; the 0.1 compatibility fixture preserves shipped behavior.
- Parallel different-shard edits both succeed; same-shard second edit is stale; lock timeout is BUSY and writes nothing.
- A matching `context_revision` cannot authorize a write with stale `input_revisions`; same-session delta reuse and region write concurrency are tested independently.
- Inventory-region writes do not stale project-region revisions.
- Attestation matrix covers contract, implementation module, out-of-module test, runner configuration, oracle, evidence, capability outcome, architecture constraint, notes, and required/advisory scenario changes.
- Only the intended feature set becomes stale for a shared rule/outcome/scenario change.
- F6's pre-migration v3 fixture serializes exact schema-0.1 contract nodes without invented purpose/kind; F7 migration intentionally stales them and rewrites pure-0.2 hashes.
- Lifecycle operations cover block reasons, terminal archive/no-unarchive policy, proof-ref edits, exact receipt revocation, and `set_links` omitted-versus-empty semantics. Both bulk link replacement and dependency promotion reject self, duplicate, unresolved, and cyclic dependency states.

### Assurance profiles and cadence

- The same compiled obligations yield identical authoritative verdicts through legacy stage projection, profile execution, and split/merged runner adapters.
- Fixtures distinguish upstream `hard | report` strictness from effective Cladding blocking: a reporting failure completes the standard report but remains RED under the default strict profile, while a missing report is unresolved in both. Shipped `advisory` remains a distinct blocking disposition.
- Feedback is non-authoritative and bounded to pure checks; completion is feature/impact scoped; push is branch-integration scoped; release is whole-repository. Required unobserved, timeout, pending environment, or stale results never become GREEN.
- Authored and observed dependency edges both invalidate proof. Ambiguous edges fan out to every candidate; dynamic, unresolved, unowned, or otherwise incomplete scope escalates the affected layer to whole-repository verification.
- A/B/C replay compares every-edit full execution, tiered foreground execution, and tiered plus background execution. Authoritative verdicts must match, stale background PASS promotion is zero, injected required defects are caught before completion, and active wait falls by at least 50% without increasing foreground p95 by more than 10%.
- Background adapters require isolated outputs and cooperative cancellation, run single-flight per worktree, yield to foreground, and publish only exact-digest cache entries. CI/release ignores local background cache.

### Graph validity and bounded retrieval

- Every authored Spec 0.1/0.2 fact round-trips through GraphIR without changing its owner, address, selector, or provenance.
- The independent scanner and GraphIR return identical prerequisite, dependent, artifact-owner, criterion-proof, and regression record sets across the self corpus and generated fixtures.
- A path with several roles is one artifact node; a path with several feature owners never chooses one owner silently.
- Unknown, unresolved, stale, skipped, and unobserved are explicit states, never empty-success aliases.
- Impact fixtures seed traversal from predicted paths before editing and observed diff paths afterward. Unknown scope remains incomplete; expanding every declared feature module is a negative control and must not become the default.
- Fixture, command, file, test, oracle, and evidence references preserve their raw authored spelling as well as their normalized target and resolution state. No missing target is silently aliased to a nearby artifact.
- The `clad_get_graph` payload measures the final serialized response, including schema metadata and omission counts. It never defaults to an unbounded walk.
- Context fixtures independently account for payload, resident, and total UTF-8 bytes, prove `total = payload + resident`, label cold/warm/unknown cache state honestly, and remeasure after budget metadata reaches a fixed point.
- The sorted full MCP list surface and each task-profile challenger have separate reviewed byte ratchets and explicit serialization scope. A task payload ceiling cannot be reported as a total-context ceiling, and an unproven host cache cannot be reported as warm.
- Task-profile ceilings are enforced on fixed-point serialized bytes: 16 KiB for spec-edit/verify/observe and 24 KiB for implement/blind-oracle. Spec-edit fixtures derive required content from the typed operation; no global migration corpus is sent as a task packet. Every self-corpus case has `required_overflow: false` without truncation.
- Verification packets retain criterion, state, selector, and locator/digest before optional failure-first diagnostics. A `diagnostic_cursor` works only in the same session/revision and is neither a public graph cursor nor a `clad_get_context` v1 change.
- Removing criterion nodes, selectors, provenance, direction-aware traversal, purpose, or rationale must make its corresponding ablation fixture fail.
- A 5,000-feature synthetic graph remains linear in nodes plus edges and completes within the repository's existing 15-second CI scale ceiling. Reference targets are at most 500 ms for a cold self-corpus compile plus graph build and 50 ms for a warm focused projection; report these as environment-specific benchmarks, not portable guarantees.

### Preregistered 37-case contract matrix

These are new test obligations, not evidence that an earlier session ran “37/37.” Each ID maps to exactly one test title:

- **P01–P10 parser:** ubiquitous, event, state, optional, unwanted+then, compound order, negation, protected modal, multiple-modal rejection, fragment/unbalanced rejection.
- **L01–L04 legacy:** parsed, opaque, conflict, arbitrary-input no-throw.
- **B01–B06 baseline:** title/purpose trigger, criterion add/remove, statement/kind trigger, rationale/constraint trigger, non-trigger fields, sibling-exemption/live-baseline exclusivity.
- **C01–C06 covers:** bracket token, bare ID ignored, unknown address, unrelated same-file, skipped-only, failure dominance/pass verification.
- **T01–T04 transaction:** different shards, same-shard stale, BUSY no-write, crash recovery.
- **U01–U04 upgrade:** unresolved no-write, `L = N`, atomic apply/zero-diff, interrupted restore-or-finish.
- **A01–A03 attestation:** selective contract stale, proof-input stale, target-versus-sibling receipt freshness.

### Repository gates

- Run `npm run validate:spec-0.2`; a `fail` blocks immediately, while each feature/release boundary explicitly promotes the pending/not-run scenarios it owns to required pass conditions.
- Keep the D24 MCP scenarios distinct: deterministic wire/semantic/mutation parity and one reference-host full Spec 0.2 cycle block 0.10.0 release; multi-host adoption and token advantage do not.
- Keep J01–J13 and AB01–AB12 unique in the executable ledger. A passing model simulation may challenge a design alternative but cannot satisfy a journey labelled implementation-pending or not-run.
- Commit all 37 preregistered fixtures before using “37/37” as evidence; self-consistency rejects missing, duplicate, or unmapped IDs.
- Build the committed plugin mirrors before F1 completion and require the build to produce no uncommitted mirror drift after regeneration.
- Use `clad done` as the one authoritative feature-completion strict gate and attestation refresh; do not duplicate the same full gate on an unchanged tree.
- Run `npm test`, `npm run typecheck`, `npm run lint`, and `node bin/clad check --tier=pre-push --strict`.
- Register newly shipped public terms in the glossary and keep detector-count/self-consistency checks green.
- Run the D19 A–E topology/context suite as F9 acceptance and prove that removing general persona prompts changes neither contract, deterministic gate, verdict, nor stale scope. F5 fixtures must accept valid portable receipts and reject bad signatures/trust; F9 must add real signed human/blind production paths while preserving the asserted fallback.

### Supersession, documentation, and test gates

- Compare the post-cutover source graph with artifact-registry entrypoints, package/bin/hooks, runtime lookups, generated consumers, and spec-owned paths. A production orphan is either removed in the same cycle or has an explicit contract owner and retirement boundary; it never enters an anonymous permanent allowlist.
- Prove that no consumer imports or reconstructs the superseded authority. Compatibility readers may remain, but compatibility must not preserve a second writer, closure, graph identity, or traversal implementation.
- Replace tests of retired internals with contract, oracle, property, or adapter tests before deleting them. Test count and line count may decrease; preserved behavior and fault discrimination may not.
- When the reported public test total changes, regenerate its canonical claims through `scripts/test-count.mjs --write` instead of hand-editing copies.
- Keep this continuation router at or below the 8 KiB hard ceiling and each routed design owner at or below 24 KiB. Maintain a 7.5 KiB operational router ratchet for editing headroom. D01–D24 each have exactly one normative owner, former router anchors remain navigable, and repository-relative links resolve.
- Measure fresh-session context as exact UTF-8 bytes for `AGENTS.md` + router + current task owner documents. Evidence and decision history are on-demand inputs, not a default payload; compare this routed baseline with the former monolith before claiming token savings.
- If `_doc-links.yaml` changes shape, its writer, extractor, GraphIR reader, `DOC_REFERENCE_INTEGRITY`, sync idempotence, and downgrade/regeneration fixture cut over together.

<a id="d18--implementation-hygiene-and-documentation-surface"></a>

D18 moved to [Implementation hygiene](hygiene.md#d18--implementation-hygiene-and-documentation-surface); this pointer is non-normative and preserves the former owner-document anchor.
