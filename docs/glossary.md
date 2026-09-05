# Cladding · Tier C — Glossary (terminology SSoT)

<!-- F-7ce18e. This file is the single source of truth for every public name.
     tests/self-consistency.test.ts fails when a CLI verb, persona, MCP tool,
     event type, or detector id ships without a fully populated row here.
     States: stable | alias | deprecated | removed | frozen (wire identifier —
     never renamed, display label may improve) | versioned (wire identifier that
     carries its own schema_version, which may advance independently of the other
     surfaces). KO column = 한국어 대응 표현 (식별자는 영문 유지). -->

## Brand / model terms (frozen — definitions locked)

| Term | State | English definition | KO |
|---|---|---|---|
| `cladding` | stable | The harness that wraps an AI coding model with spec governance — like cladding on a building: the structure (model) does the work, the cladding keeps it weatherproof. | 클래딩 (하네스 본체) |
| `Ironclad` | stable | The standard cladding implements (spec format + stage contract + detector semantics). | 아이언클래드 표준 |
| `Iron Law` | stable | The 4-phase stage pipeline (code quality → tests/conformance → QA → human evidence). Deterministic stages decide; agents only propose. | 철칙 게이트 파이프라인 |
| `Iron Core` | stable | Machine-facing identifiers and structured data (F-ids, stage codes, detector IDs). | 기계용 내부 식별자 층 |
| `Soft Shell` | stable | Human-facing rendering layer — business-language labels over Iron Core ids (`src/ui/softShell.ts`). | 사용자용 표현 층 |
| `Vacuous Green` | stable | A gate that reports PASS while verifying nothing (skip counted as pass, empty suite, broken entry untested). Cladding's central failure class. | 공허한 초록불 (검증 없는 통과) |
| `drift` | stable | Any divergence between spec, code, tests, and docs that the detectors catch. | 표류 (스펙↔코드 어긋남) |
| `shard` | stable | One feature/scenario YAML file under `spec/features/` or `spec/scenarios/`. | 스펙 조각 파일 |
| `EARS` | stable | Easy Approach to Requirements Syntax — AC patterns: ubiquitous / event / state / optional / unwanted. | 요구사항 구문 표준 |
| `Tier A/B/C/D` | stable | SSoT layers: A=sealed spec, B=design (capabilities/architecture/context), C=derived (conventions/index/glossary), D=transient evidence (events/audit logs). | SSoT 4계층 |
| `AC` | stable | Acceptance criterion — one verifiable behavior inside a feature. | 인수 기준 |
| `oracle` | stable | An impl-blind conformance test authored from the spec brief alone (`tests/oracle/`). | 구현-맹검 검증 테스트 |
| `deliverable` | stable | The shipped entry point the gate smoke-runs (stage_2.4). | 출하 진입점 |
| `attestation` | stable | The verification signature (`spec/attestation.yaml`). v1/v2 retain module-hash compatibility; v3 seals current contract, subject, verification, runtime-dependency, profile, and obligation inputs only after a profile-complete authoritative GREEN result. | 검증 서명 |
| `assurance profile` | stable | A named verification cadence: `feedback`, `checkpoint`, `completion`, `push`, or `release`. Legacy `pre-commit`, `pre-push`, and `all` are aliases for checkpoint, push, and release. | 보증 프로필 |
| `adoption verdict` | stable | Whether an agent CHOSE to **pull** context (a resolved `clad_get_working_set` / `clad_get_context` / `clad_get_impact` read-serve — the only adoption signal) vs what cladding merely **pushed** (impact / session / prompt cards — delivery, never adoption). Three values: `confirmed` \| `not_confirmed` \| `insufficient_data`. Gates the B1 cleanup — see docs/b1-adoption-protocol.md. | 채택 판정 (풀 대 푸시) |

## Personas (alias-and-deprecate bucket)

