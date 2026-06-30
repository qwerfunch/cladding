<p align="center">
  <img src="docs/img/social-preview.png" alt="cladding — Unified Governance for AI-Coupled Engineering" width="920">
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>한국어</strong>
</p>

<h1 align="center">cladding</h1>

<p align="center">
  <strong>기업이 AI에게 코딩을 맡기려면 세 가지가 필요하다 —<br/>믿을 수 있고, 추적되고, 규모가 커져도 흔들리지 않아야 한다. cladding이 그 셋을 만든다.</strong><br/>
  cladding(외장재)이라는 이름 그대로, 호스트 LLM을 감싸 그 전과 후를 검증하는 층.
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen" alt="ironclad"/></a>
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/spec-v0.0.23-blue" alt="spec"/></a>
  <img src="https://img.shields.io/badge/tests-1665%2F1665-brightgreen" alt="tests"/>
  <img src="https://img.shields.io/badge/detectors-40-brightgreen" alt="detectors"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license"/></a>
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad">Ironclad</a> 표준의 공식 reference 구현.<br/>
  호스트 LLM(Claude Code · Codex · Gemini · Cursor)이 일을 <em>시작하기 전</em>에 프로젝트의 의도를 넣어 주고,<br/>
  일을 <em>마친 후</em>에 40개 검출기와 15단계 게이트로 결과를 검증한다. 같은 목표를 향한 분업이다.
</p>

<!-- ─────────────── 기업이 AI를 믿고 맡길 수 있는 이유 (직관 훅) ─────────────── -->

- **검증된 코드만 '완료'로 나간다** — AI가 "다 됐다"고 해도 검사를 통과해야 하니, 검증 못 한 코드는 '완료'로 인정되지 않는다.
- **누가·무엇을·왜 했는지 다 기록에 남는다** — 감사·규제 대응과 인수인계에 필요한 근거를 언제든 추적할 수 있다.
- **팀이 커지고 AI를 여러 개 붙여도 흔들리지 않는다** — 스펙이 공통 기준이라, 충돌과 표류를 자동으로 막는다.

<!-- ─────────────── 핵심 다이어그램: 호스트 LLM과의 협력 루프 ─────────────── -->

<div align="center">

<img src="docs/img/ko/relationship.svg" alt="호스트 LLM 전(의도 주입) · 후(검증) · 기록(피드백 루프) — cladding이 LLM을 감싸는 협력 구조" width="920">

</div>

> 이 루프가 노리는 것은 하나 —
> AI의 *"다 됐습니다"*를 말이 아니라 **증명**으로 만드는 것이다.

그래서 AI가 짠 코드를 **사람이 짠 코드만큼 믿고** 내보낼 수 있다.

cladding은 **자기 자신도 cladding으로 만든다** — 기능 199개 중 195개가 같은 게이트를 통과했고, Ironclad 표준을 L4로 구현한 첫 사례다.


## 호스트 LLM과 어떻게 함께 일하나

cladding은 코드를 쓰지 않는다. 코드를 쓰는 건 언제나 **호스트 LLM**이다. cladding이 맡는 건 그 *전*에 의도를 정확히 넣어 주고, 그 *후*에 결과를 기계적으로 검증하는 일이다.

#### 전 — 의도를 넣는다

*LLM이 올바른 컨텍스트로 시작하도록.*

- **프로젝트 지도 주입** — 시작할 때마다 기능·진행 상황·마지막 검증을 자동 전달 (이제 눈으로도 볼 수 있다 ↓)
- **필요한 의도만 추출** — 작업할 기능의 *왜*·관련 기능·검증 기준만 (전체 덤프 안 함)
- **프로젝트 규칙 적용** — 팀의 금지·선호 패턴을 매번 표준 지시로

#### 후 — 결과를 검증한다

*LLM의 산출물이 스펙과 어긋나면 차단.*

- **15단계 검증 관문** — 타입·린트·테스트·커버리지·아키텍처·시크릿을 한 번에
- **40가지 어긋남 검사** — 스펙↔코드↔테스트가 맞는지 모든 방향 자동 대조
- **구현 못 보는 채점자** — 코드 못 읽는 에이전트가 스펙만 보고 채점
- **실행물 직접 구동** — "테스트는 통과인데 안 도는" 걸 실제 실행으로 차단

