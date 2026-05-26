<h1 align="center">cladding</h1>

<p align="center">
  <strong>Unified Governance for AI-Coupled Engineering.</strong><br/>
  AI 가 짠 코드도 사람이 짠 코드만큼 검증되도록.
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen" alt="ironclad"/></a>
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/spec-v0.0.23-blue" alt="spec"/></a>
  <img src="https://img.shields.io/badge/tests-954%2F954-brightgreen" alt="tests"/>
  <img src="https://img.shields.io/badge/coverage-93.89%25%2B-brightgreen" alt="coverage"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license"/></a>
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad">Ironclad</a> 표준의 공식 reference 구현. AI 코딩 어시스턴트가 짠 코드가 spec 과 어긋나지 않는지 28 개의 검사기와 13 단계 검증 관문이 매 commit 마다 자동으로 대조한다.
</p>

<!-- ─────────────────────────── HERO ─────────────────────────── -->

<table align="center">
<tr>
<td style="text-align:center;width:320px;background:#f1f5f9;padding:32px 24px;border-radius:8px">
<div style="font-size:13px;color:#64748b;letter-spacing:1px;text-transform:uppercase">일반 (vanilla) AI 코딩</div>
<div style="font-size:64px;font-weight:700;color:#94a3b8;line-height:1;margin:12px 0">2/8</div>
<div style="font-size:13px;color:#64748b">함정 포착 · 25%</div>
</td>
<td style="text-align:center;width:320px;background:#dcfce7;padding:32px 24px;border-radius:8px">
<div style="font-size:13px;color:#15803d;letter-spacing:1px;text-transform:uppercase">cladding</div>
<div style="font-size:64px;font-weight:700;color:#16a34a;line-height:1;margin:12px 0">8/8</div>
<div style="font-size:13px;color:#15803d">함정 포착 · 100%</div>
</td>
</tr>
<tr><td colspan="2" align="center"><sub>같은 spec · 같은 모델로 측정 · <a href="docs/benchmarks/event-store-trap-catch.md">event-sourcing store 벤치마크</a></sub></td></tr>
</table>

## 왜 필요한가

<table>
<tr>
<td width="33%" valign="top">

**3개월 뒤 의도 추적 불가**

AI 가 짠 코드의 *왜* 가 코드만 봐서는 안 잡힌다.

→ `spec/features/*.yaml` 이 *왜* 의 영구 기록

✓ **AI 가 시간을 견딘다** — 6개월 뒤에도 AI 가 spec 보고 의도 즉시 파악 (신규 입사자도 같은 진입점)

</td>
<td width="33%" valign="top">

**AI 답이 매번 다름**

같은 spec 으로 짠 코드의 패턴과 구조가 일관성 없다.

→ spec 이 *고정 기준* 으로 각 commit 검증

✓ **엔터프라이즈 채택 가능** — 팀 · PR 간 코드 스타일 · 패턴 일관

</td>
<td width="33%" valign="top">

**AI hallucination**

존재하지 않는 API · 함수 · 옵션을 호출하는 코드 생성.

→ 28 detector + 13 단계 gate 가 매 commit 차단

✓ **production 사고 사전 차단** — CI 가 hallucination 코드를 자동 reject

</td>
</tr>
</table>

## 차이점

같은 문제 상황에서 *일반적인 (vanilla) AI 코딩 환경*과 cladding 환경이 어떻게 다르게 동작하는지.

<table>
<thead>
<tr><th align="left">상황</th><th align="center">일반 AI 코딩</th><th align="center">cladding</th></tr>
</thead>
<tbody>
<tr><td><strong>코드가 spec 과 어긋날 때</strong></td><td align="center" style="color:#64748b">review 에서 <em>발견하면</em> fix</td><td align="center"><strong style="color:#16a34a">매 commit 자동 차단</strong></td></tr>
<tr><td><strong>두 명이 같은 기능 동시에 만들 때</strong></td><td align="center" style="color:#64748b">merge conflict 발생</td><td align="center"><strong style="color:#16a34a">hash ID 로 다른 파일 → 충돌 0</strong></td></tr>
<tr><td><strong>AI 가 짠 코드를 누가 검증?</strong></td><td align="center" style="color:#64748b">작성한 AI 가 자기 검증 (위험)</td><td align="center"><strong style="color:#16a34a">별도 reviewer agent 가 분업 검증</strong></td></tr>
<tr><td><strong>AI 도구 (Claude → Cursor) 바꿀 때</strong></td><td align="center" style="color:#64748b">도구마다 재구성 필요</td><td align="center"><strong style="color:#16a34a">1 spec → 4 host 자동 미러링</strong></td></tr>
<tr><td><strong>spec 의 권위</strong></td><td align="center" style="color:#64748b">AI 가 매번 다르게 해석</td><td align="center"><strong style="color:#16a34a">봉인된 spec 이 단일 기준</strong></td></tr>
</tbody>
</table>