| Name | State | English definition | KO |
|---|---|---|---|
| `orchestrator` | stable | Routes user intent to the right persona; never edits files. | 작업 분배자 |
| `planner` | stable (0.6.0) | Spec author-custodian — owns Tier A, writes EARS ACs, manages archive lifecycle. | 스펙 설계자 |
| `librarian` | alias → `planner` | Old name for `planner`. Collides with the ecosystem's read-only external-docs researcher role; removal in 0.7. | (구명) |
| `developer` | stable (0.6.0) | Implements production code and tests; reads only the focus feature's slice; never edits spec. | 구현 담당 |
| `specialists` | alias → `developer` | Old name for `developer` (plural form for a single persona); removal in 0.7. | (구명) |
| `reviewer` | stable | Independent read-only auditor — anti-self-cert barrier; the most replicated community agent name, kept as-is. | 독립 감사자 |
| `observability` | stable | Tier-D analyst over events/audit/perf logs (Anthropic Cookbook's own term for this role). | 로그·지표 분석자 |
| `blind-author` | stable (0.6.0) | Impl-blind test/oracle author — tool-restricted (no Read/Grep/Glob/Edit), so blindness is structural, not promised. Input = the `clad oracle` brief only. | 맹검 작성자 |

## CLI verbs (alias-and-deprecate bucket)

| Verb | State | English definition | KO |
|---|---|---|---|
| `init` | stable | Scaffold a cladding workspace (intent-aware onboarding). | 작업공간 생성 |
| `sync` | stable | Validate spec + refresh generated state (inventory, deliverable, index). | 스펙 동기화 |
| `migrate` | stable (0.10.0) | Preview a schema 0.1 → 0.2 migration, or apply explicit human-confirmed choices as one recoverable transaction. | 스키마 마이그레이션 미리보기 |
| `begin` | stable (0.10.0) | Start a schema 0.2 implementation cycle, saving its pre-cycle checkpoint with the status update. | 구현 사이클 시작 |
| `check` | stable | Run the Iron Law stages; `--tier` aliases or `--profile`, optional bounded `--assurance-level`, `--strict`, `--json`. | 게이트 검사 |
| `done` | stable | Gated completion flip: schema 0.2 invokes the completion profile; schema 0.1 retains strict pre-push compatibility. | 검증된 완료 처리 |
| `clarify` | stable (0.6.0) | Continue the onboarding Q&A (spec-kit `/clarify` precedent). | 온보딩 질의 진행 |
| `refine` | removed (0.8.0) | Old alias → `clarify` (no CLI precedent); removed — `clarify` is the only spelling now. | (제거됨) |
| `status` | stable (0.6.0) | Render the feature × stage integrity matrix (`git status` convention). | 상태 매트릭스 |
| `panel` | removed (0.8.0) | Old alias → `status` (no CLI precedent); removed — `status` is the only spelling now. | (제거됨) |
| `run` | removed (0.10.0) | Was the experimental headless loop; retired because no recorded session ever ran it — start `clad serve` and let your AI host drive the cycle instead. | (제거됨) |
| `drive` | removed (0.8.0) | Old alias → `run`; both spellings are gone now that the headless loop is retired. | (제거됨) |
| `work` | removed (0.6.0) | Was a permanently not-implemented reserved stub (always exit 2) — dishonest surface; the retired `run` verb owned the slot. | (제거됨) |
| `serve` | stable | Start the MCP server over stdio. | MCP 서버 |
| `signoff` | stable (0.10.0) | Record local audit or UAT history. Asserted by default; with `--verified --issuer <name>` a human re-types the feature id at the terminal and cladding signs a portable receipt with the registered key. Without that confirmation, a registered issuer, or a local signing key it records asserted history only. | 로컬 감사·UAT 기록 (사람이 확인하면 검증된 영수증 서명) |
| `key` | stable (0.10.0) | Manage the issuer signing keys and the committed public trust registry: `create` → one owner-only Ed25519 signing key outside the workspace plus its public half in `spec/trust/issuers.yaml`; `list` → the registered issuers and whether this machine holds their signing keys. | 발행자 키 관리 |
| `create` | stable (0.10.0) | Key subcommand that writes one owner-only Ed25519 signing key outside the workspace (`clad key create --issuer <name>`) and registers its public key in `spec/trust/issuers.yaml` through the spec transaction. | 발행자 키 생성 |
| `list` | stable (0.10.0) | Key subcommand that shows the registered issuers and whether the local signing key is present (`clad key list`). | 발행자 목록 |
| `ingest-receipt` | stable (0.10.0) | Create-only storage for one portable receipt under its subject feature. The CLI accepts no trust, public-key, private-key, or destination authority. | 주체 기능 아래 이식 가능한 영수증을 생성 전용으로 저장 (CLI 신뢰·키·대상 경로 권한 없음) |
| `oracle` | stable | Print the impl-blind authoring brief for a feature/AC. | 오라클 브리프 |
| `setup` | stable | Wire cladding into detected AI hosts (Claude/Codex/Gemini/Antigravity/Cursor). | 호스트 연결 |
| `update` | stable | Post-upgrade reconciliation (re-wire, sync, report-only drift). | 업그레이드 정리 |
| `doctor` | stable | Diagnose dispatcher/telemetry health from the events log (brew/npm `doctor` convention). | 환경 진단 |
| `checkpoint` | stable | Record a feature checkpoint event (git HEAD + spec digest). | 체크포인트 기록 |
| `rollback` | stable | Record a rollback event + print the maintainer-runnable git command. | 롤백 기록 |
| `route` | stable | Classify a natural-language prompt to a verb (debug surface for the router). | 의도 분류 |
| `context` | stable (0.6.0) | Print the context slice for one feature (focus + ancestors + scenarios + ai_hints + test_refs) — the Least Context principle, mechanized. | 컨텍스트 슬라이스 |
| `impact` | stable (0.7.0) | Print the blast radius for a change — the transitive dependents of a feature/file plus the scenarios and the regression test set to re-run. The backward complement of `context` (what depends on this, vs what this needs). | 영향 반경(blast radius) |
| `verdict` | stable (0.8.x) | One-poll loop decision: reduces the pre-push strict gate + feature statuses to ONE of `DONE` \| `ITERATE` \| `ESCALATE` \| `BLOCKED` \| `BOOTSTRAP` with a `next_action` pointer + `remaining` list. Runs the SAME gate once per poll (never a re-implementation); `DONE` requires a green gate AND every feature done AND ≥1 non-liveness behavioral proof. A read-only poll — never stamps attestation. | 루프 판정(1회 폴) |
| `measure` | stable (0.7.0) | Report the search + context efficiency the graph provides per feature — working-set tokens vs the naive (shard + all module files) baseline, dependency depth/edges resolved, regression-set coverage. Deterministic; measures what the graph CAN provide, not agent adoption. | 효율 측정 |
| `infer-deps` | stable (0.7.0) | Suggest feature `depends_on` edges from the code import graph — the dependency edges cladding never auto-produced. Resolves each module's imports to the owning feature; prints reviewable suggestions (a human merges them — anti-self-cert). | 의존 추론 |
| `graph` | stable (0.7.0) | Render the spec↔code↔doc knowledge graph: `export` → mermaid/dot/json/Obsidian-vault or a self-contained offline `html` viewer (WebGL, three.js bundled); `serve` → the same viewer live on localhost, auto-reloading as spec/docs change; `stats` → counts + hubs. | 지식 그래프 |
| `export` | stable | Graph subcommand that exports the knowledge graph as Mermaid, DOT, JSON, an Obsidian vault, or offline HTML. | 그래프 내보내기 |
| `stats` | stable | Graph subcommand that reports graph counts and the highest-degree hubs. | 그래프 통계 |
| `hook` | stable (0.6.0) | Host hook protocol adapter — consumes one host lifecycle event (SessionStart / UserPromptSubmit / PreToolUse / PostToolUse / Stop) as stdin JSON; always exits 0. Honest limit: PreToolUse blocking only sees Edit/Write tool calls — a YAML edit made through Bash bypasses lane one; the Stop hook's post-hoc detectors are lane two. Neither lane alone is the guarantee. | 호스트 훅 프로토콜 어댑터 |
| `changelog` | stable (0.6.0) | Render shipped changes since a git ref into human-facing documents — capability-grouped markdown / `--json` manifest / `--audit` verification table / `--catalog` spec listing. Named `changelog` deliberately, NOT `digest` (which means cryptographic hash in this domain — see Naming conventions). | 변경 이력 렌더링 |
| `report` | stable (0.8.0) | Render one deterministic review packet for a git range — spec entry movement (from `changelog`), how each acceptance criterion moved, changed source files resolved to their owning features via the reverse index, the tests those features declare, the deduped regression set, and gate + attestation state. `--format md \| sarif \| json`. For PR reviewers/team-leads/auditors: it RENDERS, it gates nothing. | 리뷰 패킷 렌더링 |
| `bundle` | stable (0.8.0) | Write ONE self-contained offline HTML audit bundle (`--out <file.html> [--since <ref>]`) a non-coder can double-click — provenance banner, project header + inventory, feature × stage matrix, capability catalog, shipped changes, audit table, attestation summary. Zero network, no scripts. Deterministic modulo the date stamp; a range that cannot be anchored degrades the changelog + audit sections to a notice while the rest still renders. | 감사 번들 |

> **Internal name — the drive loop.** The headless loop was internally the
> *drive loop*, and its evidence identity `clad-drive` stays reserved, frozen for
> audit-log compatibility, so old audit entries keep replaying after the loop
> itself was retired in 0.10.0 (never as a CLI verb: `drive` was removed in
> 0.8.0, `run` in 0.10.0).
> KO: 헤드리스 루프의 내부 이름은 *drive loop*였고, 증거 식별자 `clad-drive`는 감사 로그
> 호환을 위해 동결된 채 예약되어 있다 — 루프 자체는 0.10.0에서 은퇴했지만 과거 감사 기록은
> 그대로 재생된다.

## MCP tools (frozen wire identifiers)

| Tool | State | English definition | KO |
|---|---|---|---|
| `clad_prepare_init` | frozen | Read the project and return a bounded briefing plus one-time token; never writes files. | 초기화 준비 정보 조회 |
| `clad_stage_init` | frozen | Validate the host-model onboarding draft and cache it only as ignored project runtime state for a later approval turn. | 초기화 초안 검증·임시 저장 |
| `clad_init` | frozen | Validate and apply the host model's structured onboarding draft. | 초기화 초안 적용 |
| `clad_prepare_clarify` | frozen | Read current onboarding state and prepare a real user answer for host-model refinement. | 온보딩 보완 준비 |
| `clad_clarify` | frozen | Validate and apply the host model's structured refinement draft. | 온보딩 보완 적용 |
| `clad_resolve_onboarding_review` | frozen | Apply only onboarding proposal targets that the user explicitly reviewed and approved. | 검토된 온보딩 제안 반영 |
| `clad_list_features` | frozen | Query features by status or slug. | 기능 목록 조회 |
| `clad_get_feature` | frozen | Fetch one feature and its acceptance criteria by id or slug. | 기능·인수 기준 조회 |
| `clad_run_check` | frozen | Run the in-process drift-detector subset, terse by default. | 경량 드리프트 검사 실행 |
| `clad_run_gate` | frozen | Run the real Iron Law gate in-session with tier/profile and assurance-level parity; strict is the default. | 전체 게이트 실행 |
| `clad_verdict` | frozen | Reduce one real pre-push strict-gate poll to a verdict, next action, and remaining work. | 반복 루프 판정 |
| `clad_get_context` | frozen | Return the no-code context slice for one feature by id, slug, or module path. | 컨텍스트 슬라이스 조회 |
| `clad_get_working_set` | frozen | Return the token-budgeted code-bearing working set for one feature or module. | 워킹셋 조회 |
| `clad_get_impact` | frozen | Return the blast-radius slice for a proposed change. | 영향 범위 조회 |
| `clad_get_graph` | versioned (schema_version 2) | Return a bounded projection of the spec-to-code-to-doc knowledge graph, or its corpus statistics when no query is given. | 지식 그래프 조회 |
| `clad_changelog` | frozen | Return the deterministic shipped-changes manifest since a git ref. | 변경 이력 조회 |
| `clad_get_events` | frozen | Return a bounded tail of the lifecycle event log. | 수명주기 이벤트 조회 |
| `clad_prepare_spec_edit` | frozen | Return a typed edit projection and canonical input revisions without writing. | 스펙 편집 준비 |
| `clad_edit_spec` | frozen | Apply a typed schema edit batch with optimistic input revisions. | 스펙 편집 적용 |
| `clad_begin` | frozen | Start a feature cycle through the recoverable typed edit boundary. | 기능 사이클 시작 |
| `clad_create_feature` | frozen | Author a feature shard with a hash id, acceptance criteria, and design-impact decision. | 기능 샤드 생성 |
| `clad_resolve_design_impact` | frozen | Mark a structural design impact resolved after all listed Tier-B artifacts changed. | 설계 영향 해결 처리 |
| `clad_author_oracle` | frozen | Record a host-authored implementation-blind oracle and its provenance. | 맹검 오라클 기록 |
| `clad_create_scenario` | frozen | Author a scenario shard with a hash id. | 시나리오 샤드 생성 |
| `clad_link_capability` | frozen | Upsert a capability-to-feature binding in Tier B. | 역량-기능 연결 |
| `clad_ingest_receipt` | frozen | Create-only store one portable evidence receipt; trust comes from the registered host. | 이식 가능한 증거 영수증 수집 |
| `clad_signoff` | frozen | Record local audit or UAT history; with `verified` and a registered issuer, a human confirmation in the host's elicitation form signs a portable receipt. | 감사·UAT 서명 기록 (사람 확인 시 검증된 영수증) |

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

Every EventType wire id is frozen. `stop_blocked`, `gate_run`, and
`done_attempted` carry compact blocker evidence; value-delivery rows distinguish
an unwired surface from a surface that deliberately produced nothing.

| Event type | State | English definition | KO |
|---|---|---|---|
| `stage_started` | frozen | A gate stage began execution. | 게이트 단계 시작 |
| `stage_completed` | frozen | A gate stage completed with its outcome. | 게이트 단계 완료 |
| `feature_activated` | frozen | A feature became active. | 기능 활성화 |
| `feature_completed` | frozen | A feature completed its lifecycle. | 기능 완료 |
| `evidence_recorded` | frozen | Evidence was recorded in the lifecycle ledger. | 증거 기록 |
| `drift_detected` | frozen | Drift detection produced a finding. | 드리프트 감지 |
| `feature_checkpoint` | frozen | A feature checkpoint pinned its state. | 기능 체크포인트 |
| `feature_rolled_back` | frozen | A feature rollback was recorded. | 기능 롤백 |
| `sentinel_miss` | frozen | A dispatcher response missed a required sentinel and used deterministic fallback. | 센티널 누락 |
| `feature_created` | frozen | A new feature shard was authored. | 기능 샤드 생성 |
| `design_impact_resolved` | frozen | Reviewed Tier-B design impact was resolved. | 설계 영향 해결 |
| `scenario_created` | frozen | A new scenario shard was authored. | 시나리오 샤드 생성 |
| `done_attempted` | frozen | A gated attempt to mark a feature done was kept or reverted. | 완료 전환 시도 |
| `gate_run` | frozen | A tier verification gate completed. | 게이트 실행 결과 |
| `stop_blocked` | frozen | A Stop hook blocked a session end on a fresh failure fingerprint. | 세션 종료 차단 |
| `stop_exit_recorded` | frozen | An identical Stop failure fingerprint took the known-failing exit path. | 알려진 실패 종료 기록 |
| `impact_card_fired` | frozen | A PostToolUse impact card produced output. | 영향 카드 제공 |
| `impact_card_skipped` | frozen | An impact card was deliberately suppressed with a closed reason. | 영향 카드 생략 |
| `session_card_rendered` | frozen | A non-empty SessionStart card was rendered. | 세션 카드 렌더링 |
| `prompt_suggestion_served` | frozen | A non-empty UserPromptSubmit suggestion was served. | 프롬프트 제안 제공 |
| `working_set_served` | frozen | An MCP context, working-set, or impact read was served. | 워킹셋 읽기 제공 |

## Spec schema fields (frozen)

`id` · `slug` · `title` · `status` · `modules` · `depends_on` · `acceptance_criteria` · `ears` · `text` · `condition` · `action` · `response` · `notes` · `test_refs` · `evidence_refs` · `oracle_refs` · `capabilities` · `scenarios` · `inventory` · `ai_hints` · `deliverable` · `oracle_policy`

Ref prefixes: `self-dogfood:` (verified by cladding running on itself) · `fixture:` (conformance registry anchor) · `derived:` (machine-suggested, not author-confirmed — never satisfies a verification mandate; planned 0.6.0).

### Additive Spec 0.2 compiler terms

These fields are validated and projected by the additive compiler and migration preview. They do not switch this repository's current schema or enable migration apply.

- `project.purpose` — required project WHY; `intent_summary` remains schema 0.1 source data, never a 0.2 alias.
- `project.assurance_level` — explicitly persisted `L1` | `L2` | `L3` | `L4`; preview proposes `L2` for human confirmation and never infers it from stage layout.
- `project.scenario_policy` — explicitly persisted `off` | `advisory` | `required`; preview proposes `advisory` for human confirmation rather than applying a default.
- `capability.outcome` — required user-visible result for a catalog capability. Capability `summary`, `surface`, and `features` are legacy source fields.
- `feature.capability_refs` — the sole authored feature-to-capability edge set. `[]` deliberately means direct contribution to project purpose.
- `architecture.layers` — ordered foundation-to-entry `string[][]`; object-form layers require migration review.
- `architecture.rules` — `AR-<8 lowercase hex>` `forbidden_import` records. `from` is the importing layer and `to` is the imported dependency layer; every rule has a non-empty rationale.
- `criterion.constraint_refs` — architecture-rule addresses that may supply a constraint rationale. Unknown rules block the contract.
- `L = N` — the sorted migration proof that legacy capability-owned pairs (`L`) exactly equal the feature-owned candidate pairs (`N`) before any future cutover.

## Detector IDs (frozen — display labels may improve)

IDs stay exactly as registered in `src/stages/detectors/index.ts` for audit-log stability.

| Detector ID | State | English definition | KO |
|---|---|---|---|
| `HARDCODED_SECRET` | frozen | Detects secrets committed in source through the configured secret scanner. | 하드코딩된 비밀 탐지 |
| `ARCHITECTURE_VIOLATION` | frozen | Detects imports that violate declared architecture boundaries. | 아키텍처 위반 탐지 |
| `MISSING_IMPLEMENTATION` | frozen | Detects a spec-declared module that is absent from disk. | 구현 파일 누락 탐지 |
| `UNMAPPED_ARTIFACT` | frozen | Detects a source artifact that no feature claims. | 미연결 산출물 탐지 |
| `TECH_STACK_MISMATCH` | frozen | Detects disagreement between declared and observed technology stack. | 기술 스택 불일치 탐지 |
| `STATUS_DRIFT` | frozen | Detects feature status that conflicts with implementation evidence. | 상태 표류 탐지 |
| `STALE_SPECIFICATION` | frozen | Detects specification entries that have become stale. | 오래된 스펙 탐지 |
| `REFERENCE_INTEGRITY` | frozen | Detects invalid references between governed artifacts. | 참조 무결성 탐지 |
| `DOC_LINK_INTEGRITY` | frozen | Detects broken or invalid documentation links. | 문서 링크 무결성 탐지 |
| `HARNESS_INTEGRITY` | frozen | Detects integrity drift in cladding harness wiring. | 하네스 무결성 탐지 |
| `META_INTEGRITY` | frozen | Detects invalid or inconsistent governance metadata. | 메타데이터 무결성 탐지 |
| `AC_DRIFT` | frozen | Detects acceptance criteria whose implementation evidence drifted. | 인수 기준 표류 탐지 |
| `MISSING_TESTS` | frozen | Detects implementation without declared test coverage. | 테스트 누락 탐지 |
| `STALE_TESTS` | frozen | Detects tests that no longer match their implementation contract. | 오래된 테스트 탐지 |
| `COVERAGE_DROP` | frozen | Detects a regression in reported test coverage. | 테스트 커버리지 하락 탐지 |
| `PERFORMANCE_DRIFT` | frozen | Detects performance evidence that diverges from its declared contract. | 성능 표류 탐지 |
| `EVIDENCE_MISMATCH` | frozen | Detects evidence that names a file no longer present on disk. | 증거 파일 불일치 탐지 |
| `STALE_EVIDENCE` | frozen | Detects evidence older than the accepted freshness window. | 오래된 증거 탐지 |
| `UNTESTED_AC` | frozen | Detects an acceptance criterion without a test reference. | 테스트 없는 인수 기준 탐지 |
| `UNVERIFIED_AC` | frozen | Detects an acceptance criterion without verification evidence. | 검증되지 않은 인수 기준 탐지 |
| `CONVENTION_DRIFT` | frozen | Detects naming or repository conventions that were not followed. | 명명 규칙 표류 탐지 |
| `FIXTURE_REFERENCE_INVALID` | frozen | Detects an evidence reference to an unregistered conformance fixture. | 유효하지 않은 픽스처 참조 탐지 |
| `SLUG_CONFLICT` | frozen | Detects two governed records that share a slug. | 슬러그 충돌 탐지 |
| `ID_COLLISION` | frozen | Detects duplicate governed identifiers. | 식별자 충돌 탐지 |
| `INVENTORY_DRIFT` | frozen | Detects disagreement between source inventory and the workspace. | 인벤토리 표류 탐지 |
| `AC_DUPLICATE_WITHIN_FEATURE` | frozen | Detects duplicate acceptance-criterion identifiers within one feature. | 기능 내부 인수 기준 중복 탐지 |
| `ARCHITECTURE_FROM_SPEC` | frozen | Detects architecture documentation that no longer matches the spec. | 스펙 기반 아키텍처 표류 탐지 |
| `CAPABILITIES_FEATURE_MAPPING` | frozen | Detects inconsistent capability-to-feature mappings. | 역량-기능 매핑 불일치 탐지 |
| `ABSENCE_OF_GOVERNANCE` | frozen | Detects a missing governance file. | 거버넌스 파일 부재 탐지 |
| `AI_HINTS_FORBIDDEN_PATTERN` | frozen | Detects forbidden patterns in AI behavior hints. | AI 힌트 금지 패턴 탐지 |
| `PLANNED_BACKLOG` | frozen | Detects planned backlog that breaches its governance policy. | 계획 백로그 위반 탐지 |
| `HOLLOW_GOVERNANCE` | frozen | Detects a governance file that exists but is empty. | 빈 거버넌스 탐지 |
| `DEPENDENCY_CYCLE` | frozen | Detects a cycle in feature dependencies. | 기능 의존성 순환 탐지 |
| `SCENARIO_COVERAGE` | frozen | Detects missing scenario coverage for governed behavior. | 시나리오 커버리지 누락 탐지 |
| `PROJECT_CONTEXT_DRIFT` | frozen | Detects project-context documentation that no longer matches the workspace. | 프로젝트 컨텍스트 표류 탐지 |
| `SPEC_CONFORMANCE` | frozen | Detects lifecycle evidence that fails the specification conformance contract. | 스펙 적합성 위반 탐지 |
| `DELIVERABLE_INTEGRITY` | frozen | Detects a declared deliverable that is missing or invalid. | 출하 진입점 무결성 탐지 |
| `SMOKE_PROBE_DEMAND` | frozen | Owns the safe-deliverable precondition for the stage_2.4 smoke probe. | 스모크 프로브 요구 조건 탐지 |
| `STALE_ATTESTATION` | frozen | Detects done modules changed since authoritative attested verification. | 오래된 검증 서명 탐지 |
| `INFERABLE_DEPENDS_ON` | frozen | Detects feature dependencies that the import graph can infer but the spec omits. | 추론 가능한 의존성 누락 탐지 |
| `HOST_CLAIM_DRIFT` | frozen | Detects host capability claims that diverge from actual host integration. | 호스트 주장 표류 탐지 |

## Naming conventions (enforced by review; see docs/code-style.md)

- **CLI verbs**: follow ecosystem precedent first (`check`/`done`/`doctor`/`status`); invent only when no convention exists.
- **Detector IDs**: `SCREAMING_SNAKE`, frozen at birth — name carefully before the first release that ships them.
- **Event types**: `snake_case`, past-tense or noun (`feature_created`, `gate_run`).
- **Functions**: `run*` = execute a stage/command, `render*` = produce output text, `detect*`/`resolve*`/`classify*` = pure computation, `record*` = append to logs, `wire*` = filesystem integration. No `perform*`/`auto*` variants.
- **Personas**: a common noun whose role is readable without context (`planner`, `developer`, `reviewer`).
- **Avoid**: `digest` for summaries (means cryptographic hash in this domain — use `changelog`/`notes`); `verify`-vs-`validate` mixing (validate = schema shape, verify = behavior).