#### 기록 — 다음 턴의 입력

*검증 결과가 다시 LLM의 컨텍스트로.*

- **검증 서명** — 통과한 코드에 "이 시점에 검증됨" 서명이 저장소에 남는다
- **감사 장부** — 모든 검증·완료 시도·차단이 누가·언제·결과까지 기록된다
- **수리 카드** — 실패를 남긴 채 끝내려 하면 한 번 막고, 요약을 다음 대화로 넘긴다

이 루프가 도는 동안 사용자는 **평소처럼 자연어로 개발**하면 된다.

<sub>실시간 개입(지도 주입 · 즉시 차단 · 종료 차단)은 Claude Code에서 전부 동작한다. Codex · Gemini · Cursor에서는 같은 검증을 대화 속 도구 호출과 git · CI 관문으로 수행한다.</sub>


## done은 선언이 아니라 획득이다

AI 코딩의 고질병은 *"다 됐습니다"* 가 검증 없이 선언되는 것이다. cladding에서 feature의 `status: done`은 쓰는 값이 아니라 **얻는 값**이다.

<div align="center">

<img src="docs/img/ko/intervention.svg" alt="한 장면 — LLM의 done 선언을 훅이 차단하고, 게이트 RED가 수리 카드로 피드백되고, GREEN일 때만 done이 획득되는 과정" width="920">

</div>

① AI가 완료 표시를 *직접 써넣으려* 하면 → **그 자리에서 차단**된다 ("완료는 검증으로 얻으세요")

② AI가 완료를 *요청*하면 → 결정적 9단계를 전부 돌려 **모두 통과할 때만** 완료로 기록, 하나라도 실패면 자동 되돌림 — E2E · 증거 단계는 CI의 전체 15단계가 맡는다

③ 통과와 동시에 **검증 서명**이 남는다 — "이 코드가 이 시점에 검증됐다"는 커밋 가능한 증거

④ 실패를 남긴 채 대화를 끝내려 하면 → **한 번 막아서고**(같은 실패로 또 끝내면 통과시키는 대신 기록) 수리 카드를 다음 대화로 넘긴다

<sub>한계도 그대로 공개한다: 즉시 차단이 못 보는 우회 경로가 존재하며, 그 경우는 사후 검증(관문 · 어긋남 검사)이 잡는다. 즉시 차단이 1차 방어선, 사후 검증이 2차 방어선이고 어느 쪽도 단독 보증이 아니다.</sub>


## 무엇이 달라지나

같은 상황에서 *일반 AI 코딩 환경*과 cladding 환경의 동작 차이.

| 상황 | 일반 AI 코딩 | cladding |
|---|:---|:---|
| **코드가 spec과 어긋날 때** | 리뷰에서 *발견하면* 수정 | 편집 직후 자동 감지(알림) · 어긋난 채로는 "완료"가 통과 못 함 |
| **AI가 "다 됐다"고 할 때** | 말을 믿는 수밖에 | 게이트 GREEN일 때만 done 획득 |
| **세션을 실패 상태로 끝낼 때** | 그대로 종료, 다음에 잊힘 | 종료를 한 번 막고 수리 카드 인계 |
| **두 명이 동시에 feature 추가** | merge conflict | hash-8 ID · 파일 분리 → 충돌 0 |
| **AI가 짠 코드를 누가 검증?** | 작성한 AI가 자기 검증 (위험) | 구현을 못 보는 채점자 + 기계 관문 |
| **AI 도구를 바꿀 때** | 도구마다 재구성 | 1 spec → 4 host 자동 연결 |


## 프로젝트 지도 — 이제 눈으로 보고 물어본다 <sub>신규</sub>

cladding은 스펙 · 코드 · 테스트 · 문서를 잇는 **지도**를 늘 안에서 그려 둔다. 이제 그 지도를 직접 눈으로 볼 수 있다.

