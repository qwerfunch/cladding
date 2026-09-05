<!-- Cladding · Tier B · accepted target design — implementation pending · Refreshed by: manual -->

# Spec 0.2 — evidence snapshot

> Canonical measurement record supporting the accepted design. Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## Evidence snapshot

All values below are **verified measurements** of the repository on 2026-08-28 unless labelled otherwise. Re-run them at implementation start; they are a design snapshot, not permanent invariants.

### Reproduction rules

- Corpus counts parse the sorted YAML shards and count typed records, never filenames or grep hits as semantic objects. F1 replaces the ad-hoc script with its committed independent scanner snapshot.
- Source `@see` counts use the exact pattern `@see\s+spec/features/` over `src/**/*.ts`; broader `spec/features/` searches intentionally find unrelated compiler references.
- A legacy test ref is resolvable only when its normalized repository path exists; occurrences and unique targets remain separate measures.
- Module fan-out parses each feature's `modules` list, normalizes paths, and counts distinct feature owners per path.
- Role-brief measurements include the six role Markdown files under `src/agents/` and exclude `src/agents/README.md`.

Any implementation-start difference is reviewed as a sorted record diff with a per-record cause; do not reconcile it by changing a literal expected total.

### Intent and AC representation

| Measurement | Value | Design consequence |
|---|---:|---|
| Feature shards | 281 | Migration and compatibility corpus. |
| Acceptance criteria | 1,118 | Migration and grammar corpus. |
| Feature `purpose` | 0/281 | A typed WHY home is genuinely absent. |
| ACs with `notes` | 306/1,118 (27.4%) | WHY leaks into an optional non-normative field. |
| Features with `design_impact` | 20 | Keep governance metadata but do not confuse it with default WHY. |
| Scenarios | 2 | Both lack actor in the 0.1 model. |
| ACs with `text` | 1,118 | `text` is the only universal migration source. |
| ACs with `action` | 830 | Structured fields are incomplete. |
| ACs with `response` | 839 | Structured fields are incomplete. |
| ACs with `condition` | 543 | Structured fields are incomplete. |
| Text-only ACs | 130 | Deriving text from structured data would lose contracts. |
| Current structured rendering matching text | 44/830 | Do not regenerate legacy statements from the triplet. |
| One `shall` modal | 1,023 | Most current text is close to atomic surface grammar. |
| Multiple `shall` modals | 95 | Strict-new must reject; legacy remains grandfathered. |
| Mixed-polarity multi-modal | 21 | The earlier 98.2% acceptance figure mainly tolerated positive compound modals and is not the strict-new target. |
| Simple pattern/leading-keyword conflicts | 22 | Do not freeze a claimed 19 without explicit per-case opaque exclusions. |

The current [`src/spec/ears.ts`](../../../src/spec/ears.ts) validates legacy `condition` fields and uses a different complex ordering from the upstream grammar. It is evidence for version dispatch, not the implementation to reuse unchanged.

### Identity and sharding

| Measurement | Value | Design consequence |
|---|---:|---|
| Distinct AC ID strings | 742 across 1,118 ACs | AC IDs are feature-scoped. |
| AC occurrences using a duplicated ID | 402 | External binding requires the composite address. |
| `AC-001` occurrences | 72 | Bare-AC test binding would be unsafe. |
| Feature body slugs | 201 | All 201 match their filename slug. The redundant body field can be removed mechanically when the filename is valid. |
| Legacy `F-NNN.yaml` shards | 80 | Continue 0.1 reading. |
| Six-hex filename shards | 95 | Continue 0.1 reading. |
| Eight-hex filename shards | 106 | Production already emits the target form. |

Current production emits eight hex characters in [`src/spec/new.ts`](../../../src/spec/new.ts). Historical compatibility material may name hash6; the executable ID registry owns current reader and writer wording.

### Compiler bootstrap and reference resolution

Dependency counts below use Madge's resolved import graph. “Production” scans `src`; “repository TypeScript” scans `src`, `tests`, and `conformance`. They measure dependency centrality, not a prediction that every dependent file must be edited.

