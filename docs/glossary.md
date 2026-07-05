# Cladding · Tier C — Glossary (terminology SSoT)

<!-- F-7ce18e. This file is the single source of truth for every public name.
     tests/self-consistency.test.ts fails when a CLI verb, persona, or MCP tool
     ships without a row here. States: stable | alias (old name still works,
     removal next minor) | deprecated | frozen (wire identifier — never renamed,
     display label may improve). KO column = 한국어 대응 표현 (식별자는 영문 유지). -->

## Brand / model terms (frozen — definitions locked)

| Term | Definition | KO |
|---|---|---|
| `cladding` | The harness that wraps an AI coding model with spec governance — like cladding on a building: the structure (model) does the work, the cladding keeps it weatherproof. | 클래딩 (하네스 본체) |
| `Ironclad` | The standard cladding implements (spec format + stage contract + detector semantics). | 아이언클래드 표준 |
| `Iron Law` | The 4-phase stage pipeline (code quality → tests/conformance → QA → human evidence). Deterministic stages decide; agents only propose. | 철칙 게이트 파이프라인 |
| `Iron Core` | Machine-facing identifiers and structured data (F-ids, stage codes, detector IDs). | 기계용 내부 식별자 층 |
| `Soft Shell` | Human-facing rendering layer — business-language labels over Iron Core ids (`src/ui/softShell.ts`). | 사용자용 표현 층 |
| `Vacuous Green` | A gate that reports PASS while verifying nothing (skip counted as pass, empty suite, broken entry untested). Cladding's central failure class. | 공허한 초록불 (검증 없는 통과) |
| `drift` | Any divergence between spec, code, tests, and docs that the detectors catch. | 표류 (스펙↔코드 어긋남) |
| `shard` | One feature/scenario YAML file under `spec/features/` or `spec/scenarios/`. | 스펙 조각 파일 |
| `EARS` | Easy Approach to Requirements Syntax — AC patterns: ubiquitous / event / state / optional / unwanted. | 요구사항 구문 표준 |
| `Tier A/B/C/D` | SSoT layers: A=sealed spec, B=design (capabilities/architecture/context), C=derived (conventions/index/glossary), D=transient evidence (events/audit logs). | SSoT 4계층 |
| `AC` | Acceptance criterion — one verifiable behavior inside a feature. | 인수 기준 |
| `oracle` | An impl-blind conformance test authored from the spec brief alone (`tests/oracle/`). | 구현-맹검 검증 테스트 |
| `deliverable` | The shipped entry point the gate smoke-runs (stage_2.4). | 출하 진입점 |
| `attestation` | The verification signature (`spec/attestation.yaml`) a GREEN strict pre-push gate writes: module tree-hashes per done feature — the clone-portable answer to "when was this last verified?" (0.6.0). | 검증 서명 |
| `adoption verdict` | Whether an agent CHOSE to **pull** context (a resolved `clad_get_working_set` / `clad_get_context` / `clad_get_impact` read-serve — the only adoption signal) vs what cladding merely **pushed** (impact / session / prompt cards — delivery, never adoption). Three values: `confirmed` \| `not_confirmed` \| `insufficient_data`. Gates the B1 cleanup — see docs/b1-adoption-protocol.md. | 채택 판정 (풀 대 푸시) |

## Personas (alias-and-deprecate bucket)