<sub>Hero 의 8/8 vs 2/8 은 초기 벤치마크 (<a href="docs/benchmarks/event-store-trap-catch.md">상세</a>) · 대규모 측정 진행 중.</sub>

## How it works

**SSoT → Code → Tests** 가 한 cycle 로 순환한다 — spec 이 *왜* 를 기록하고, Iron Law 가 검증하고, Drift detector 가 어긋남을 차단한다.

<div align="center">

<svg width="700" height="460" viewBox="0 0 700 460" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="cycle-title">
  <title id="cycle-title">SSoT → Code → Tests 가 한 cycle 로 순환 — 한 feature lifecycle</title>
  <!-- SSoT (top) -->
  <rect x="240" y="30" width="220" height="90" rx="45" fill="#dcfce7" stroke="#16a34a" stroke-width="2.5"/>
  <text x="350" y="62" font-family="sans-serif" font-size="18" font-weight="800" fill="#15803d" text-anchor="middle">SSoT — Spec</text>
  <text x="350" y="84" font-family="sans-serif" font-size="12" fill="#166534" text-anchor="middle">의도(왜)가 기록된 곳</text>
  <text x="350" y="103" font-family="monospace" font-size="11" fill="#166534" text-anchor="middle">spec.yaml</text>

  <!-- Code (bottom-right) -->
  <rect x="430" y="310" width="220" height="90" rx="45" fill="#dbeafe" stroke="#2563eb" stroke-width="2.5"/>
  <text x="540" y="342" font-family="sans-serif" font-size="18" font-weight="800" fill="#1d4ed8" text-anchor="middle">Code — Iron Law</text>
  <text x="540" y="364" font-family="sans-serif" font-size="12" fill="#1e3a8a" text-anchor="middle">13 단계 필수 검증</text>
  <text x="540" y="383" font-family="monospace" font-size="11" fill="#1e3a8a" text-anchor="middle">clad check</text>

  <!-- Tests (bottom-left) -->
  <rect x="50" y="310" width="220" height="90" rx="45" fill="#fef9c3" stroke="#ca8a04" stroke-width="2.5"/>
  <text x="160" y="342" font-family="sans-serif" font-size="17" font-weight="800" fill="#854d0e" text-anchor="middle">Tests — Drift Detection</text>
  <text x="160" y="364" font-family="sans-serif" font-size="12" fill="#713f12" text-anchor="middle">28 어긋남 검사기 · 7 카테고리</text>
  <text x="160" y="383" font-family="monospace" font-size="11" fill="#713f12" text-anchor="middle">매 commit 자동</text>

  <!-- Arrow SSoT → Code (curve, right side) -->
  <path d="M 460 110 Q 620 220 540 308" fill="none" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="532,300 543,310 533,315" fill="#1e293b"/>
  <text x="610" y="215" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">enforces</text>

  <!-- Arrow Code → Tests (bottom horizontal) -->
  <line x1="430" y1="355" x2="282" y2="355" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="290,349 278,355 290,361" fill="#1e293b"/>
  <text x="355" y="345" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">detects</text>

  <!-- Arrow Tests → SSoT (curve, left side) -->
  <path d="M 160 310 Q 80 220 240 110" fill="none" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="237,118 247,108 252,120" fill="#1e293b"/>
  <text x="90" y="215" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">feeds back</text>

  <!-- Center label -->
  <text x="350" y="218" font-family="sans-serif" font-size="14" font-weight="700" fill="#1e293b" text-anchor="middle">한 feature lifecycle</text>
  <text x="350" y="238" font-family="sans-serif" font-size="11" fill="#64748b" text-anchor="middle">매 commit 통과해야 merge</text>
</svg>

</div>

### 1. SSoT — 의도의 단일 기준

spec 이 *왜* (무엇을 왜 만드는지) 를 기록하는 곳. 4-tier (A/B/C/D) 단일 진실 출처 (Single Source of Truth) — *의도가 위, 구현물이 아래*.