> **왜 특별한가 — 설명과 코드가 따로 놀지 않는다.**
>
> 문서는 시간이 지나면 거짓말을 한다 — 코드는 바뀌는데 설명은 그대로니까. cladding은 그 연결을 코드를 볼 때마다 다시 맞추고, 어긋난 채로는 '완료'를 막는다.

cladding이 당신의 프로젝트를 보는 **머릿속 지도**다 — 가운데 밝게 빛나는 파랑이 스펙, 둘레의 주황이 코드, 바깥의 초록이 테스트, 분홍이 문서. 연결이 많을수록 크고 가운데로 모인다.

<div align="center">

![cladding 지식 그래프 — 스펙 · 코드 · 테스트 · 문서가 색으로 구분되어 연결된 그래프(움직이는 화면)](docs/img/ko/graph.gif)

</div>

- **본다** — *프로젝트 전체를 한 장으로* — `clad graph serve` 하면 브라우저에 떠서, 뭐가 뭐랑 연결됐는지 한눈에 보인다.
- **물어본다** — *"이거 고치면 뭐가 깨지지?"* — 지도에 물어보면 영향받는 곳과 돌려야 할 테스트가 나온다 — 추측하지 않는다.
- **재본다** — *프로젝트가 클수록 더 빛난다* — 고칠 때 봐야 할 양이 확 준다 — 전부 읽는 것보다 평균 **4배 적게**. 코드가 쌓여도 그 양은 거의 그대로라, 규모가 클수록 차이가 벌어진다. (`clad measure`)

직접 띄워 보려면 — 프로젝트 폴더에서:

```bash
clad graph serve                                  # 라이브 그래프 — localhost:3000, 저장하면 자동 새로고침
clad graph export --format html --out graph.html  # 또는 오프라인 한 파일(.html)로 내보내기
```

<sub>serve는 spec · 문서를 고칠 때마다 화면이 알아서 갱신된다 · export는 서버 · 의존성 없이 브라우저로 바로 여는 단일 파일이다.</sub>


## How it works

**Spec → Code → Tests** 가 한 cycle로 순환한다 — spec이 *왜*를 기록하고, 게이트가 검증하고, detector가 어긋남을 차단한다.

<div align="center">

<img src="docs/img/ko/cycle.svg" alt="Spec → Code → Tests 순환 — 15단계 검증과 40 drift detector가 cycle을 지킨다" width="700">

</div>

### 1. Spec — 모든 것의 기준 (SSoT)

spec이 *왜*(무엇을 왜 만드는지)를 기록한다. 4계층 기준 체계 (SSoT) — *의도가 위, 구현물이 아래, 코드가 스펙을 따른다*.

| Tier | 역할 | 정의 · 작성 | 권위 |
|---|---|---|---|
| **A — Spec** | 의도 (무엇을 · 왜) | 사람이 의도 정의 → AI가 EARS로 작성 | 사람 승인 없이 안 바뀜 · 최우선 |
| **B — Design** | 설계 (어떻게) | 사람이 방향 → AI가 작성 | A와 일치 검증 |
| **C — Derived** | 구현물 (코드 · 테스트) + **attestation** (검증 서명) | AI가 작성 | 코드 보고 자동 재생성 |
| **D — Audit** | 감사 기록 (무엇이 일어났나) | 자동 기록 (append-only) | 수정 불가 |

**A가 아래 모든 tier보다 우선** — spec(A)과 코드(C)가 다르면 틀린 쪽은 *코드*다. 의도(A)가 흔들리면 모든 게 흔들리므로 LLM이 못 건드리게 봉인한다.

**샤딩 · multi-dev 안전** — `spec/features/<slug>-<hash>.yaml` 처럼 *feature마다 별도 파일* + *8자리 hash ID* (예: `F-d86375d8`). 두 명이 동시에 새 feature를 만들어도 *다른 파일 · 다른 ID* 라 merge conflict 0. 자세히는 [Hash-based feature IDs](docs/spec-ids-multi-dev.md).

<div align="center">

<img src="docs/img/ko/ssot-tier.svg" alt="4-tier SSoT — A(Spec) → B(Design) → C(Derived + attestation) → D(Audit), A가 B보다 우선" width="640">