| Name | State | Role | KO |
|---|---|---|---|
| `orchestrator` | stable | Routes user intent to the right persona; never edits files. | 작업 분배자 |
| `planner` | stable (0.6.0) | Spec author-custodian — owns Tier A, writes EARS ACs, manages archive lifecycle. | 스펙 설계자 |
| `librarian` | alias → `planner` | Old name. Collides with the ecosystem's read-only external-docs researcher role; removal in 0.7. | (구명) |
| `developer` | stable (0.6.0) | Implements production code and tests; reads only the focus feature's slice; never edits spec. | 구현 담당 |
| `specialists` | alias → `developer` | Old name (plural form for a single persona); removal in 0.7. | (구명) |
| `reviewer` | stable | Independent read-only auditor — anti-self-cert barrier; the most replicated community agent name, kept as-is. | 독립 감사자 |
| `observability` | stable | Tier-D analyst over events/audit/perf logs (Anthropic Cookbook's own term for this role). | 로그·지표 분석자 |
| `blind-author` | stable (0.6.0) | Impl-blind test/oracle author — tool-restricted (no Read/Grep/Glob/Edit), so blindness is structural, not promised. Input = the `clad oracle` brief only. | 맹검 작성자 |

## CLI verbs (alias-and-deprecate bucket)

| Verb | State | Meaning | KO |
|---|---|---|---|
| `init` | stable | Scaffold a cladding workspace (intent-aware onboarding). | 작업공간 생성 |
| `sync` | stable | Validate spec + refresh generated state (inventory, deliverable, index). | 스펙 동기화 |
| `check` | stable | Run the Iron Law stages; `--tier`, `--strict`, `--json`. | 게이트 검사 |
| `done` | stable | Gated completion flip: status→done only if the strict pre-push gate is GREEN. | 검증된 완료 처리 |
| `clarify` | stable (0.6.0) | Continue the onboarding Q&A (spec-kit `/clarify` precedent). | 온보딩 질의 진행 |
| `refine` | removed (0.8.0) | Old alias → `clarify` (no CLI precedent); removed — `clarify` is the only spelling now. | (제거됨) |
| `status` | stable (0.6.0) | Render the feature × stage integrity matrix (`git status` convention). | 상태 매트릭스 |
| `panel` | removed (0.8.0) | Old alias → `status` (no CLI precedent); removed — `status` is the only spelling now. | (제거됨) |
| `run` | stable (0.6.0) | Autonomous feature loop (EXPERIMENTAL; host-delegated path preferred). | 자율 루프 실행 |
| `drive` | removed (0.8.0) | Old alias → `run` (no CLI precedent); removed — `run` is the only spelling now. | (제거됨) |
| `work` | removed (0.6.0) | Was a permanently not-implemented reserved stub (always exit 2) — dishonest surface; `run` owns the slot. | (제거됨) |
| `serve` | stable | Start the MCP server over stdio. | MCP 서버 |
| `oracle` | stable | Print the impl-blind authoring brief for a feature/AC. | 오라클 브리프 |
| `setup` | stable | Wire cladding into installed AI hosts (Claude/Codex/Gemini/Cursor). | 호스트 연결 |
| `update` | stable | Post-upgrade reconciliation (re-wire, sync, report-only drift). | 업그레이드 정리 |
| `doctor` | stable | Diagnose dispatcher/telemetry health from the events log (brew/npm `doctor` convention). | 환경 진단 |
| `checkpoint` | stable | Record a feature checkpoint event (git HEAD + spec digest). | 체크포인트 기록 |
| `rollback` | stable | Record a rollback event + print the maintainer-runnable git command. | 롤백 기록 |
| `route` | stable | Classify a natural-language prompt to a verb (debug surface for the router). | 의도 분류 |
| `context` | stable (0.6.0) | Print the context slice for one feature (focus + ancestors + scenarios + ai_hints + test_refs) — the Least Context principle, mechanized. | 컨텍스트 슬라이스 |
| `impact` | stable (0.7.0) | Print the blast radius for a change — the transitive dependents of a feature/file plus the scenarios and the regression test set to re-run. The backward complement of `context` (what depends on this, vs what this needs). | 영향 반경(blast radius) |
| `measure` | stable (0.7.0) | Report the search + context efficiency the graph provides per feature — working-set tokens vs the naive (shard + all module files) baseline, dependency depth/edges resolved, regression-set coverage. Deterministic; measures what the graph CAN provide, not agent adoption. | 효율 측정 |
| `infer`-deps | stable (0.7.0) | Suggest feature `depends_on` edges from the code import graph — the dependency edges cladding never auto-produced. Resolves each module's imports to the owning feature; prints reviewable suggestions (a human merges them — anti-self-cert). | 의존 추론 |
| `graph` | stable (0.7.0) | Render the spec↔code↔doc knowledge graph: `export` → mermaid/dot/json/Obsidian-vault or a self-contained offline `html` viewer (WebGL, three.js bundled); `serve` → the same viewer live on localhost, auto-reloading as spec/docs change; `stats` → counts + hubs. | 지식 그래프 |
| `hook` | stable (0.6.0) | Host hook protocol adapter — consumes one host lifecycle event (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop) as stdin JSON; always exits 0. Honest limit: PreToolUse blocking only sees Edit/Write tool calls — a YAML edit made through Bash bypasses lane one; the Stop hook's post-hoc detectors are lane two. Neither lane alone is the guarantee. | 호스트 훅 프로토콜 어댑터 |
| `changelog` | stable (0.6.0) | Render shipped changes since a git ref into human-facing documents — capability-grouped markdown / `--json` manifest / `--audit` verification table / `--catalog` spec listing. Named `changelog` deliberately, NOT `digest` (which means cryptographic hash in this domain — see Naming conventions). | 변경 이력 렌더링 |
| `report` | stable (0.8.0) | Render one deterministic review packet for a git range — spec-shard movement (from `changelog`), changed source files resolved to their owning features via the reverse index, the deduped regression set, and gate + attestation state. `--format md \| sarif \| json`. For PR reviewers/team-leads/auditors: it RENDERS, it gates nothing. | 리뷰 패킷 렌더링 |
| `bundle` | stable (0.8.0) | Write ONE self-contained offline HTML audit bundle (`--out <file.html> [--since <ref>]`) a non-coder can double-click — provenance banner, project header + inventory, feature × stage matrix, capability catalog, shipped changes, audit table, attestation summary. Zero network, no scripts. Deterministic modulo the date stamp; a range that cannot be anchored degrades the changelog + audit sections to a notice while the rest still renders. | 감사 번들 |

> **Internal name — the drive loop.** The `run` verb's loop is internally the
> *drive loop* (`src/drive/loop.ts`), and its evidence identity is `clad-drive`,
> frozen for audit-log compatibility — so `drive` persists in code paths and event
> provenance even though the user-facing verb is `run` (never as a CLI verb: `drive`
> was removed in 0.8.0).
> KO: `run` 루프의 내부 이름은 *drive loop*(`src/drive/loop.ts`)이며, 증거 식별자
> `clad-drive`는 감사 로그 호환을 위해 동결되어 있다 — 사용자 표면 verb는 `run`이지만
> 코드 경로와 이벤트 기록에는 여전히 `drive`가 남는다.

## MCP tools (frozen wire identifiers)

| Tool | Meaning |
|---|---|
| `clad_list_features` | Query features by status/slug. |
| `clad_get_feature` | Fetch one feature + ACs by id or slug. |
| `clad_run_check` | Run drift detection in-process (terse by default). |
| `clad_get_events` | Tail the lifecycle event log. |
| `clad_create_feature` | Author a feature shard with hash id + ACs. |
| `clad_create_scenario` | Author a scenario shard with hash id. |
| `clad_link_capability` | Upsert a capability ↔ feature binding (Tier B). |
| `clad_author_oracle` | Record a host-authored impl-blind oracle + provenance. |
| `clad_run_gate` | Run the real Iron Law gate for a tier in-session (0.6.0; strict by default). Payloads carry `schema_version`. |
| `clad_get_context` | The context slice for one feature by id/slug/module path (0.6.0) — dispatch the slice, never the whole spec. |
| `clad_get_working_set` | The token-budgeted working set for one feature/module (0.7.0) — focus + module CODE excerpts + forward needs + backward breaks + verify + budget, fused in one call; the code-bearing superset of `clad_get_context` (which stays frozen). |
| `clad_get_impact` | The blast-radius slice for a change by feature id/slug/module path (0.7.0) — transitive dependents + scenarios at risk + the regression test set; the backward complement of `clad_get_context`. |
| `clad_get_graph` | The live spec↔code↔doc knowledge graph (0.7.0) — tier-classified nodes (A/B/C/D) + typed edges, optionally a focused neighborhood; recomputed from the current spec so it is never stale. |
| `clad_changelog` | The deterministic shipped-changes manifest since a git ref (0.6.0) — the host renders human release notes FROM it, sourcing every claim from a feature title/AC sentence; `format: markdown \| audit \| catalog` for the deterministic renders. |

## Context surfaces (push vs pull)

Cladding delivers spec context two ways. It **pushes** cards at host lifecycle
events (delivery only — never an adoption signal); it serves **pull** slices when
an agent explicitly asks (the only adoption signal — see `adoption verdict`). The
push cards are telemetered as DELIVERY, never adoption.

| Term | Definition | KO |
|---|---|---|
| `impact card` | The PostToolUse **push** card fired after a file edit. Two shapes: **Tier-1** = a one-liner (impacted feature + regression-test count); **Tier-2** = a rich card (working-set-backed, code-free, ~350-token lane). The label "mini working-set card" is **retired** — the rich shape is the `Tier-2 impact card`. Firing/skip is telemetered by `impact_card_fired` / `impact_card_skipped`. | 임팩트 카드 (푸시; Tier-1 한 줄 요약 · Tier-2 리치 카드) |
| `session card` | The SessionStart **push** card — the project's at-a-glance state when a session opens. Telemetered by `session_card_rendered`. | 세션 카드 (SessionStart 푸시) |
| `prompt suggestion` | The UserPromptSubmit **push** hint — a routing/context nudge attached to the user's prompt. Telemetered by `prompt_suggestion_served`. | 프롬프트 제안 (UserPromptSubmit 푸시) |
| context slice vs working set | **context slice** = the frozen, **no-code** payload behind `clad context` / `clad_get_context` (focus + ancestors + scenarios + ai_hints + test_refs). **working set** = the **code-bearing** superset behind `clad_get_working_set` (that slice + module CODE excerpts + forward needs + backward breaks + budget). One is the pull-slice; the other is that slice plus code. | 컨텍스트 슬라이스(코드 없는 풀 페이로드) 대 워킹셋(코드 포함 상위집합) |

## The check ≡ gate mapping (CLI vs MCP — the #1 confusion)

Same verification, two spellings, plus one cheap subset. The wire ids are frozen,
so this mapping — not a rename — is the fix:

| Surface | Runs | KO |
|---|---|---|
| `clad check --strict` (CLI) | the **full** Iron Law gate — authoritative | 전체 게이트 (CLI) |
| `clad_run_gate` (MCP) | the **full** Iron Law gate, in-session — the MCP twin of `clad check --strict` | 전체 게이트 (MCP, 세션 내) |
| `clad_run_check` (MCP) | **only** the drift-detector subset (cheap, terse) — NOT the full gate | 드리프트 검사만 (경량) |

So `clad check --strict` ≡ `clad_run_gate` (full verification); `clad_run_check`
is the drift-only slice. The CLI `check` is FULL, the MCP `_check` is LIGHT — same
stem, different surface.

## Counting nouns (four axes — do not conflate)

Four independent counts describe the gate; readers routinely merge them. Kept as
four distinct Korean words too, so the conflation cannot survive translation:

| Noun | Count | Counts | KO |
|---|---|---|---|
| phases | 4 | The Iron Law's arc: static quality → tests/conformance → QA → human evidence. | 페이즈 4 (철칙의 4국면 흐름) |
| stages | 15 | The gate stages inside those phases (`stage_1.1` … `stage_4.x`; SSoT = `TIER_STAGES.all` in `src/cli/clad.ts`). | 스테이지 15 (SSoT: TIER_STAGES.all) |
| tiers | 3 | The run scopes a caller selects: `pre-commit` (cheap) \| `pre-push` (+ heavier deterministic) \| `all` (full 15-stage). | 티어 3 (pre-commit·pre-push·all) |
| detectors | 41 | The drift detectors the Drift stage runs (SSoT = `allDetectors` in `src/stages/detectors/index.ts`; count auto-recomputed at build). | 검출기 41 (SSoT: allDetectors) |

## Event types (frozen)

`stage_started` · `stage_completed` · `feature_activated` · `feature_completed` · `evidence_recorded` · `drift_detected` · `feature_checkpoint` · `feature_rolled_back` · `sentinel_miss`

Added 0.6.0 (F-b84c38 — payloads carry `identity` + `head`): `feature_created` (spec shard authored) · `scenario_created` · `done_attempted` (gated flip, kept or reverted) · `gate_run` (tier verification outcome; deduped per identical HEAD/tier/strict/worst) · `stop_blocked` (F-1d23a6 — the Stop host hook blocked a session end on a fresh failure fingerprint; identical fingerprints demote without an event).

Added 0.8.0 (F-6ba22c5c — value-delivery telemetry, so a silent surface is distinguishable from an unwired one): `impact_card_fired` (a PostToolUse impact card produced output — payload file/feature/impacted/tests/unledgered) · `impact_card_skipped` (the card was skipped — `reason` ∈ a closed enum, one per degrade branch; the two high-frequency reasons are aggregated to one event per debounce window) · `session_card_rendered` (a non-empty SessionStart card — payload bytes) · `prompt_suggestion_served` (a non-empty UserPromptSubmit suggestion — payload kind) · `working_set_served` (an MCP read serve of `clad_get_working_set` / `clad_get_context` / `clad_get_impact` — payload tool/query/resolved). Summarized by `clad measure --sessions` as DELIVERY (did the surfaces fire), never adoption.

## Spec schema fields (frozen)

`id` · `slug` · `title` · `status` · `modules` · `depends_on` · `acceptance_criteria` · `ears` · `text` · `condition` · `action` · `response` · `notes` · `test_refs` · `evidence_refs` · `oracle_refs` · `capabilities` · `scenarios` · `inventory` · `ai_hints` · `deliverable` · `oracle_policy`

Ref prefixes: `self-dogfood:` (verified by cladding running on itself) · `fixture:` (conformance registry anchor) · `derived:` (machine-suggested, not author-confirmed — never satisfies a verification mandate; planned 0.6.0).

## Detector IDs (frozen — display labels may improve)

IDs stay exactly as registered in `src/stages/detectors/index.ts` (audit-log stability). Confusable pairs, disambiguated by label:

| ID | Display label clarification |
|---|---|
| `ABSENCE_OF_GOVERNANCE` | governance file **missing** |
| `HOLLOW_GOVERNANCE` | governance file present but **empty** |
| `EVIDENCE_MISMATCH` | evidence file **gone from disk** |
| `STALE_EVIDENCE` | evidence **older than 90 days** |
| `MISSING_IMPLEMENTATION` | spec declares a module the disk **doesn't have** |
| `UNMAPPED_ARTIFACT` | disk has a source file **no feature claims** |
| `STALE_ATTESTATION` | shipped (done) modules **changed since the last attested verification** (0.6.0; vs the committed `spec/attestation.yaml` verification signature) |

## Naming conventions (enforced by review; see docs/code-style.md)

- **CLI verbs**: follow ecosystem precedent first (`check`/`done`/`doctor`/`status`); invent only when no convention exists.
- **Detector IDs**: `SCREAMING_SNAKE`, frozen at birth — name carefully before the first release that ships them.
- **Event types**: `snake_case`, past-tense or noun (`feature_created`, `gate_run`).
- **Functions**: `run*` = execute a stage/command, `render*` = produce output text, `detect*`/`resolve*`/`classify*` = pure computation, `record*` = append to logs, `wire*` = filesystem integration. No `perform*`/`auto*` variants.
- **Personas**: a common noun whose role is readable without context (`planner`, `developer`, `reviewer`).
- **Avoid**: `digest` for summaries (means cryptographic hash in this domain — use `changelog`/`notes`); `verify`-vs-`validate` mixing (validate = schema shape, verify = behavior).