| Tier | 역할 | 수정 권한 | 권위 |
|---|---|---|---|
| **A — Spec** | 의도 (무엇을 만들까) | 사람이 정의 | 봉인 · LLM 수정 금지 |
| **B — Design** | 설계 (어떻게 만들까) | 사람이 자유 편집 | A 와 일치 검증 |
| **C — Derived** | 구현물 (코드 · 테스트) | LLM · 사람 | 코드 보고 자동 재생성 |
| **D — Audit** | 감사 기록 (무엇이 일어났나) | append-only | 수정 불가 |

**A 가 B 보다 우선** — 코드와 spec 이 다르면 *코드가* 틀린 것. 의도(A)가 변하면 모든 게 흔들리기 때문에 LLM 이 못 건드리도록 봉인.

<div align="center">

<svg width="640" height="440" viewBox="0 0 640 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="ssot-tier-title">
  <title id="ssot-tier-title">4-tier SSoT — A(Spec) → B(Design) → C(Derived) → D(Audit), A 가 B 보다 우선</title>
  <!-- Tier A (green) -->
  <rect x="40" y="20" width="560" height="72" rx="8" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <text x="60" y="48" font-family="sans-serif" font-size="16" font-weight="700" fill="#15803d">A — Spec  ·  의도 (무엇을 만들까)</text>
  <text x="60" y="74" font-family="monospace" font-size="13" fill="#166534">spec.yaml  ·  spec/features/*.yaml</text>

  <!-- Arrow A→B -->
  <line x1="320" y1="92" x2="320" y2="120" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,114 320,124 326,114" fill="#1e293b"/>
  <text x="332" y="111" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">A 우선</text>

  <!-- Tier B (blue) -->
  <rect x="40" y="125" width="560" height="92" rx="8" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="60" y="153" font-family="sans-serif" font-size="16" font-weight="700" fill="#1d4ed8">B — Design  ·  설계 (어떻게 만들까)</text>
  <text x="60" y="180" font-family="monospace" font-size="13" fill="#1e40af">architecture.yaml  ·  project-context.md</text>
  <text x="60" y="200" font-family="monospace" font-size="13" fill="#1e40af">ai_hints  ·  conventions.md</text>

  <!-- Arrow B→C -->
  <line x1="320" y1="217" x2="320" y2="245" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,239 320,249 326,239" fill="#1e293b"/>
  <text x="332" y="236" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">implement</text>

  <!-- Tier C (gray) -->
  <rect x="40" y="250" width="560" height="72" rx="8" fill="#f1f5f9" stroke="#64748b" stroke-width="2"/>
  <text x="60" y="278" font-family="sans-serif" font-size="16" font-weight="700" fill="#334155">C — Derived  ·  구현물 (코드 · 테스트)</text>
  <text x="60" y="304" font-family="monospace" font-size="13" fill="#475569">src/**/*.ts  ·  tests/**/*.test.ts</text>

  <!-- Arrow C→D -->
  <line x1="320" y1="322" x2="320" y2="350" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,344 320,354 326,344" fill="#1e293b"/>
  <text x="332" y="341" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">event log</text>

  <!-- Tier D (slate) -->
  <rect x="40" y="355" width="560" height="65" rx="8" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
  <text x="60" y="383" font-family="sans-serif" font-size="16" font-weight="700" fill="#1e293b">D — Audit  ·  감사 기록 (무엇이 일어났나)</text>
  <text x="60" y="408" font-family="monospace" font-size="13" fill="#334155">.cladding/events.log.jsonl</text>
</svg>

</div>

### 2. Code — Iron Law (필수 통과) gate

모든 commit 은 13 단계 gate 를 통과해야 merge. 각 stage 가 자체 unit test 와 함께 ship 된다.

<div align="center">

