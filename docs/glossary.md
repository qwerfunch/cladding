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

## CLI verbs (alias-and-deprecate bucket)

| Verb | State | Meaning | KO |
|---|---|---|---|
| `init` | stable | Scaffold a cladding workspace (intent-aware onboarding). | 작업공간 생성 |
| `sync` | stable | Validate spec + refresh generated state (inventory, deliverable, index). | 스펙 동기화 |
| `check` | stable | Run the Iron Law stages; `--tier`, `--strict`, `--json`. | 게이트 검사 |
| `done` | stable | Gated completion flip: status→done only if the strict pre-push gate is GREEN. | 검증된 완료 처리 |
| `clarify` | stable (0.6.0) | Continue the onboarding Q&A (spec-kit `/clarify` precedent). | 온보딩 질의 진행 |
| `refine` | alias → `clarify` | Old name (no CLI precedent); removal in 0.7. | (구명) |
| `status` | stable (0.6.0) | Render the feature × stage integrity matrix (`git status` convention). | 상태 매트릭스 |
| `panel` | alias → `status` | Old name (no CLI precedent); removal in 0.7. | (구명) |
| `run` | stable (0.6.0) | Autonomous feature loop (EXPERIMENTAL; host-delegated path preferred). | 자율 루프 실행 |
| `drive` | alias → `run` | Old name (no CLI precedent); removal in 0.7. | (구명) |
| `work` | removed (0.6.0) | Was a permanently not-implemented reserved stub (always exit 2) — dishonest surface; `run` owns the slot. | (제거됨) |
| `serve` | stable | Start the MCP server over stdio. | MCP 서버 |
| `oracle` | stable | Print the impl-blind authoring brief for a feature/AC. | 오라클 브리프 |
| `setup` | stable | Wire cladding into installed AI hosts (Claude/Codex/Gemini/Cursor). | 호스트 연결 |
| `update` | stable | Post-upgrade reconciliation (re-wire, sync, report-only drift). | 업그레이드 정리 |
| `doctor` | stable | Diagnose dispatcher/telemetry health from the events log (brew/npm `doctor` convention). | 환경 진단 |
| `checkpoint` | stable | Record a feature checkpoint event (git HEAD + spec digest). | 체크포인트 기록 |
| `rollback` | stable | Record a rollback event + print the maintainer-runnable git command. | 롤백 기록 |
| `route` | stable | Classify a natural-language prompt to a verb (debug surface for the router). | 의도 분류 |

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

## Event types (frozen)

`stage_started` · `stage_completed` · `feature_activated` · `feature_completed` · `evidence_recorded` · `drift_detected` · `feature_checkpoint` · `feature_rolled_back` · `sentinel_miss`

Added 0.6.0 (F-b84c38 — payloads carry `identity` + `head`): `feature_created` (spec shard authored) · `scenario_created` · `done_attempted` (gated flip, kept or reverted) · `gate_run` (tier verification outcome; deduped per identical HEAD/tier/strict/worst).

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

## Naming conventions (enforced by review; see docs/code-style.md)

- **CLI verbs**: follow ecosystem precedent first (`check`/`done`/`doctor`/`status`); invent only when no convention exists.
- **Detector IDs**: `SCREAMING_SNAKE`, frozen at birth — name carefully before the first release that ships them.
- **Event types**: `snake_case`, past-tense or noun (`feature_created`, `gate_run`).
- **Functions**: `run*` = execute a stage/command, `render*` = produce output text, `detect*`/`resolve*`/`classify*` = pure computation, `record*` = append to logs, `wire*` = filesystem integration. No `perform*`/`auto*` variants.
- **Personas**: a common noun whose role is readable without context (`planner`, `developer`, `reviewer`).
- **Avoid**: `digest` for summaries (means cryptographic hash in this domain — use `changelog`/`notes`); `verify`-vs-`validate` mixing (validate = schema shape, verify = behavior).