</div>

### 2. Gate — 15단계 Iron Law

"완료"로 인정받으려면 strict 게이트(15단계 중 결정적 9단계)를 전부 통과해야 하고, E2E · 증거까지 포함한 전체 15단계는 CI가 돌린다. 같은 검사 엔진을 시점별 묶음으로 건다 — commit 때 빠른 3단계(git hook 설치 시), push · 완료 시점에 9단계, CI에서 15단계 전부. 깊이가 다를 뿐 검사 로직은 동일하다.

<div align="center">

<img src="docs/img/ko/iron-law.svg" alt="15단계 Iron Law 게이트 — 정적(6) · 테스트·적합성(4) · E2E(3) · 증거(2), GREEN이면 attestation 서명" width="640">

</div>

| Stage | 무엇을 검사하나 |
|---|---|
| **1.1 Type · 1.2 Lint** | 타입 오류 · 코드 스타일 |
| **1.3 Drift** | 40 detector의 spec ↔ 코드 어긋남 |
| **1.4 Commit · 1.5 Arch · 1.6 Secret** | 작업트리 clean · architecture invariant · API 키 노출 |
| **2.1 Unit · 2.2 Coverage** | 단위 테스트 통과 · coverage 하락 차단 |
| **2.3 Spec conformance · 2.4 Deliverable smoke** | 구현을 못 본 채점자의 테스트 통과 · 선언된 실행물이 실제로 도는지 *("테스트는 통과인데 결과물은 안 도는" 빈 초록 차단)* |
| **3.1 Smoke · 3.2 Perf · 3.3 Visual** | e2e 핵심 동작 · 성능 예산 · UI 시각 회귀 |
| **4.1 Audit · 4.2 UAT** | 모든 AC(수용 기준)에 증거 1건 이상 · 모든 done feature에 증거 1건 이상 |

### 3. Detector — 40개 어긋남 검출기

spec · code · test 사이 모든 방향의 어긋남을 자동 검출한다. 전체 카탈로그: [detector catalog](src/stages/detectors/README.md).

| 방향 | 무엇을 잡나 | 수 | 대표 detector |
|---|---|---|---|
| spec ↔ code | spec에 있는데 코드에 없거나, 코드가 spec을 벗어남 | 10 | `MISSING_IMPLEMENTATION`, `AC_DRIFT`, `DELIVERABLE_INTEGRITY` |
| code ↔ test | 코드는 있는데 테스트 없음 · 커버리지 하락 · 시크릿 | 6 | `MISSING_TESTS`, `COVERAGE_DROP`, `HARDCODED_SECRET` |
| spec ↔ test | spec의 AC가 테스트로 검증 안 됨 · 상태 거짓 | 6 | `UNTESTED_AC`, `STATUS_DRIFT`, `SPEC_CONFORMANCE` |
| spec 위생 | spec 자체의 무결성 (ID 충돌 · 순환 의존) | 8 | `ID_COLLISION`, `SLUG_CONFLICT`, `DEPENDENCY_CYCLE` |
| 환경 무결성 | 빌드 환경 · 메타 파일 | 3 | `HARNESS_INTEGRITY`, `META_INTEGRITY` |
| 검증 신선도 | 검증 서명 이후 코드가 바뀌었는지 | 1 | `STALE_ATTESTATION` *(신규)* |
| 거버넌스 · 문서 | 정책 위반 · 문서 표류 | 3 | `ABSENCE_OF_GOVERNANCE`, `PROJECT_CONTEXT_DRIFT` |
| 그래프 · 문서 연결 | 문서↔스펙 링크 끊김 · 의존 엣지 누락 | 3 | `DOC_LINK_INTEGRITY`, `REFERENCE_INTEGRITY`, `INFERABLE_DEPENDS_ON` *(신규)* |

### 4. Cycle — 한 feature의 생애주기

정의 → 동기화 → 구현 → **획득**. 모든 검사를 통과해야 "완료"를 얻는다.

<div align="center">

