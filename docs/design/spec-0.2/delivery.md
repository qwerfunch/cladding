<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — delivery and acceptance

> Canonical owner of D15 and D16. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## D15 — Implementation sequence

> Implementation-cycle trace: `feature:F-208eaa79` is the F8 implementation shard for this accepted delivery sequence; D15/D16 remain the normative authority.

**V0 and F1–F11 ship in 0.10.0:** V0 adds validation ledger, simulator, token accounting, and D24 wire/efficacy. Targets remain `implementation_pending`; it proves neither preregistered cases nor host E2E, and challengers await owner/log update.

Follow one feature cycle at a time; author each shard immediately before implementation.

F1 bootstraps under 0.1 because F2 adds the 0.2 reader. Its shard uses EARS/`text`, WHY in `notes: "## Why\n..."`, and D10/D17 links; it must not pre-author 0.2 `purpose`, `statement`, or `kind`, then migrates normally.

F1 uses an independent sorted source-YAML snapshot oracle, without production loader/index/GraphIR/query imports. The additive compiler proves parity while consumers stay unchanged and failure local.

1. **F1:** commit design, artifact/ID registries, GraphIR v2 skeleton, and node baseline. Preserve stale `hash6` as a parity negative until registry policy, then repair before completion.
2. **F2:** version dispatch, strict parser, atomicity advisory, total legacy scanner, and preview.
3. **F3:** project, feature-capability links, catalog, and architecture 0.2; prove `L = N` in memory without cutover.
4. **F4:** `clad_edit_spec`, `feature.begin`/`clad begin`, context/input revisions, lock/recovery, journaled apply, and adapters.
5. **F5:** proof adapters, covers/case observations, legacy fallback, receipt protocol/ingestion/revocation, asserted `clad signoff`, and detector rewiring. Test issuers prove protocol; no verified product issuer ships here.
6. **F6:** shared closures, the [D21–D23](assurance.md#d21--iron-law-assurance-kernel) DAG/reducer, legacy 15-stage projection, profile-aware `clad done`, and v3.
7. **F7:** scenario v2 and `off | advisory | required`, then accept/reject the narrow L2 baseline before atomic self-migration; complete F7 on 0.2 and write pure-0.2 v3.
8. **F8:** atomically cut graph CLI/JSON, exporters/viewer, and `clad_get_graph` to GraphIR v2; retain no v1 adapter.
9. **F9:** ship `CycleContextEnvelope`, task projections, scheduler, registered human/blind issuers, and A–E; retain headless-loop compatibility.
10. **F10:** after F9 green, replace developer→reviewer choreography with task-state dispatch. Viewer polish/broader retrieval remain tail work.
11. **F11:** add aliases/`clad relocate-generated [--apply]`, transition self before final enforcement, and prove D14 state/recovery.

There is no F7.5 context-wire migration; F8 is the graph-v2 cutover. F11 does not retroactively block F7–F10 completion, but 0.10.0 needs applicable F1–F11 evidence. Standards, docs, glossary, and generated mirrors update in their owner feature.

### Cutover and retirement map

F1 is the same-cycle-retirement exception: additive parity deletes no shipped compiler, loader, graph, detector, or optimizer path. From F2, each cycle inventories superseded authority and retires it after proven cutover.

| Boundary | Required retirement after cutover |
|---|---|
| F4 transactional writer | Move direct shard/status mutation in `src/spec/new.ts` and `src/cli/done.ts` behind the transaction engine. Remove forwarding-only or second-writer logic once existing commands are thin domain adapters; retain 0.1 reading, not a second write authority. |
| F5/F6 proof compiler | Remove duplicate reference normalization, binding joins, and proof-closure calculations after detectors, report paths, and attestation consume the shared implementations. Keep legacy references as input compatibility, not as a parallel proof model. |
| F8 GraphIR cutover | Retire graph v1 identities, reverse-index materialization, undirected/repeated traversal, and tests that assert those obsolete internals. CLI, MCP, report, impact, working-set, export, and viewer paths become queries or serializers over GraphIR; no v1 adapter survives. |
| F9 context-envelope implementation | Revise the F-041/F-063 contracts that currently protect `src/optimizer/preamble.ts` and `src/optimizer/tail.ts`, then retire those production orphans after equivalent omission, tail, budget, and fixed-point behavior is covered by the envelope packer. |
| F10 task-state loop | Retire hard-coded developer/reviewer identity choreography and loop-only mock/stub dispatch after topology invariance and real evidence ingress are green. Product transport fallbacks remain until their separately owned compatibility contracts are intentionally revised. |

A path survives only with a distinct public/compatibility contract and recorded feature-rationale/test exit condition. There is no permanent retirement manifest or cleanup-only release phase.

Each cycle is simulation → implementation → verification → `clad done`. Feedback compiles without subprocesses; checkpoint checks changed inputs; `clad done` checks proven closure and escalates unknown scope to repository. Push/release are integration boundaries. Exact-digest reuse is allowed; background never writes lifecycle/attestation. Rebuild mirrors before completion and run contributor push checks.

## D16 — Acceptance gates

Corpus gates compare sorted semantic records, not hand-maintained totals. The independent snapshot records owner, composite address, channel, raw/normalized ref, selector, resolution, path, YAML path, and range; counts are derived. Edits update the reviewed diff, never a second literal total. [Evidence snapshot](evidence.md#evidence-snapshot) totals are dated evidence, not acceptance constants.

### Compatibility and grammar

- Every feature and criterion record in the canonical self-corpus snapshot compiles as 0.1 with an identical owner, address, source locator, and unchanged blocking result.
- New strict parser fixtures cover five patterns, compound ordering, comma rules, a single modal, negation, protected spans, fragments, and unbalanced spans.
- `ATOMICITY_RISK` reports its observed advisory signals on a one-modal multi-obligation control, while a long atomic control proves that any heuristic false positive remains non-blocking under strict mode.
- Property tests show the legacy scanner returns `parsed | opaque | conflict` and throws zero times for arbitrary strings.
- Unknown schema versions hard-fail before artifact merging.
- `spec.yaml#schema` alone selects workspace schema. Child `schema` fields and mixed 0.1/0.2 spellings are rejected in 0.2; independent `receipt_schema` dispatch cannot switch workspace interpretation.

### Migration

- Preview requires `PROJECT_LEGACY_L2_BASELINE: accept | reject`, separately from assurance confirmation, and reports the deterministic done-source criterion count and digest without historic-stage, ref, agent-claim, or L2 inference. Reject writes no authorization.
- Accepted atomic apply writes immutable criterion-local, done-source L2 Unit/Coverage authorizations with final-intent and candidate/resolution SHA-256 identities. Reviewed-migration strict intent is eligible and becomes its immutable target; only post-migration new/later-target-edited criteria are ineligible/revoked, while unchanged siblings survive feature edits.
- Exact live/reviewed/legacy selectors and registered static rules take precedence (pass/fail/skip/absent/stale/unsafe); path-only historic refs alone may qualify, but unrelated same-file passes and global fan-out never do.
- Capability edge cutover proves `L = N` before schema switch.
- F3 performs that proof without disk cutover; only F4's journaled apply may remove legacy child `schema`/`source`, write new edges, and switch the root schema.
- A feature with no legacy capability edge receives an explicit empty `capability_refs`; suggested candidates never enter the applied candidate without human confirmation.
- Unresolved preview and normal failure write zero bytes.
- Before F11, migration keeps old paths canonical so F7–F10 complete. The final F11 engine leaves adopters 0.2+old and names separate relocation.
- Dirty planned paths refuse either apply while unrelated dirt remains allowed; receipts bind preflight HEAD and sorted paths.
- In the final F11 engine, 0.2+old is `relocation_required`: only read/diagnose/relocate is available, authoritative profiles are unresolved, both paths conflict, and an active journal is recovery-only.
- Crash recovery is byte-exact or finishes the recorded transaction; exact-path VCS restore is the escape, and a second successful apply is zero-diff.
- The F7 self-migration proves preview-on-0.1, human resolution, one atomic apply, post-switch `clad done`, and pure-0.2 v3 output; F8 begins from that real 0.2 tree.

### Binding and proof

- Adapter fixtures restore and prove source carrier → normalized selector → runner/JUnit testcase → composite criterion round trips; a parser defect (including dropped Vitest `ancestorTitles`) cannot be baseline-laundered.
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
- Schema 0.2 completion gates an in-memory prospective `done` state and has no durable pending marker. A successful final journal atomically contains the feature, its required projections, v3 receipt, and successful completion event; every non-success path leaves those canonical artifacts unchanged.
- Parallel different-shard edits both succeed; same-shard second edit is stale; lock timeout is BUSY and writes nothing.
- A matching `context_revision` cannot authorize a write with stale `input_revisions`; same-session delta reuse and region write concurrency are tested independently.
- Inventory-region writes do not stale project-region revisions.
- Attestation matrix covers contract, implementation module, out-of-module test, runner configuration, oracle, evidence, capability outcome, architecture constraint, notes, and required/advisory scenario changes.
- Only the intended feature set becomes stale for a shared rule/outcome/scenario change.
- F6's pre-migration v3 fixture serializes exact schema-0.1 contract nodes without invented purpose/kind; F7 migration intentionally stales them and rewrites pure-0.2 hashes.
- v3 fixtures prove baseline-basis hashing, required/pass/na/migration-baseline counts, receipt/resolution/authorization identity sealing, current-observation-only identities, passing scope Unit/Coverage authority, freshness/retention, and public count disclosure.
- Lifecycle operations cover block reasons, terminal archive/no-unarchive policy, proof-ref edits, exact receipt revocation, and `set_links` omitted-versus-empty semantics. Both bulk link replacement and dependency promotion reject self, duplicate, unresolved, and cyclic dependency states.

### Assurance profiles and cadence

- The same compiled obligations yield identical authoritative verdicts through legacy stage projection, profile execution, and split/merged runner adapters.
- Fixtures distinguish upstream `hard | report` strictness from effective Cladding blocking: a reporting failure completes the standard report but remains RED under the default strict profile, while a missing report is unresolved in both. Shipped `advisory` remains a distinct blocking disposition.
- Feedback is non-authoritative and bounded to pure checks; completion is feature/impact scoped; push is branch-integration scoped; release is whole-repository. Required unobserved, timeout, pending environment, or stale results never become GREEN.
- Authored and observed dependency edges both invalidate proof. Ambiguous edges fan out to every candidate; dynamic, unresolved, unowned, or otherwise incomplete scope escalates the affected layer to whole-repository verification.
- A/B/C replay compares every-edit full execution, tiered foreground execution, and tiered plus background execution. Authoritative verdicts must match, stale background PASS promotion is zero, injected required defects are caught before completion, and active wait falls by at least 50% without increasing foreground p95 by more than 10%.
- Background adapters require isolated outputs and cooperative cancellation, run single-flight per worktree, yield to foreground, and publish only exact-digest cache entries. CI/release ignores local background cache.
- Cladding persists L2 after migration and its self release attestation remains L2. Legacy history grants no L3/L4 waiver; a stronger one-run feature completion requires a compiler-proven bounded closure.
- Each applicable required scope Unit/Coverage family needs current pass; compiler-proven non-applicability is NA. A baseline-backed family is RED on fail and unresolved on skip/missing/stale. Baseline resolves only unchanged authorized L2 Unit/Coverage criterion rows, never Oracle, L3/L4, or human/system-quality obligations; legacy projection maps it to unobserved, never pass/NA.

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

At the F6 boundary, the active fixture ledger names P01–P10, L01–L04, B01–B06, C01–C06, T01–T04, U01–U04, and A01–A03. These are executable obligations, not a runtime pass count; F7 scenarios, F8 public GraphIR cutover, F9 scheduler/cache/issuer paths, relocation, and reference-host cycles remain pending.
- **A01–A03 attestation:** selective contract stale, proof-input stale, target-versus-sibling receipt freshness.

### Repository gates

- Run `npm run validate:spec-0.2`; a `fail` blocks immediately, while each feature/release boundary explicitly promotes the pending/not-run scenarios it owns to required pass conditions.
- Keep the D24 MCP scenarios distinct: deterministic wire/semantic/mutation parity plus Codex and Claude Code MCP11 full L4 cycles block 0.10.0; adoption and efficiency do not.
- AB01–AB12 is a Codex-only, at-most-24-call, non-blocking efficiency comparison.
- Keep J01–J13 and AB01–AB12 unique in the executable ledger. A passing model simulation may challenge a design alternative but cannot satisfy a journey labelled implementation-pending or not-run.
- Commit the full preregistered fixture matrix before claiming it as evidence; self-consistency rejects missing, duplicate, or unmapped IDs.
- Build the committed plugin mirrors before F1 completion and require the build to produce no uncommitted mirror drift after regeneration.
- Use `clad done` as the one authoritative feature-completion strict gate and attestation refresh; do not duplicate the same full gate on an unchanged tree.
- Cover legacy profile aliases with fixtures. Run the final release gate exactly once: `node bin/clad check --profile release --strict`; do not repeat the full gate through an alias.
- Register newly shipped public terms in the glossary and keep detector-count/self-consistency checks green.
- Run the D19 A–E topology/context suite as F9 acceptance and prove that removing general persona prompts changes neither contract, deterministic gate, verdict, nor stale scope. F5 fixtures must accept valid portable receipts and reject bad signatures/trust; F9 must add real signed human/blind production paths while preserving the asserted fallback.
- F9–F11 minimally fixture the issuer, L4 closure, and relocation mechanisms. Live human evidence is only a real human-signed receipt in each Codex and Claude Code MCP11 cycle; deterministic trust snapshots are protocol/mechanism evidence.
- Release notes make the public README decision explicit: Cladding is self profile-complete at persisted L2; L4 product mechanism and host evidence is reported separately. This design does not change current README assurance claims.

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