<svg width="640" height="460" viewBox="0 0 640 460" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="iron-law-title">
  <title id="iron-law-title">13 단계 Iron Law gate — PR 이 static(6) · test(2) · e2e(3) · evidence(2) 를 모두 통과해야 merge</title>
  <!-- PR -->
  <rect x="270" y="10" width="100" height="40" rx="6" fill="#1e293b"/>
  <text x="320" y="35" font-family="sans-serif" font-size="14" font-weight="700" fill="#ffffff" text-anchor="middle">PR</text>
  <line x1="320" y1="50" x2="320" y2="75" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,69 320,79 326,69" fill="#1e293b"/>

  <!-- stage_1 static -->
  <rect x="40" y="80" width="560" height="72" rx="8" fill="#fef9c3" stroke="#ca8a04" stroke-width="2"/>
  <text x="60" y="103" font-family="sans-serif" font-size="14" font-weight="700" fill="#854d0e">stage_1 · static  (6)</text>
  <g font-family="monospace" font-size="13" fill="#713f12">
    <text x="60"  y="135">Type</text>
    <text x="135" y="135">Lint</text>
    <text x="200" y="135">Drift</text>
    <text x="275" y="135">Commit</text>
    <text x="365" y="135">Arch</text>
    <text x="430" y="135">Secret</text>
  </g>
  <line x1="320" y1="152" x2="320" y2="172" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,166 320,176 326,166" fill="#1e293b"/>

  <!-- stage_2 test -->
  <rect x="40" y="177" width="560" height="60" rx="8" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="60" y="200" font-family="sans-serif" font-size="14" font-weight="700" fill="#1d4ed8">stage_2 · test  (2)</text>
  <g font-family="monospace" font-size="13" fill="#1e3a8a">
    <text x="60"  y="225">Unit</text>
    <text x="135" y="225">Cov</text>
  </g>
  <line x1="320" y1="237" x2="320" y2="257" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,251 320,261 326,251" fill="#1e293b"/>

  <!-- stage_3 e2e -->
  <rect x="40" y="262" width="560" height="60" rx="8" fill="#e0e7ff" stroke="#6366f1" stroke-width="2"/>
  <text x="60" y="285" font-family="sans-serif" font-size="14" font-weight="700" fill="#4338ca">stage_3 · e2e  (3)</text>
  <g font-family="monospace" font-size="13" fill="#312e81">
    <text x="60"  y="310">Smoke</text>
    <text x="140" y="310">Perf</text>
    <text x="200" y="310">Visual</text>
  </g>
  <line x1="320" y1="322" x2="320" y2="342" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,336 320,346 326,336" fill="#1e293b"/>

  <!-- stage_4 evidence -->
  <rect x="40" y="347" width="560" height="60" rx="8" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <text x="60" y="370" font-family="sans-serif" font-size="14" font-weight="700" fill="#15803d">stage_4 · evidence  (2)</text>
  <g font-family="monospace" font-size="13" fill="#14532d">
    <text x="60"  y="395">Audit</text>
    <text x="140" y="395">UAT</text>
  </g>
  <line x1="320" y1="407" x2="320" y2="427" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,421 320,431 326,421" fill="#1e293b"/>

  <!-- outcome -->
  <text x="320" y="448" font-family="sans-serif" font-size="13" font-weight="700" fill="#16a34a" text-anchor="middle">all pass → merge OK    ✗    any fail → block</text>
</svg>

</div>

| Stage | 무엇을 검사하나 |
|---|---|
| **1.1 Type · 1.2 Lint** | 타입 오류 · 코드 스타일 |
| **1.3 Drift** | 28 detector 의 spec ↔ 코드 어긋남 |
| **1.4 Commit · 1.5 Arch · 1.6 Secret** | 작업트리 clean · architecture invariant (forbidden import 등) · API 키 노출 |
| **2.1 Unit · 2.2 Cov** | 단위 테스트 통과 · 프로젝트 coverage threshold |
| **3.1 Smoke · 3.2 Perf · 3.3 Visual** | e2e 핵심 기능 동작 · 성능 예산 · UI 시각 회귀 |
| **4.1 Audit · 4.2 UAT** | 모든 AC (acceptance criteria, 수용 기준) 에 증거 1건 이상 · 모든 `status=done` feature 에 증거 1건 이상 |

### 3. Test — 28 개 어긋남 검사기 (drift detector)

spec · code · test 사이 7 카테고리의 어긋남을 자동으로 잡아낸다. 전체 카탈로그: [src/stages/detectors/README.md](src/stages/detectors/README.md).