<img src="docs/img/ko/workflow.svg" alt="한 feature의 생애주기 — 정의 → 동기화 → 구현 → 획득, 검사를 모두 통과하면 완료 획득 / 실패면 자동 되돌림" width="760">

</div>


## Multi-Agent — 만드는 자와 검증하는 자의 분리

**만드는** 에이전트와 **검증하는** 에이전트가 분리돼 있어 어떤 에이전트도 자기 작업을 스스로 승인하지 못한다. **blind-author**는 한 발 더 나간다 — 테스트를 쓰는 에이전트에게 *구현을 읽을 도구 자체가 없다*(Read/Grep 미부여). "구현 안 보고 썼다"가 약속이 아니라 구조적 사실이 된다. 이 분리는 규제 · 감사(EU AI Act · SOX)가 요구하는 직무 분리 원칙과 맞닿아 있다.

<div align="center">

<img src="docs/img/ko/multi-agent.svg" alt="에이전트 역할 분리 — orchestrator가 분배, planner/developer/reviewer가 작업, blind-author는 구현을 못 보는 테스트 작성자, observability가 관찰" width="700">

</div>


## Ecosystem

기존 세 카테고리의 결합부에 cladding이 있다.

<div align="center">

<img src="docs/img/ko/ecosystem.svg" alt="Ecosystem Venn — SDD · 실행기 · Multi-agent 거버넌스 세 카테고리의 결합부에 cladding" width="640">

</div>

### 인접 도구와의 차이

- **Spec Kit · OpenSpec · Tessl · Kiro** — *spec을 잘 쓰게* 도와주는 도구. cladding은 거기에 더해 *그 spec과 실제 코드가 어긋나지 않는지 개발 루프 안에서 계속 자동 대조*한다 — 완료 시점 · commit · CI까지.
- **BMAD · ChatDev · Claude Code Agent Teams** — *여러 AI 에이전트의 역할 분담* 시스템. cladding의 에이전트 분업은 그 위에 *spec · 게이트 · 감사 기록*까지 결합해 동작한다.
- **tdd-guard** — *AI가 테스트를 먼저 쓰도록 강제*하는 도구. cladding의 15단계 중 Unit · Coverage · oracle 단계가 같은 일을 더 구조적으로 한다.
- **OpenHands · Cline · Aider · Goose** — *AI에게 코드를 짜게 시키는 실행기*. cladding은 그 실행기가 짠 코드를 *검증 · 통제하는 상위 레이어*다.

cladding의 차별점은 *결합* — 위 카테고리의 핵심을 *하나의 검증 루프*로 묶는 것.


## Install

두 단계 — 인프라 설치 → 프로젝트 spec 생성.

### 1단계 — 인프라 설치 (npm)

```bash
npm install -g cladding   # cladding CLI 설치
cd <project>              # 프로젝트로 이동
clad setup                # AI 도구 자동 연결 (Claude / Codex / Gemini / Cursor)
```

`clad setup` 한 번이면 설치된 AI 도구들을 자동 감지해 전부 연결한다 — 도구별 설정을 따로 할 필요가 없다.

<details>
<summary><code>clad setup</code> 이 연결하는 위치 (4개 host · 5개 연결 지점)</summary>

| 호스트 (감지 시) | wire 위치 | 자동 활성화 |
|---|---|---|
| Claude Code (`~/.claude/`) | `~/.claude/plugins/cladding` | `claude plugin marketplace add` + `install` |
| Codex CLI skills (`~/.agents/`) | `~/.agents/skills/cladding-*` | (Codex 재시작 시 자동) |
| Codex CLI MCP 서버 (`~/.codex/`) | `~/.codex/config.toml` 의 `[mcp_servers.cladding]` | (TOML entry 자체) |
| Gemini CLI (`~/.gemini/`) | `~/.gemini/extensions/cladding` | `gemini extensions link` |
| Cursor (`~/.cursor/`) | `~/.cursor/mcp.json` 의 `mcpServers.cladding` | (JSON entry 자체) |

`clad setup` 은 `claude` / `gemini` binary 가 PATH 에 있을 때 각 host 의 활성화 명령을 자동 호출. 업그레이드 후나 새 AI 도구 설치 후 다시 실행해도 안전하다.

