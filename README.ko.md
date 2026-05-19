# cladding

> 코드를 *iron-clad* (철갑)으로 만드는 도구.
> [Ironclad](https://github.com/qwerfunch/ironclad) 표준의 reference implementation.

[![ironclad](https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding 는 Claude Code 용 멀티 에이전트 개발 하네스이자 Ironclad 표준 — *spec · code · tests* 간의 *등급 매겨지고 반증 가능한 정합성* 표준 — 의 reference implementation 입니다. harness-boot 의 후계 프로젝트로, harness-boot 가 *아이디어를 증명*했다면 Cladding 은 *그것을 출시*합니다.

> AI 도구 안내 (Claude Code · OpenAI Codex · Cursor · Cline · Aider · Continue · Copilot · Gemini CLI · …): cross-tool 진입점은 [`AGENTS.md`](AGENTS.md) 에 있습니다.

## 설치

```
npm install -g cladding
```

설치 후 어느 프로젝트 디렉터리에서든:

```
clad init     # cladding 워크스페이스 scaffold
clad check    # 모든 Iron Law stage + drift 검사
clad panel    # feature × stage Integrity Panel
```

Claude Code · OpenAI Codex CLI · Google Gemini CLI · Cursor · Cline · Continue · 그 외 [`AGENTS.md`](AGENTS.md) 를 읽는 모든 도구 안에서 동일한 명령 사용. Node ≥ 20 필요.

## 상태

**Ironclad L4 conformant (L21) · self-spec sharded (L21.8) · v0.2.18 ships at 404/404 tests · line coverage 93.89% (whole-codebase scope) · 모든 source dir ≥ 90% · MISSING_TESTS 기본 error 격상 · 통제된 벤치마크 docs/benchmarks/ 수록.** Cladding 은 Ironclad 의 전체 표면을 구현합니다 — 13 개 Iron Law stage (L1 Type / Lint / Drift / Commit / Arch / Secret · L2 Unit / Cov · L3 Smoke / Perf / Visual · L4 Audit / UAT) 전부 dedicated unit test 보유 (stage chapter closed v0.2.12) + **20 개 drift detector** (3 always-error + 16 conditional + 1 cladding extension `FIXTURE_REFERENCE_INVALID`) 전부 100% line coverage (detector chapter closed v0.2.9), severity matrix 는 [`src/stages/detectors/README.md`](src/stages/detectors/README.md), EARS 구문 검증기, HITL 인프라 (identity · audit · anti-self-cert), 5 개 agent persona, 9 개 언어 polyglot toolchain, Intent Router, clad CLI, Token Optimizer (cladding 자체 spec 에서 87.9% 컨텍스트 감소 실측), conformance fixture 33/33 일치 (26 baseline + 7 documentary→runnable 승격). Cladding 자체 spec 은 sharded 상태 (`spec/features/F-NNN.yaml` × 66, `spec/scenarios/S-NNN.yaml` × 2, `spec/architecture.yaml`) — 외부 채택자가 spec 이 단일 파일을 넘으면 동일 layout 사용.

각 Level 은 검증 가능한 capability 를 더합니다:

| Level | Capability | 상태 |
|---|---|---|
| L1 (Base Static) | Type · Lint · Drift · Commit · Arch · Secret | ✓ |
| L2 (Mocked Logic) | Unit · Cov | ✓ |
| L3 (Full Empirical) | Smoke · Perf · Visual | ✓ |
| L4 (HITL) | Audit · UAT — *anti-self-cert guard* | ✓ |
| 19 Drift detectors | UNMAPPED_ARTIFACT · MISSING_IMPLEMENTATION · AC_DRIFT · TECH_STACK · ARCH_VIOLATION · CONVENTION_DRIFT · MISSING_TESTS · STALE_TESTS · COVERAGE_DROP · EVIDENCE_MISMATCH · HARDCODED_SECRET · PERFORMANCE_DRIFT · UNTESTED_AC · STATUS_DRIFT · STALE_EVIDENCE · STALE_SPECIFICATION · HARNESS_INTEGRITY · REFERENCE_INTEGRITY · META_INTEGRITY | ✓ |
| EARS 구문 검증 | 5 패턴 (ubiquitous · event · state · optional · unwanted) | ✓ |

## 증거 (Evidence)

cladding 의 헤드라인 주장 — **EARS-locked sharded spec 이 엣지 케이스를 가정이 아닌 코드로 강제한다** — 은 통제된 A/B/C 벤치마크로 뒷받침됩니다. 문서: [`docs/benchmarks/event-store-trap-catch.md`](docs/benchmarks/event-store-trap-catch.md).

같은 이벤트 소싱 store 를 세 번 구현 — vanilla Claude Code · harness-boot 의 gate 사이클 · cladding 의 EARS-locked spec. spec 에는 **22 개 정상 AC + 8 개 의도적 모호점 ("trap")** 이 박혀 있고 trap 은 명시적으로 pin 하지 않습니다. 8 trap 결과:

| variant | 코드에서 catch | 문서 포함 cover | silent gap |
|---|---|---|---|
| vanilla | 2/8 (25%) 우연 | 2/8 | **6 silent** |
| harness-boot | 2/8 (vanilla 와 같은 코드) | 7/8 문서화 | 1 silent |
| **cladding** | **8/8 (100%) 명시** | **8/8** | **0** |

cladding 의 각 trap 은 EARS `unwanted` / `state` AC 로 first-class 가 되어 구현이 만족해야만 함 (참고: [`event-store-spec-with-traps.md`](docs/benchmarks/event-store-spec-with-traps.md)). **vanilla 대비 +50% source LOC 가 zero silent 엣지 를 구입.** 전체 방법론, trap-by-trap 매트릭스, 8축 비교는 링크된 문서 참조.

## 상태 & 로드맵

**v0.1.0 — 출시 범위와 유보 사항.** Cladding 은 Ironclad 의 **장비 (machinery)** 일체를 오늘 시점에 출시합니다 — 13 개 Iron Law stage, 19 개 drift detector, EARS 검증기, HITL 가드, agent persona 정의, conformance fixture, CLI 표면. 두 가지 범위 유보는 명시적으로 추적됩니다:

| Capability | v0.1.0 상태 | v0.2.0 에픽 |
|---|---|---|
| `clad drive` 자율 루프 | **결정론적 floor** — 준비된 feature 를 의존성 순으로 순회하고, 모듈 스텁을 생성하며, L1 gate (`type` · `lint` · `arch`) 를 실행. LLM 호출 없음. [F-048](spec/features/F-048.yaml) AC-083 참조. | [F-049](spec/features/F-049.yaml) — 5 개 agent persona 를 호출하고, 런타임에 reviewer ≠ author 를 강제하며, `HUMAN_REQUIRED` / `LLM_UNAVAILABLE` halt 클래스를 연결. |
| 실행 중 Iron Law L4 | Conformance fixture 26/26 + Cladding 자체 audit log 위 human signoff 가 **L4 machinery** 의 정확성을 증명. | F-049 가 먼저 안착해야 LLM 이 작성한 구현을 L4 machinery 가 잡아내는 시연이 가능. |
| Agent persona 오케스트레이션 | 5 개 subagent prompt 가 `src/agents/*.md` 에 출시됨. | `src/drive/loop.ts` 에서 런타임 dispatch (F-049 의 일부). |

Ironclad 표준의 v1.0 졸업은 L1–L4 fixture 를 통과하는 **독립 reference 구현 2 개**를 요구합니다 ([Ironclad GOVERNANCE](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md) §1). Cladding 의 fixture 수준 conformance 는 오늘 시점에 그 기준을 향해 카운트됩니다; "LLM 작성을 L4 가 실행 중 포착" 이라는 질적 주장은 별도의 v0.2.0 마일스톤입니다.

## Spec 참조

Cladding 은 Ironclad 표준을 구현합니다. 이 코드베이스가 대상으로 하는 정확한 spec 버전은 `.claude-plugin/plugin.json` 에 고정되어 있습니다:

```json
"ironclad": {
  "spec-version": "0.0.23",
  "spec-tag": "v0.0.23",
  "spec-commit": "883ff01d0360b7c989fe16214c69a324f049c8cd",
  "spec-url": "https://github.com/qwerfunch/ironclad"
}
```

Ironclad spec 이 진보하면 이 pin 은 *명시적 sync 단계* 로 갱신됩니다 (auto-follow 아님) — [`GOVERNANCE.md`](GOVERNANCE.md) §1 의 5 단계 sync 절차 참고.

### Spec 레이아웃 (sharded)

Cladding 자체 spec 은 sharded 형태 — feature 당 yaml 파일 1 개:

| 위치 | 내용 |
|---|---|
| `spec.yaml` | master · `schema` + `project` 메타데이터만 |
| `spec/features/F-NNN.yaml` | feature 당 1 파일 (총 47) |
| `spec/scenarios/S-NNN.yaml` | scenario 당 1 파일 (총 2) |
| `spec/architecture.yaml` | layer + forbidden-imports 정책 |
| `src/spec/schema.json` | JSON Schema (draft-07) |

`src/spec/load.ts` 가 이 레이아웃을 자동 감지해 매 load 시 하나의 Spec 객체로 merge. merged view 확인:

| 의도 | 명령 |
|---|---|
| merged spec 검증 | `npm run spec:validate` |
| feature + 의존성 (JSON) | `clad benchmark F-NNN` |
| 한 눈에 coverage | `clad panel` |
| raw dump | `cat spec/features/*.yaml` |

Inline (단일 `spec.yaml`) 레이아웃도 동작 — `src/spec/load.ts` 가 자동 fallback. 새 프로젝트는 unsharded 로 시작; `scripts/shard-spec.ts` 가 master 가 ~1k 줄 넘으면 마이그레이션.

## CLI

```
clad init [--name N] [--force]  # cladding workspace scaffold (spec.yaml seed · .cladding/ · .gitignore)
clad work <verb>         # stage 또는 자연어 의도 실행
clad drive [목표]         # autonomous loop — 결정론적 floor; LLM dispatch 는 v0.2 의 F-049 에서
clad sync                # spec.yaml 을 schema 에 대해 검증
clad check               # 모든 Iron Law stage + drift 검사 실행
clad panel               # feature × stage Integrity Panel 렌더링
clad route <프롬프트>     # 자연어 프롬프트를 verb 로 분류
clad benchmark <feature> # naive vs optimized spec token 비용
```

설치 후 `clad` binary 는 `package.json` 의 `bin` 필드를 통해 `PATH` 에 노출됩니다. 개발 시 `bin/clad` shim 이 tsx 를 통해 `src/cli/clad.ts` 를 호출합니다.

## 용어

- **`ironclad`** — 표준 (합의된 결과 상태)
- **`cladding`** — 이 프로젝트 (구현체, 도구)
- **`clad`** — CLI 동사 (행위)

## 5 개 Agent 페르소나

Cladding 은 5 개의 Claude Code subagent 로 작업을 조정합니다 (`src/agents/*.md` 참고):

| persona | 역할 | tools |
|---|---|---|
| `orchestrator` | 워크플로 지휘자; 의도를 specialist 로 라우팅 | Read, Write, Edit, Bash, Agent |
| `librarian` | SSoT 수호자; spec.yaml + EARS 위생 | Read, Write, Edit, Bash |
| `reviewer` | 철학적 가드레일; 독립 audit (read-only) | Read, Bash |
| `observability` | 로그 + metric 분석 | Read, Bash |
| `specialists` | 도메인 구현자 (코드 · 테스트 · 마이그레이션) | Read, Write, Edit, Bash |

**5 개 호출 원칙** (`src/agents/orchestrator.md`):

1. **Specialization** — 가장 좁은 agent 선택
2. **Audit separation** — 구현자 ≠ 검증자
3. **Parallelism** — write set 겹치지 않으면 병렬 dispatch
4. **Evidence-first** — 이전 stage evidence 없으면 stage 진행 거부
5. **Least context** — 태그된 가드레일 + 관련 모듈만 전달 (전체 spec X)

## License

MIT — [LICENSE](LICENSE).

## 관련 프로젝트

- [Ironclad](https://github.com/qwerfunch/ironclad) — 본 프로젝트가 구현하는 표준
- [harness-boot](https://github.com/qwerfunch/harness-boot) — seed 프로젝트 (역사 참조)