<table>
<thead>
<tr><th>카테고리</th><th>무엇을 잡나</th><th align="center">수</th><th>대표 detector</th></tr>
</thead>
<tbody>
<tr><td>spec ↔ code drift</td><td>spec 에 있는데 코드에 없거나, 코드에 있는데 spec 에 없음</td><td align="center">6</td><td><code>UNMAPPED_ARTIFACT</code>, <code>MISSING_IMPLEMENTATION</code>, <code>AC_DRIFT</code></td></tr>
<tr><td>code ↔ test</td><td>코드는 있는데 테스트 없음 · 커버리지 부족</td><td align="center">6</td><td><code>MISSING_TESTS</code>, <code>COVERAGE_DROP</code>, <code>HARDCODED_SECRET</code></td></tr>
<tr><td>spec ↔ test</td><td>spec 의 AC 가 테스트로 검증 안 됨</td><td align="center">4</td><td><code>UNTESTED_AC</code>, <code>STATUS_DRIFT</code>, <code>STALE_EVIDENCE</code></td></tr>
<tr><td>spec maintenance</td><td>spec 자체의 위생 (slug 충돌 · ID 중복)</td><td align="center">5</td><td><code>SLUG_CONFLICT</code>, <code>ID_COLLISION</code>, <code>ENRICHMENT_PENDING</code></td></tr>
<tr><td>environment integrity</td><td>빌드 환경 · 메타 파일 무결성</td><td align="center">3</td><td><code>HARNESS_INTEGRITY</code>, <code>META_INTEGRITY</code></td></tr>
<tr><td>architecture · capability</td><td>spec 의 아키텍처 · capability 정의와 코드 불일치</td><td align="center">2</td><td><code>ARCHITECTURE_FROM_SPEC</code>, <code>CAPABILITIES_FEATURE_MAPPING</code></td></tr>
<tr><td>governance · policy</td><td>ai_hints 정책 위반 (예: 금지 패턴 사용)</td><td align="center">2</td><td><code>AI_HINTS_FORBIDDEN_PATTERN</code>, <code>ABSENCE_OF_GOVERNANCE</code></td></tr>
</tbody>
</table>

### 4. Cycle — 한 feature 의 lifecycle

SSoT → Code → Test 를 한 cycle 로 묶는 4 step. drift 가 0 이면 merge, 1 이상이면 block.

<div align="center">

<svg width="720" height="240" viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="workflow-title">
  <title id="workflow-title">한 feature 의 lifecycle — Define → Sync → Implement → Verify, drift 0 이면 merge / 그 외 block</title>
  <!-- 4 step nodes -->
  <g font-family="sans-serif">
    <rect x="20"  y="70" width="120" height="80" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
    <text x="80"  y="105" font-size="16" font-weight="700" fill="#1e293b" text-anchor="middle">① Define</text>
    <text x="80"  y="128" font-size="11" font-family="monospace" fill="#475569" text-anchor="middle">spec/features/</text>

    <rect x="170" y="70" width="120" height="80" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
    <text x="230" y="105" font-size="16" font-weight="700" fill="#1e293b" text-anchor="middle">② Sync</text>
    <text x="230" y="128" font-size="11" font-family="monospace" fill="#475569" text-anchor="middle">clad sync</text>

    <rect x="320" y="70" width="120" height="80" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
    <text x="380" y="105" font-size="16" font-weight="700" fill="#1e293b" text-anchor="middle">③ Implement</text>
    <text x="380" y="128" font-size="11" fill="#475569" text-anchor="middle">AI 가 코드 작성</text>

    <rect x="470" y="70" width="120" height="80" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
    <text x="530" y="105" font-size="16" font-weight="700" fill="#1e293b" text-anchor="middle">④ Verify</text>
    <text x="530" y="128" font-size="11" font-family="monospace" fill="#475569" text-anchor="middle">clad check</text>
  </g>

  <!-- arrows between nodes -->
  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="140" y1="110" x2="165" y2="110"/><polygon points="160,105 170,110 160,115"/>
    <line x1="290" y1="110" x2="315" y2="110"/><polygon points="310,105 320,110 310,115"/>
    <line x1="440" y1="110" x2="465" y2="110"/><polygon points="460,105 470,110 460,115"/>
  </g>

  <!-- branching after Verify -->
  <g stroke="#1e293b" stroke-width="2" fill="none">
    <path d="M 590 110 L 620 110 L 620 60 L 660 60" />
    <path d="M 590 110 L 620 110 L 620 160 L 660 160" />
  </g>
  <polygon points="650,55 660,60 650,65" fill="#16a34a"/>
  <polygon points="650,155 660,160 650,165" fill="#ef4444"/>

  <!-- outcomes -->
  <text x="665" y="58"  font-family="sans-serif" font-size="13" font-weight="700" fill="#16a34a">drift = 0</text>
  <text x="665" y="73"  font-family="sans-serif" font-size="12" fill="#15803d">→ merge ✓</text>
  <text x="665" y="158" font-family="sans-serif" font-size="13" font-weight="700" fill="#ef4444">drift &gt; 0</text>
  <text x="665" y="173" font-family="sans-serif" font-size="12" fill="#b91c1c">→ block ✗</text>
</svg>

</div>

## Multi-Agent Workflow