| Measurement | Value | Design consequence |
|---|---:|---|
| `src/spec/types.ts` production dependents | 56 direct; 95 transitive | Replacing the central type surface before parity has a wide production blast radius. |
| `src/spec/load.ts` production dependents | 33 direct; 58 transitive | Keep the first compiler additive instead of cutting over the loader. |
| `src/spec/types.ts` repository-TypeScript dependents | 85 direct; 265 transitive | Tests and conformance substantially enlarge the validation surface. |
| `src/spec/load.ts` repository-TypeScript dependents | 52 direct; 189 transitive | Loader replacement belongs after compiler parity, not before it. |
| Registered default drift detectors | 41 | Count entries in `allDetectors`. The directory has 44 TypeScript files: 41 detector modules, `index.ts`, and the two shared helpers `with-spec.ts` and `spec-first-window.ts`; file count is not catalog authority. |
| Source-locator prototype | 281/281 features; 1,118/1,118 criteria; zero parse errors; 60.96 ms | A provenance-bearing envelope is feasible over Spec 0.1 without changing `loadSpec`. |
| Evidence-reference occurrences | 349 total: 281 file-style, 52 `fixture:`, 16 `self-dogfood:` | Keep channel and raw spelling; one generic path counter is insufficient. |
| Fixture addresses | 52 occurrences; 45 unique; all registry-resolved | `conformance/fixtures.yaml` can supply stable anchors without inventing proof observations. |
| Self-dogfood addresses | 16 occurrences; 14 unique; 13 exact package-script targets; one unresolved unique target | Missing commands remain explicit; nearby command names are not aliases. |
| File-style evidence addresses | 281 occurrences; 279 resolve; `agents/` and the ignored local audit report are unresolved | Existing paths and unresolved declarations must both survive compilation. |

These totals are dated observations. Acceptance derives them from the sorted record snapshot, where occurrence, unique address, and resolution status cannot be conflated by grep strategy.

### Iron Law cadence and assurance invalidation

