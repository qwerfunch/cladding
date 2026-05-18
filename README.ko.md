# cladding

> 코드를 *iron-clad* (철갑)으로 만드는 도구.
> [Ironclad](https://github.com/qwerfunch/ironclad) 표준의 reference implementation.

[![ironclad](https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding 는 Claude Code 용 멀티 에이전트 개발 하네스이자 Ironclad 표준 — *spec · code · tests* 간의 *등급 매겨지고 반증 가능한 정합성* 표준 — 의 reference implementation 입니다. harness-boot 의 후계 프로젝트로, harness-boot 가 *아이디어를 증명*했다면 Cladding 은 *그것을 출시*합니다.

## 상태

**Ironclad L4 conformant (L21) · self-spec sharded (L21.8).** Cladding 은 Ironclad 의 전체 표면을 구현합니다 — 13 개 Iron Law stage (L1 Type / Lint / Drift / Commit / Arch / Secret · L2 Unit / Cov · L3 Smoke / Perf / Visual · L4 Audit / UAT), 19/19 drift detector, EARS 구문 검증기, HITL 인프라 (identity · audit · anti-self-cert), 5 개 agent persona, 9 개 언어 polyglot toolchain, Intent Router, clad CLI, Token Optimizer (cladding 자체 spec 에서 87.9% 컨텍스트 감소 실측), conformance fixture 26/26 일치. Cladding 자체 spec 은 이제 sharded 됨 (`spec/features/F-NNN.yaml` × 47, `spec/scenarios/S-NNN.yaml` × 2, `spec/architecture.yaml`) — 외부 채택자가 spec 이 단일 파일을 넘으면 동일 layout 사용.

각 Level 은 검증 가능한 capability 를 더합니다:

| Level | Capability | 상태 |
|---|---|---|
| L1 (Base Static) | Type · Lint · Drift · Commit · Arch · Secret | ✓ |
| L2 (Mocked Logic) | Unit · Cov | ✓ |
| L3 (Full Empirical) | Smoke · Perf · Visual | ✓ |
| L4 (HITL) | Audit · UAT — *anti-self-cert guard* | ✓ |
| 19 Drift detectors | UNMAPPED_ARTIFACT · MISSING_IMPLEMENTATION · AC_DRIFT · TECH_STACK · ARCH_VIOLATION · CONVENTION_DRIFT · MISSING_TESTS · STALE_TESTS · COVERAGE_DROP · EVIDENCE_MISMATCH · HARDCODED_SECRET · PERFORMANCE_DRIFT · UNTESTED_AC · STATUS_DRIFT · STALE_EVIDENCE · STALE_SPECIFICATION · HARNESS_INTEGRITY · REFERENCE_INTEGRITY · META_INTEGRITY | ✓ |
| EARS 구문 검증 | 5 패턴 (ubiquitous · event · state · optional · unwanted) | ✓ |

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

## CLI

```
clad init [--name N] [--force]  # cladding workspace scaffold (spec.yaml seed · .cladding/ · .gitignore)
clad work <verb>         # stage 또는 자연어 의도 실행
clad drive [목표]         # autonomous loop (v0.2 — placeholder)
clad sync                # spec.yaml 을 schema 에 대해 검증
clad check               # 모든 Iron Law stage + drift 검사 실행
clad minimap             # feature × stage Territory Minimap 렌더링
clad route <프롬프트>     # 자연어 프롬프트를 verb 로 분류
clad benchmark <feature> # naive vs optimized spec token 비용
```

설치 후 `clad` binary 는 `package.json` 의 `bin` 필드를 통해 `PATH` 에 노출됩니다. 개발 시 `bin/clad` shim 이 tsx 를 통해 `cli/clad.ts` 를 호출합니다.

## 용어

- **`ironclad`** — 표준 (합의된 결과 상태)
- **`cladding`** — 이 프로젝트 (구현체, 도구)
- **`clad`** — CLI 동사 (행위)

## 5 개 Agent 페르소나

Cladding 은 5 개의 Claude Code subagent 로 작업을 조정합니다 (`agents/*.md` 참고):

| persona | 역할 | tools |
|---|---|---|
| `orchestrator` | 워크플로 지휘자; 의도를 specialist 로 라우팅 | Read, Write, Edit, Bash, Agent |
| `librarian` | SSoT 수호자; spec.yaml + EARS 위생 | Read, Write, Edit, Bash |
| `reviewer` | 철학적 가드레일; 독립 audit (read-only) | Read, Bash |
| `observability` | 로그 + metric 분석 | Read, Bash |
| `specialists` | 도메인 구현자 (코드 · 테스트 · 마이그레이션) | Read, Write, Edit, Bash |

**5 개 호출 원칙** (`agents/orchestrator.md`):

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