cladding 은 **5 명의 에이전트가 협업하는 다중 에이전트 (multi-agent) 시스템**. 각 에이전트는 명확한 역할 분담 — **CQS** (Command-Query Separation, *명령하는 역할* 과 *검증하는 역할* 의 분리) — 으로 자기가 짠 작업은 자기가 승인할 수 없다. 규제 · 감사 (EU AI Act · K-AI 기본법 · SOX) 기준에 그대로 매핑된다.

<div align="center">

<svg width="680" height="420" viewBox="0 0 680 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="multi-agent-title">
  <title id="multi-agent-title">5 페르소나 권한 분리 (CQS) — orchestrator 가 분배, librarian/specialist/reviewer 가 작업, observability 가 메트릭 관찰</title>
  <!-- orchestrator (top) -->
  <rect x="260" y="20" width="160" height="60" rx="8" fill="#1e293b"/>
  <text x="340" y="48" font-family="sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">orchestrator</text>
  <text x="340" y="68" font-family="monospace" font-size="12" fill="#cbd5e1" text-anchor="middle">dispatch (분배) only</text>

  <!-- arrows from orchestrator to 3 middle -->
  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="340" y1="80" x2="140" y2="160"/>
    <polygon points="142,154 134,162 148,164"/>
    <line x1="340" y1="80" x2="340" y2="160"/>
    <polygon points="334,154 340,164 346,154"/>
    <line x1="340" y1="80" x2="540" y2="160"/>
    <polygon points="538,154 546,162 532,164"/>
  </g>
  <text x="335" y="115" font-family="sans-serif" font-size="11" font-style="italic" fill="#475569" text-anchor="middle">작업 분배</text>

  <!-- 3 middle: librarian / specialist / reviewer -->
  <rect x="60"  y="165" width="160" height="90" rx="8" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <text x="140" y="190" font-family="sans-serif" font-size="15" font-weight="700" fill="#15803d" text-anchor="middle">librarian</text>
  <text x="140" y="215" font-family="monospace" font-size="12" fill="#166534" text-anchor="middle">spec  ✎ write</text>
  <text x="140" y="235" font-family="monospace" font-size="12" fill="#166534" text-anchor="middle">code  ◎ read</text>

  <rect x="260" y="165" width="160" height="90" rx="8" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="340" y="190" font-family="sans-serif" font-size="15" font-weight="700" fill="#1d4ed8" text-anchor="middle">specialist</text>
  <text x="340" y="215" font-family="monospace" font-size="12" fill="#1e3a8a" text-anchor="middle">code  ✎ write</text>
  <text x="340" y="235" font-family="monospace" font-size="12" fill="#1e3a8a" text-anchor="middle">spec  ◎ read</text>

  <rect x="460" y="165" width="160" height="90" rx="8" fill="#fef9c3" stroke="#ca8a04" stroke-width="2"/>
  <text x="540" y="190" font-family="sans-serif" font-size="15" font-weight="700" fill="#854d0e" text-anchor="middle">reviewer</text>
  <text x="540" y="215" font-family="monospace" font-size="12" fill="#713f12" text-anchor="middle">audit ⚖ only</text>
  <text x="540" y="235" font-family="monospace" font-size="12" fill="#713f12" text-anchor="middle">all   ◎ read</text>

  <!-- arrows from 3 middle to observability -->
  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="140" y1="255" x2="340" y2="320"/>
    <polygon points="335,314 343,323 329,324"/>
    <line x1="340" y1="255" x2="340" y2="320"/>
    <polygon points="334,314 340,324 346,314"/>
    <line x1="540" y1="255" x2="340" y2="320"/>
    <polygon points="345,314 337,322 351,324"/>
  </g>

  <!-- observability (bottom) -->
  <rect x="260" y="325" width="160" height="60" rx="8" fill="#f1f5f9" stroke="#475569" stroke-width="2"/>
  <text x="340" y="353" font-family="sans-serif" font-size="15" font-weight="700" fill="#334155" text-anchor="middle">observability</text>
  <text x="340" y="373" font-family="monospace" font-size="12" fill="#475569" text-anchor="middle">metrics  ◎ read</text>

  <!-- caption -->
  <text x="340" y="408" font-family="sans-serif" font-size="13" font-weight="700" fill="#1e293b" text-anchor="middle">자기 작업 승인 불가  ·  명령(write) 과 검증(read) 분리 (CQS)</text>
</svg>

</div>

## Ecosystem

기존 세 카테고리의 결합부에 cladding 이 있다.