The dated cadence, invalidation, and A/B/C fault-equivalence measurements moved to [Assurance evidence](assurance-evidence.md#iron-law-cadence-and-assurance-invalidation). This heading preserves the former evidence anchor; normative profile behavior remains in D21–D23.

### Test binding and attestation gap

| Measurement | Value | Design consequence |
|---|---:|---|
| Non-pseudo legacy test refs | 1,208 | Migration population. |
| Refs without `#selector` | 803 | A testcase cannot be selected honestly by automation. |
| Refs with selector | 405 | Candidate population for exact adapter migration. |
| Simple exact source-title matches | 372 | Upper-bound candidate under a literal Vitest/Jest scan, not proof of framework round-trip. |
| Resolvable legacy test-ref occurrences | 1,202 | Six of 1,208 occurrences currently do not resolve. |
| Existing refs outside owner `modules` | 1,025 | Current module-only attestation misses most test changes. |
| Features with an outside-module test ref | 190 | Verification digest must be feature-specific. |
| Resolved file-style evidence refs | 279 of 281 occurrences | Evidence content needs its own freshness closure; unresolved refs remain visible rather than disappearing from the graph. |
| Resolved file evidence outside owner modules | 58 | Module hashing does not protect it. |
| Done features with a declared proof address on every AC | 277/277 | Declaration completeness only. |
| Current attestation feature markers | 277 | Last-GREEN module signature only, not case-level proof. |

The current [`src/spec/attestation.ts`](../../../src/spec/attestation.ts) hashes module bytes, and [`src/stages/junit-report.ts`](../../../src/stages/junit-report.ts) aggregates results per file rather than selector. D11 and D13 close both gaps.

### Knowledge graph fidelity, query, and token simulation

The following audit used the same 281-feature/1,118-criterion corpus. “Prototype” means an in-memory read-only model of the proposed identities and relations, not shipped GraphIR v2 behavior.

| Measurement | Value | Classification / consequence |
|---|---:|---|
| v1 dependency facts represented | 249/249 | Verified measurement; coarse forward links work. |
| v1 affected-path facts represented | 1,071/1,071 | Verified measurement; `touches` works at feature level. |
| v1 criterion facts represented | 0/1,118 | Verified measurement; v1 is not a contract graph. |
| v1 criterion-proof facts represented | 0/1,557 | Verified measurement; file-level feature edges lose proof ownership. |
| Existing source `@see` references | 47 total; 41 resolve, 6 break | Verified measurement; strict provenance resolution detects real drift. |
| Prototype prerequisite queries | 281/281 exact | Prototype result. |
| Prototype impact queries | 281/281 exact | Prototype result. |
| Prototype criterion-proof queries | 281/281 exact | Prototype result. |
| Prototype regression queries | 281/281 exact | Prototype result. |
| Prototype artifact-owner queries | 427/427 exact | Prototype result. |
| Compact semantic manifest | median 503; p95 871; max 2,702 estimated tokens | Projection with simulated one-sentence project/feature purposes; not a migrated-corpus measurement. |
| v1 raw depth-2 neighborhood | 124/281 above 3,000 estimated tokens | Verified simulation; generic BFS is not a safe LLM default. |
| v1 unbounded neighborhood | median about 72k estimated tokens | Verified simulation and consistent with the shipped server's ~285 KB/~70k note. |
| Prototype v2 lower bound | 2,086 nodes; 4,200 edges | Projection before every future anchor/rule is present. |
| Prototype build | 98.39 ms cold graph phase; 27.07 ms warm median after a 134.9 ms spec load | Environment-specific projection over about 7.9 MB of readable tracked input. |

The token simulation found a concrete packing failure before correction: content fitted under the limit, then per-path omission metadata raised a packet above it. The accepted packer therefore aggregates omissions and remeasures the final response, including its own budget fields, until the estimate is stable.

Ablations justify the model rather than merely decorating it: removing criterion nodes loses all 1,118 criterion identities; reducing test selectors to paths loses 405 selector citations; undirected depth-2 traversal creates the measured token overflow. The implementation must turn these into committed fixtures before treating the prototype results as product evidence.

### Role contract, cycle context, and evidence ingress

The role-contract architecture is shipped, while task-keyed projection and full-envelope accounting are not. Measurements below use exact UTF-8 bytes and a named `characters / 4` token estimator. They include the current role prompt plus serialized feature packet but exclude provider-owned hidden instructions and later tool traffic unless stated otherwise.

| Measurement | Value | Classification / consequence |
|---|---:|---|
| Canonical role-brief Markdown | 6 files; 27,420 bytes; 406 lines | Verified measurement; excludes the directory README. Preserve unique role contracts, but remove repeated choreography only through canonical-source edits. |
| Current developer role body | 4,969 bytes; about 1,232 estimated tokens | Verified measurement; stable prompt prefix is a material cold-input component. |
| Current reviewer role body | 4,521 bytes; about 1,118 estimated tokens | Verified measurement. |
| Current per-dispatch wire across 281 features | p50 7,977 bytes; p95 11,392; max 27,848 | Verified measurement; developer and reviewer receive the same full feature JSON rather than task-specific projections. |
| Current two-dispatch headless cycle | p50 15,836 bytes; p95 22,460; max 55,286 | Verified measurement; excludes subsequent tool results and MCP catalog residence, so it is a lower bound on physical cycle context. |
| Current serialized feature body | p50 about 704; p95 1,507; max 5,454 estimated tokens | Verified measurement under the `characters / 4` estimator. |
| Conservative full-feature `spec-edit` envelope | max 12,186 bytes (`F-0f4dd6`) | Read-only projection including feature contract, parsed architecture, project intent, relevant capabilities, revisions, write scope, and budget metadata; below the 16 KiB class limit. |
| Criterion-target `spec-edit` envelope | max 1,473 bytes | Read-only operation-scoped projection; supports deriving required content from the write set rather than shipping a whole feature unnecessarily. |
| Focused independence/oracle regression suite | 46/46 tests passed | Verified run over independence, done-policy, oracle recording, and spec-conformance contracts. |

The two `spec-edit` projections enumerate every feature and criterion target, construct a fixed-key compact JSON envelope from the operation read/write set, include all fields named in the table, and measure `Buffer.byteLength(JSON.stringify(envelope), 'utf8')`; the reported value is the maximum record. F9 converts this read-only method into a committed fixture before treating the ceiling as a product result.

#### Cycle context envelope (self corpus, 2026-09-03)

Measured by `buildCycleContextEnvelope` over the live GraphIR workspace with no host-supplied runtime facts. Each figure is the final `payload_utf8_bytes` after budget and omission metadata, and every profile reached its byte fixed point in three remeasure rounds.

| Feature | `spec-edit` | `implement` | `verify` | `observe` | `blind-oracle` | Omissions |
|---|---:|---:|---:|---:|---:|---|
| `F-208eaa79` (56 modules, 23 criteria) | 7,247 | 20,757 | 16,160 | 1,184 | 23,544 | 0 |
| `F-001` (4 modules, 2 criteria) | 1,773 | 2,401 | 2,881 | 1,147 | 2,313 | 0 |

The `implement` column is the default packet, which does not carry `ownership-fan-out`: D19 keeps that summary available lazily, so it travels only when a request names it in `include`. Asked for explicitly the hub packet is 20,828 bytes and sheds the block it asked for, reporting `ownership-fan-out` omitted at 17,460 bytes — the expansion does not fit under 24 KiB alongside the hub's own contract. The small feature's included packet is 4,558 bytes with nothing omitted. The F9b census reads that difference across the whole corpus.

`required_overflow` is zero on both. Two figures sit close to their class limit and are the ones to watch: hub `verify` holds 224 bytes under the 16 KiB limit with no optional section left to shed, and hub `blind-oracle` holds 1,032 bytes under 24 KiB carrying declaration-only signatures for 56 modules.

#### A–E simulation (self corpus, 2026-09-03)

Measured by `tests/optimizer/topology-suite.test.ts` over 295 features; exact UTF-8 bytes. Arm A is the shipped dispatch (persona body plus the `ctxFor` packet), arm B one general agent's task envelope, arm E the legacy read set the projection replaces. These two rows replace the retired prototype two-task aggregates, which were lower bounds over an incomplete projection.

| Arm and measurement | p50 | p95 | max |
|---|---:|---:|---:|
| A developer dispatch, persona-inclusive | 7,570 | 10,834 | 30,050 |
| A reviewer dispatch, persona-inclusive | 7,122 | 10,386 | 29,602 |
| A shard JSON only, persona removed | 2,601 | 5,865 | 25,081 |
| A two-dispatch no-retry cycle | 14,692 | 21,220 | 59,652 |
| B `implement`, default | 3,753 | 7,002 | 20,757 |
| B `verify` | 3,849 | 5,819 | 16,160 |
| B `spec-edit` | 2,186 | 3,311 | 9,896 |
| B `observe` | 1,173 | 1,194 | 1,278 |
| B `blind-oracle` | 2,294 | 8,283 | 29,172 |
| B implement+verify cycle, default | 7,572 | 12,542 | 36,917 |
| B `implement` follow-up carrying the fan-out | 7,462 | 20,371 | 23,805 |
| B ownership fan-out block itself | 5,699 | 22,340 | 33,774 |
| B cycle including the fan-out follow-up | 15,948 | 29,901 | 57,745 |
| E reconstruction floor, matched lines | 5,369 | 12,074 | 32,668 |
| E reconstruction ceiling, whole files with attestation read by row | 68,291 | 292,479 | 582,354 |

The fan-out rows are what changed the shipped packer. F9a packed `ownership-fan-out` resident whenever it fitted under the 24 KiB `implement` ceiling, and that one block put the cycle p95 at 25,092 bytes against arm A's 21,220 on 94 of 295 features — the projection cost more than the two-dispatch path it replaces. D19 calls the same summary available lazily, and the profile now says so structurally: a lazy section is never packed by default, a caller that needs it names it in `include`, and the follow-up is a second whole packet. The default cycle is 12,542 bytes at p95 and exceeds arm A on no feature, which is the figure AC-397aac78 asserts. The follow-up cycle is recorded and deliberately not asserted: asking for the expansion costs 29,901 bytes at p95 and exceeds arm A on 142 of 295 features. That is the honest price of a second query, and it is paid by the operation that wants the fan-out rather than by every implement packet. This is a physical-input record only: no host ran a task, so it supports no efficiency-when-used or adoption claim.

All 295 features project a blind packet, and none of the 174,677 candidate implementation lines of their `src/` modules appeared in one. A candidate is a non-blank, non-comment, non-import line that is neither an `export` declaration header nor a continuation of one nor a `name: Type` field, at least 12 characters long and carrying two or more word characters. Fourteen declared modules are directories rather than files, with and without a trailing slash; a directory has no declaration lines, so it contributes none and is still recorded in the read manifest as a path that was offered. Before F9b swept the corpus the declaration-only extractor tested for existence and then read bytes, which a directory answers only halfway, so three features could not project at all. The census reads `.cladding/test-report.junit.xml` when it is present, and a vitest run truncates that file to zero bytes before the census reaches it, so the two arm E rows are the no-report figures `npm test` prints. Measured out of band with the full-suite report on disk — 997,786 bytes at this commit — every ceiling quantile rises by exactly that size and the floor rows become p50 8,622, p95 29,051, and max 128,282 matched report lines. The AB11 independence half and the AB12 adoption half are computed from the fixture receipts and event log in every arm, because the envelope carries no per-receipt assurance section and no adoption-telemetry section by design; adding one would be the production growth D19's internal measurement contract forbids. The twelve-item A/B/C matrix, both byte censuses, the leakage sweep, and the 5,000-feature hub add 6.1 s to a full suite run; the 5,000-feature hub packet is 5,692 bytes at its fixed point in about 7 ms.

I-4 closure width, measured the same day by `effectiveFeatureScope` over the compiled workspace for the `completion` L2 profile seeded at `feature:F-001`: the completion closure spans 287 of 294 features (complete, not repository-escalated) through shared-module hubs, so the closure-scoped test filter is recorded rather than built.

### Single-cycle simulation: working-set assembler

The read-only design simulation used the live `F-06dfdad6` working-set feature because it combines six legacy criteria, two prerequisites, three affected paths, eleven legacy test references across three test files, shared-module ownership, and no authored capability edge. The proposed 0.2 delta added purpose `Give an implementation agent the smallest complete, impact-aware context needed to change a feature safely.` and criterion `F-06dfdad6/AC-1b7e4a2c`: `When a task context envelope is serialized, the system shall report its exact UTF-8 byte length after budget and omission metadata are included.` Its test carrier was `[covers:F-06dfdad6/AC-1b7e4a2c] reports final UTF-8 bytes after omission metadata`. These values are fixture inputs, not authored corpus changes.

| Observation | Value | Classification / consequence |
|---|---:|---|
| Spec only | RED | Prototype lifecycle result; no proof declaration exists. |
| Source `[covers:]` without observation | RED / unverified | Declaration is not execution. |
| Matching JUnit pass plus tool evidence | Normal strict GREEN; `independence_policy: require` remains RED; UAT remains RED | Same-author proof is self-certified. |
| Verified blind receipt added | `require` GREEN; UAT remains RED | Isolation can establish independence but cannot impersonate a human channel. |
| Verified human receipt added | Full GREEN | Human ingress closes the human-only boundary. |
| Bound JUnit failure injected | RED in every topology | Explicit failure dominates positive independent evidence. |
| Current developer+reviewer reconstructed task payload | 22,476 bytes | Verified serialization of the selected current fixture; excludes resident catalogs. |
| One general-agent same-session task payload | 5,099 bytes | Prototype lower bound, not product efficiency evidence. |
| Separate general implement+verify task payloads | 7,652 bytes | Prototype lower bound. |
| Restricted blind packet | 580 bytes | Prototype; implementation content leakage was zero. |
| Related-file reconstruction upper bound | 57,849 bytes | Prototype legacy-reconstruction comparator. |
| Historical generic-MCP tool subset | 22 tools; 27,928 bytes | Earlier in-memory serializer; retain as dated evidence, not as the current full list-surface cost. |
| Historical generic-MCP prompt subset | 7 prompts; 1,938 bytes | Earlier serializer; tool+prompt subset was 29,866 bytes before server instructions. |
| Current full MCP list surface | 27 tools + 3 resources + 7 prompts; 140,308 bytes | Verified 2026-09-04 by `npm run validate:spec-0.2`; a 2026-08-31 description-budget cut had taken this surface to 137,898 bytes, the GraphIR v2 cutover grew it past that figure through `clad_get_graph`'s bounded-projection schema, and F9d added `clad_signoff`'s `verified`/`issuer` fields and rewrote its title and description. Canonical JSON includes schemas and annotations, but excludes server instructions and host framing. The F9d verified-signoff path is L4 MECHANISM evidence only until real human signing runs through MCP11. |
| Task-profile MCP challenger | 7,879–88,313 bytes | Controlled tools-only projections are 37.1–94.4% smaller than that full list bundle; host discovery, retries, and provider tokens remain unmeasured. |
| Graph projection model | directed 375 bytes; undirected 610; avoidable 235 | Same required synthetic task output; validates projection mechanics, not GraphIR v2 product efficiency. |
| Assurance cadence model | every-edit 36 units; tiered 15 | Same completion obligations and GREEN reduction; deterministic relative units, not wall-time evidence. |
| V0 validation state (2026-09-03) | 14 pass; 2 implementation-pending; 3 not-run; 2 inconclusive; 0 fail | Infrastructure and model state only. Pending runtime and host evidence are not promoted. |
| Feature-only impact seed | 3 direct dependents | Verified current graph relation. |
| Predicted write path `src/optimizer/working-set.ts` | 4 owners + 2 downstream | Prototype write-scope projection. |
| Expanding all three declared modules | 23 owner seeds + 73 downstream | Negative control; feature modules are too broad as default impact seeds. |
| Historical pre-F5 focused tests | 53/53 passed | Dated V0 run of working-set, code-excerpt, and server tests; not current F5 evidence. |

The stale matrix exposed one granularity defect: a receipt tied to feature `contract_sha256` becomes stale when an unrelated sibling criterion changes. The accepted `subject_sha256` repair preserves that receipt while still staling on the target criterion, referenced capability outcome, architecture constraint, or required-scenario intent. The grammar audit also found a 471-character, one-modal multi-obligation criterion and a separate long statement that a naive conjunction/length rule falsely flags. This is why one modal remains the hard grammar floor while `ATOMICITY_RISK` stays advisory.

Repository source confirms:

- the orchestrator and managed AGENTS text already state that the host owns execution form and that role briefs are not a permitted-agent roster;
- `computeIndependence` and `independence_policy: label | require` already derive the feature label from evidence rather than persona membership;
- the packaged `blind-author` role omits read/search/edit capabilities, but generic `clad_author_oracle` accepts caller-supplied `blind: true` and stores it directly;
- production evidence writers emit LLM/tool entries and oracle entries, but no public CLI/MCP path records an actual human criterion sign-off;
- the cycle guide still prescribes separate planner/developer/test-author/reviewer/observability steps, and the experimental headless loop still hard-codes developer and reviewer dispatches with the same feature payload.

Existing feature rationales record that role-brief wording changed live-agent interpretation, but the raw A/B/C session transcript is not a durable repository fixture. D20 therefore retains briefs conservatively and requires the new committed persona-removal ablation before making a topology-invariance product claim.

### Supersession and document surface

The current production orphan scan (`npx madge --extensions ts --orphans src`) resolves four real entrypoints — `src/cli/benchmark.ts`, `src/cli/clad.ts`, `src/graph/viewer/main.ts`, and `src/spec/cli.ts` — plus `src/spec/compiler/corpus-snapshot.ts` and `src/optimizer/envelope.ts`, which scripts and tests reach but no product path calls yet. It also resolved `src/optimizer/preamble.ts` and `src/optimizer/tail.ts` until F9a: they survived only because F-041 and F-063 owned their behavior, and revising those contracts onto the envelope is what made both files and their tests deletable. That is the worked control case for contract-aware retirement rather than grep-only deletion.

The measured F8/D19 supersession candidate surface is 788 source lines and 820 directly coupled test lines across graph v1, reverse-index, reverse/iterative slice, preamble, and tail files: 1,608 lines total. This is a candidate authority surface, not a promised net deletion. GraphIR, serializers, envelope code, and replacement contract/property tests will remain, so the acceptance signal is removal of duplicate models and traversals rather than a line-count target.

Before semantic routing, this design occupied 92,189 UTF-8 bytes in one Markdown file, about 23k tokens under the deliberately named `characters / 4` estimator. The 2026-09-05 refresh measures a 7,521-byte router, eight canonical decision owners inside the 24 KiB ceiling (4,366–24,531 bytes), and five supporting evidence, validation, and log documents (5,595–28,633 bytes); this evidence snapshot is the one routed document above 24 KiB, because it accumulates dated measurements rather than normative text and no owner loads it to read a decision. A default fresh session containing the 5,288-byte `AGENTS.md`, router, and one canonical decision owner is 17,175–37,340 bytes instead of 97,477 bytes for `AGENTS.md` plus the monolith: a 61.7–82.4% physical-input reduction before host-owned instructions and tool traffic. The complete routed design set is 216,640 bytes (211.6 KiB); selective loading is the gain, not disappearance of authority. Reproduce session figures from `AGENTS.md` + the router + one canonical owner; reproduce the complete routed-design total from the router plus all `docs/design/spec-0.2/*.md` owners, excluding `AGENTS.md`; the separate unsubmitted upstream RFC is not part of the routed target set.

### Orphan and low-value fields

- Corpus `adr_refs`: 0. [`REFERENCE_INTEGRITY`](../../../src/stages/detectors/reference-integrity.ts) explicitly scopes ADRs out until an ADR subsystem exists. Remove the field from new 0.2 authoring.
- Capability `surface` is parsed and written but has no material downstream decision consumer. Remove it from 0.2 rather than preserving a taxonomy for its own sake.
- Preserve `modules` and `depends_on`; their established consumers and meaning justify them, and renaming would create avoidable long-lived dual vocabulary.