**검증 수준(정직 고지):** Claude Code는 실사용 캠페인으로 전 기능 검증됨(실시간 개입 포함). Codex · Gemini CLI는 배선 자동화 + 기본 동작 확인. Cursor는 연결은 자동이지만 실사용 검증이 아직이다 — 검증되는 대로 갱신.

> **MCP 서버에 대하여.** 4 host 모두 cladding을 MCP 서버로 wire한다 — wire *위치*만 다르다. MCP는 사용자가 직접 호출하는 것이 아니다 — `/mcp` 슬래시도, 수동 연결 단계도 없다. 각 host의 AI가 *자연어 요청*에 응답해 cladding의 기능을 알아서 호출하며, 사용자는 `/cladding:init` 한 번과 일반 대화만 입력한다.

</details>

### 2단계 — Init (프로젝트 spec 생성)

프로젝트 디렉토리에서, AI 도구 안에서 한 번 호출:

```
[AI 도구 안] /cladding:init "B2B 결제 SaaS"
```

프로젝트의 `spec.yaml` 과 관련 문서가 만들어진다 — 프로젝트당 한 번.

강제력을 높이려면: `clad init --with-hook`(pre-commit + pre-push git hook 설치) · `clad init --with-ci`(CI 게이트 스캐폴드 — 진짜 강제는 CI에서).

### 세 가지 init 시나리오

| 시작 상황 | 명령 | 무엇이 일어나는가 |
|---|---|---|
| **아이디어만 있을 때** | `/cladding:init "B2B 결제 SaaS 만들거야"` | LLM이 도메인 분석 → spec · 문서 · 정책 자동 생성 + 후속 질문 2–3개 |
| **기획 문서가 있을 때** | `/cladding:init docs/plan.md` | 파일 경로 인식 → 내용을 자동 로드해 intent로 사용 |
| **기존 프로젝트 도입** | `/cladding:init "이 프로젝트에 cladding 적용해줘"` | 기존 코드 자동 스캔 → 관찰한 패턴 + intent 결합 |

### init 한 번이면 끝

한 번 init하면 그걸로 끝 — 그 뒤론 평소처럼 개발하면 된다. cladding이 배경에서 전 · 후 루프를 돌리니, 따로 외울 명령은 없다.

### 업그레이드

```
npm update -g cladding     # 1. 새 버전 설치
cd <your project>          # 2. 프로젝트마다 한 번씩
clad update                # 3. 새 버전에 맞게 정리
```

당신이 쓴 코드 · `spec.yaml` · 문서는 그대로 두니 안전하고, 새 버전이 더 깐깐해 짚을 게 있으면 **알려만** 준다 (막거나 고치지 않음).


## Status

| version | 준수 등급 | tests | gate | features |
|---|---|---|---|---|
| v0.7.0 · 2026-07 | L4 · [L0–L4 중 최고 · 자가 선언](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md) | 1665 / 1665 · all pass | 15 단계 · 40 detectors | 199 · 195 done · 자기 스펙 |

<sub>170 test files · capability 6개 · coverage는 COVERAGE_DROP detector가 하락 차단 · 설치는 npm 단일 경로(<code>npm install -g cladding</code>)</sub>

> **Ironclad 1.0까지의 길** — 1.0은 *독립적인 두 개의 구현이 L4 검증 셋을 통과해야* 잠긴다 ([GOVERNANCE § 1](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md)). cladding이 첫 번째.


## Docs

- [Why cladding (project context)](docs/project-context.md)
- [4-tier governance model](docs/ssot-model.md)
- [Hash-based feature ID](docs/spec-ids-multi-dev.md)
- [40 detector catalog](src/stages/detectors/README.md)
- [용어집 (EN · KO)](docs/glossary.md)
- [Governance · roadmap to 1.0](GOVERNANCE.md)


## License

MIT. [LICENSE](LICENSE) · 관련: [Ironclad](https://github.com/qwerfunch/ironclad) (구현 대상 표준) · [harness-boot](https://github.com/qwerfunch/harness-boot) (seed).