<div align="center">

<svg width="640" height="380" viewBox="0 0 640 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="ecosystem-title">
  <title id="ecosystem-title">Ecosystem Venn — SDD · Runners · Multi-agent Governance 세 카테고리의 결합부에 cladding 이 위치</title>
  <!-- 3 overlapping circles -->
  <circle cx="200" cy="160" r="130" fill="#dcfce7" fill-opacity="0.55" stroke="#16a34a" stroke-width="2"/>
  <circle cx="440" cy="160" r="130" fill="#dbeafe" fill-opacity="0.55" stroke="#2563eb" stroke-width="2"/>
  <circle cx="320" cy="260" r="130" fill="#fef9c3" fill-opacity="0.55" stroke="#ca8a04" stroke-width="2"/>

  <!-- category labels -->
  <text x="120" y="55"  font-family="sans-serif" font-size="14" font-weight="700" fill="#15803d">① Spec-Driven Development</text>
  <text x="120" y="73"  font-family="sans-serif" font-size="11" fill="#166534">Spec Kit · OpenSpec · Tessl · Kiro</text>

  <text x="380" y="55"  font-family="sans-serif" font-size="14" font-weight="700" fill="#1d4ed8">② Runners</text>
  <text x="380" y="73"  font-family="sans-serif" font-size="11" fill="#1e3a8a">OpenHands · Cline · Aider · Goose</text>

  <text x="200" y="370" font-family="sans-serif" font-size="14" font-weight="700" fill="#854d0e">③ Multi-agent Governance</text>
  <text x="200" y="355" font-family="sans-serif" font-size="11" fill="#713f12">BMAD · ChatDev · Agent Teams</text>

  <!-- cladding box at intersection -->
  <rect x="270" y="180" width="100" height="44" rx="6" fill="#1e293b"/>
  <text x="320" y="208" font-family="sans-serif" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">cladding</text>
</svg>

</div>

### 인접 도구와의 차이

- **Spec Kit · OpenSpec · Tessl · Kiro** — *spec 을 잘 쓰게* 도와주는 도구. cladding 은 거기에 더해 *그 spec 과 실제 코드가 어긋나지 않는지 매 commit 자동 검사* 한다.
- **BMAD · ChatDev · Claude Agent Teams** — *여러 AI 에이전트가 역할을 나눠 협업하는 시스템*. cladding 의 5 에이전트는 그 위에 *spec · 코드 · 감사 기록* 까지 결합해 동작한다.
- **tdd-guard** — *AI 가 테스트를 먼저 쓰도록 강제* 하는 도구. cladding 의 13 단계 검사 중 Unit · Coverage 항목이 같은 일을 한다.
- **OpenHands · Cline · Aider · Goose** — *AI 에게 코드를 짜게 시키는 실행기*. cladding 은 그 실행기가 짠 코드를 *검증 · 통제하는 상위 레이어* 다.

cladding 의 차별점은 *결합* — 위 네 카테고리의 핵심을 *하나의 검증 흐름* 으로 묶는 것.

## Install

cladding 은 두 가지 경로로 시작할 수 있다 — 어느 쪽이든 *같은 spec · 같은 정책 · 같은 검증 흐름* 에 도착한다.

### 방법 1 — 마켓플레이스 (가장 빠름)

Claude Code · Codex CLI · Gemini CLI 의 마켓플레이스에서 cladding 을 설치한 뒤, AI 에게 한 줄 명령:

```
/cladding init "B2B 결제 SaaS"
```

AI 가 그 자리에서 spec · 4-tier 문서 · 정책을 자동으로 채운다. 별도의 npm 설치 불필요.

### 방법 2 — npm (터미널 · CI · AI 도구가 없는 환경)

```bash
npm install -g cladding
clad init "B2B 결제 SaaS"
clad check
```

`npm install -g cladding` 의 postinstall 훅이 다음 4 개 채널을 자동으로 연결한다:

| 호스트 | 자동 연결 위치 |
|---|---|
| Claude Code | `~/.claude/plugins/cladding` |
| Codex CLI (skills) | `~/.agents/skills/cladding-*` |
| Codex CLI (MCP 서버) | `~/.codex/config.toml` 의 `[mcp_servers.cladding]` |
| Gemini CLI | `~/.gemini/extensions/cladding` |

이후 어느 AI 도구에서든 `/cladding init` 또는 `clad init` 모두 동일하게 동작한다.

> `npm install --ignore-scripts` 로 설치한 경우 postinstall 이 건너뛰어지지만, 첫 `clad init` 실행 시 자동으로 재시도한다.

### 세 가지 init 시나리오

`clad init` 은 자연어 intent 를 받아 *상황에 맞는 path* 를 자동 선택한다. 같은 명령, 세 가지 시작점.

| 시작 상황 | 명령 (npm 기준) | 무엇이 일어나는가 |
|---|---|---|
| **아이디어만 있을 때** | `clad init "B2B 결제 SaaS 만들거야"` | LLM 이 도메인 분석 → spec · 문서 · 정책 자동 생성 + 2–3 가지 후속 질문 출력 |
| **기획 문서가 있을 때** | `clad init docs/plan.md` | cladding 이 파일 경로를 인식 → 내용을 자동 로드해서 intent 로 사용 (절대/상대 경로 모두 지원) |
| **기존 프로젝트 도입** | `clad init "이 프로젝트에 cladding 적용해줘"` | 기존 코드 자동 스캔 (≥3 source files) → 관찰한 패턴 + intent 결합 |

> 마켓플레이스 (Claude Code · Codex CLI · Gemini CLI) 에서는 `/cladding init "..."` 형식으로 동일하게 사용 — 자유 텍스트도, `/cladding init docs/plan.md` 같은 경로도 같게 받는다.

### init 한 번이면 끝

cladding 의 목표는 *spec ↔ 코드 어긋남을 막는 인프라가 되는 것* — init 이후로는 평소처럼 개발하면 된다. AI 도구가 spec 을 참조하며 코드를 짜고, `clad check` 가 CI · pre-commit hook 에서 자동으로 돌아 어긋남이 있으면 차단한다. 추가 수동 명령 불필요.

## Status

<table style="margin:0 auto;border:none">
<tr style="border:none">
<td style="text-align:center;width:140px;background:#f8fafc;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">version</div>
<div style="font-size:24px;font-weight:800;color:#0f172a;margin:8px 0;letter-spacing:-0.5px">v0.3.60</div>
<div style="font-size:11px;color:#64748b">2026-05</div>
</td>
<td style="text-align:center;width:140px;background:#dcfce7;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#15803d;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">준수 등급</div>
<div style="font-size:24px;font-weight:800;color:#16a34a;margin:8px 0;letter-spacing:-0.5px">L4</div>
<div style="font-size:11px;color:#15803d">최고 · 자가 선언</div>
</td>
<td style="text-align:center;width:140px;background:#f8fafc;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">tests</div>
<div style="font-size:24px;font-weight:800;color:#0f172a;margin:8px 0;letter-spacing:-0.5px">954<span style="font-size:16px;color:#94a3b8">/954</span></div>
<div style="font-size:11px;color:#64748b">all pass</div>
</td>
<td style="text-align:center;width:140px;background:#f8fafc;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">coverage</div>
<div style="font-size:24px;font-weight:800;color:#0f172a;margin:8px 0;letter-spacing:-0.5px">93.89<span style="font-size:16px;color:#94a3b8">%+</span></div>
<div style="font-size:11px;color:#64748b">enforced</div>
</td>
<td style="text-align:center;width:140px;background:#f8fafc;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">features</div>
<div style="font-size:24px;font-weight:800;color:#0f172a;margin:8px 0;letter-spacing:-0.5px">134</div>
<div style="font-size:11px;color:#64748b">spec 정의</div>
</td>
</tr>
</table>

<sub>100 test files · Claude Code · OpenAI Codex · Gemini CLI 마켓플레이스 설치 가능.</sub>

> **Ironclad 1.0 까지의 길** — 1.0 은 *독립적인 두 개의 구현이 L4 검증 셋을 통과해야* 잠긴다 ([GOVERNANCE § 1](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md)). cladding 이 첫 번째.

## Docs

- [Why cladding (project context)](docs/project-context.md)
- [4-tier governance model](docs/ssot-model.md)
- [Hash-based feature ID](docs/spec-ids-multi-dev.md)
- [28 detector catalog](src/stages/detectors/README.md)
- [Benchmark — event store trap catch](docs/benchmarks/event-store-trap-catch.md)
- [A/B evaluation cases](docs/ab-evaluation/)
- [Governance · roadmap to 1.0](GOVERNANCE.md)

## License

MIT. [LICENSE](LICENSE) · 관련: [Ironclad](https://github.com/qwerfunch/ironclad) (구현 대상 표준) · [harness-boot](https://github.com/qwerfunch/harness-boot) (seed).
