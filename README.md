<h1 align="center">cladding</h1>

<p align="center">
  <strong>Unified Governance for AI-Coupled Engineering.</strong><br/>
  AI-generated code, held to the same bar as human code.
</p>

<p align="center">
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen" alt="ironclad"/></a>
  <a href="https://github.com/qwerfunch/ironclad"><img src="https://img.shields.io/badge/spec-v0.0.23-blue" alt="spec"/></a>
  <img src="https://img.shields.io/badge/tests-954%2F954-brightgreen" alt="tests"/>
  <img src="https://img.shields.io/badge/coverage-93.89%25%2B-brightgreen" alt="coverage"/>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license"/></a>
</p>

<p align="center">
  Reference implementation of the <a href="https://github.com/qwerfunch/ironclad">Ironclad</a> standard. 28 detectors and a 13-stage gate verify, on every commit, that the code your AI assistant wrote still matches the spec.
</p>

<!-- ─────────────── HERO ─────────────── -->

<table align="center">
<tr>
<td style="text-align:center;width:320px;background:#f1f5f9;padding:32px 24px;border-radius:8px">
<div style="font-size:13px;color:#64748b;letter-spacing:1px;text-transform:uppercase">Vanilla AI coding</div>
<div style="font-size:64px;font-weight:700;color:#94a3b8;line-height:1;margin:12px 0">2/8</div>
<div style="font-size:13px;color:#64748b">traps caught · 25%</div>
</td>
<td style="text-align:center;width:320px;background:#dcfce7;padding:32px 24px;border-radius:8px">
<div style="font-size:13px;color:#15803d;letter-spacing:1px;text-transform:uppercase">cladding</div>
<div style="font-size:64px;font-weight:700;color:#16a34a;line-height:1;margin:12px 0">8/8</div>
<div style="font-size:13px;color:#15803d">traps caught · 100%</div>
</td>
</tr>
<tr><td colspan="2" align="center"><sub>Same spec · same model · <a href="docs/benchmarks/event-store-trap-catch.md">event-sourcing store benchmark</a></sub></td></tr>
</table>

## Why

<table>
<tr>
<td width="33%" valign="top">

**The *why* fades after 3 months**

The reason an AI assistant wrote code a certain way doesn't survive in the code alone.

→ `spec/features/*.yaml` becomes the permanent record of *why*.

✓ **AI context survives time** — six months later, the AI reconstructs intent straight from the spec (new hires get the same entry point).

</td>
<td width="33%" valign="top">

**AI gives a different answer each time**

The same spec produces code with inconsistent patterns and structure.

→ The spec becomes the *fixed reference* against which every commit is checked.

✓ **Enterprise-ready consistency** — code style and patterns stay aligned across teams and PRs.

</td>
<td width="33%" valign="top">

**AI hallucination**

Generated code calls APIs, functions, or options that don't exist.

→ 28 detectors and a 13-stage gate block hallucinated code on every commit.

✓ **Production incidents prevented up front** — CI auto-rejects hallucinated code before it merges.

</td>
</tr>
</table>

## What you get

How a *vanilla AI coding environment* and a cladding environment behave when the same situation comes up.

<table>
<thead>
<tr><th>Situation</th><th align="center">Vanilla AI coding</th><th align="center">cladding</th></tr>
</thead>
<tbody>
<tr><td><strong>Code drifts from spec</strong></td><td align="center" style="color:#64748b">fixed if a reviewer notices</td><td align="center"><strong style="color:#16a34a">auto-blocked on every commit</strong></td></tr>
<tr><td><strong>Two devs build the same feature in parallel</strong></td><td align="center" style="color:#64748b">merge conflicts</td><td align="center"><strong style="color:#16a34a">hash-based IDs route to separate files → 0 conflicts</strong></td></tr>
<tr><td><strong>Who verifies AI-written code?</strong></td><td align="center" style="color:#64748b">the AI that wrote it (risky)</td><td align="center"><strong style="color:#16a34a">a separate reviewer agent — duties split</strong></td></tr>
<tr><td><strong>Switching AI tools (Claude → Cursor)</strong></td><td align="center" style="color:#64748b">reconfigure per tool</td><td align="center"><strong style="color:#16a34a">one spec → mirrored across 4 hosts</strong></td></tr>
<tr><td><strong>Spec authority</strong></td><td align="center" style="color:#64748b">the AI reinterprets it each time</td><td align="center"><strong style="color:#16a34a">the sealed spec is the single source of truth</strong></td></tr>
</tbody>
</table>

<p style="text-align: center; font-size: 13px; color: #64748b; margin-top: 8px;">
The hero's 8/8 vs 2/8 is an early benchmark (<a href="docs/benchmarks/event-store-trap-catch.md">details</a>) · larger-scale measurements are in progress.
</p>

<!-- ─────────────── How it works ─────────────── -->
## How it works

**SSoT → Code → Tests** runs as a single cycle — the spec captures the *why*, Iron Law verifies the implementation, and Drift Detection blocks anything that no longer matches.

<div align="center">

<svg width="700" height="460" viewBox="0 0 700 460" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="cycle-title">
  <title id="cycle-title">SSoT → Code → Tests as a single cycle — one feature's lifecycle</title>
  <!-- SSoT (top) -->
  <rect x="240" y="30" width="220" height="90" rx="45" fill="#dcfce7" stroke="#16a34a" stroke-width="2.5"/>
  <text x="350" y="62" font-family="sans-serif" font-size="18" font-weight="800" fill="#15803d" text-anchor="middle">SSoT — Spec</text>
  <text x="350" y="84" font-family="sans-serif" font-size="12" fill="#166534" text-anchor="middle">where the *why* lives</text>
  <text x="350" y="103" font-family="monospace" font-size="11" fill="#166534" text-anchor="middle">spec.yaml</text>

  <!-- Code (bottom-right) -->
  <rect x="430" y="310" width="220" height="90" rx="45" fill="#dbeafe" stroke="#2563eb" stroke-width="2.5"/>
  <text x="540" y="342" font-family="sans-serif" font-size="18" font-weight="800" fill="#1d4ed8" text-anchor="middle">Code — Iron Law</text>
  <text x="540" y="364" font-family="sans-serif" font-size="12" fill="#1e3a8a" text-anchor="middle">13-stage required gate</text>
  <text x="540" y="383" font-family="monospace" font-size="11" fill="#1e3a8a" text-anchor="middle">clad check</text>

  <!-- Tests (bottom-left) -->
  <rect x="50" y="310" width="220" height="90" rx="45" fill="#fef9c3" stroke="#ca8a04" stroke-width="2.5"/>
  <text x="160" y="342" font-family="sans-serif" font-size="17" font-weight="800" fill="#854d0e" text-anchor="middle">Tests — Drift Detection</text>
  <text x="160" y="364" font-family="sans-serif" font-size="12" fill="#713f12" text-anchor="middle">28 drift detectors · 7 categories</text>
  <text x="160" y="383" font-family="monospace" font-size="11" fill="#713f12" text-anchor="middle">automatic on every commit</text>

  <!-- Arrow SSoT → Code -->
  <path d="M 460 110 Q 620 220 540 308" fill="none" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="532,300 543,310 533,315" fill="#1e293b"/>
  <text x="610" y="215" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">enforces</text>

  <!-- Arrow Code → Tests -->
  <line x1="430" y1="355" x2="282" y2="355" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="290,349 278,355 290,361" fill="#1e293b"/>
  <text x="355" y="345" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">detects</text>

  <!-- Arrow Tests → SSoT -->
  <path d="M 160 310 Q 80 220 240 110" fill="none" stroke="#1e293b" stroke-width="2.5"/>
  <polygon points="237,118 247,108 252,120" fill="#1e293b"/>
  <text x="90" y="215" font-family="sans-serif" font-size="13" font-style="italic" font-weight="600" fill="#475569" text-anchor="middle">feeds back</text>

  <!-- Center -->
  <text x="350" y="218" font-family="sans-serif" font-size="14" font-weight="700" fill="#1e293b" text-anchor="middle">one feature's lifecycle</text>
  <text x="350" y="238" font-family="sans-serif" font-size="11" fill="#64748b" text-anchor="middle">must clear every commit to merge</text>
</svg>

</div>

### 1. SSoT — single source of intent

The spec is where the *why* (what we're building and why) lives. A 4-tier (A/B/C/D) Single Source of Truth — *intent on top, implementation below*.

| Tier | Role | Who edits | Authority |
|---|---|---|---|
| **A — Spec** | intent (what to build) | humans only | sealed · LLMs cannot edit |
| **B — Design** | design (how to build it) | humans freely | checked against A |
| **C — Derived** | implementation (code · tests) | LLMs and humans | regenerated by reading the code |
| **D — Audit** | audit log (what actually happened) | append-only | immutable |

**A outranks B** — if code and spec disagree, *the code is wrong*. The spec is sealed because changing the *why* shakes everything downstream, so LLMs are kept out.

<div align="center">

<svg width="640" height="440" viewBox="0 0 640 440" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="ssot-tier-title">
  <title id="ssot-tier-title">4-tier SSoT — A(Spec) → B(Design) → C(Derived) → D(Audit), A outranks B</title>
  <!-- Tier A (green) -->
  <rect x="40" y="20" width="560" height="72" rx="8" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/>
  <text x="60" y="48" font-family="sans-serif" font-size="16" font-weight="700" fill="#15803d">A — Spec  ·  intent (what to build)</text>
  <text x="60" y="74" font-family="monospace" font-size="13" fill="#166534">spec.yaml  ·  spec/features/*.yaml</text>
  <line x1="320" y1="92" x2="320" y2="120" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,114 320,124 326,114" fill="#1e293b"/>
  <text x="332" y="111" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">A outranks</text>
  <rect x="40" y="125" width="560" height="92" rx="8" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
  <text x="60" y="153" font-family="sans-serif" font-size="16" font-weight="700" fill="#1d4ed8">B — Design  ·  design (how to build it)</text>
  <text x="60" y="180" font-family="monospace" font-size="13" fill="#1e40af">architecture.yaml  ·  project-context.md</text>
  <text x="60" y="200" font-family="monospace" font-size="13" fill="#1e40af">ai_hints  ·  conventions.md</text>
  <line x1="320" y1="217" x2="320" y2="245" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,239 320,249 326,239" fill="#1e293b"/>
  <text x="332" y="236" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">implement</text>
  <rect x="40" y="250" width="560" height="72" rx="8" fill="#f1f5f9" stroke="#64748b" stroke-width="2"/>
  <text x="60" y="278" font-family="sans-serif" font-size="16" font-weight="700" fill="#334155">C — Derived  ·  implementation (code · tests)</text>
  <text x="60" y="304" font-family="monospace" font-size="13" fill="#475569">src/**/*.ts  ·  tests/**/*.test.ts</text>
  <line x1="320" y1="322" x2="320" y2="350" stroke="#1e293b" stroke-width="2"/>
  <polygon points="314,344 320,354 326,344" fill="#1e293b"/>
  <text x="332" y="341" font-family="sans-serif" font-size="12" font-style="italic" fill="#475569">event log</text>
  <rect x="40" y="355" width="560" height="65" rx="8" fill="#e2e8f0" stroke="#475569" stroke-width="2"/>
  <text x="60" y="383" font-family="sans-serif" font-size="16" font-weight="700" fill="#1e293b">D — Audit  ·  audit log (what actually happened)</text>
  <text x="60" y="408" font-family="monospace" font-size="13" fill="#334155">.cladding/events.log.jsonl</text>
</svg>

</div>

### 2. Code — Iron Law (required) gate

Every commit has to clear all 13 stages to merge. Each stage ships with its own unit tests.

<div align="center">

<svg width="640" height="460" viewBox="0 0 640 460" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="iron-law-title">
  <title id="iron-law-title">13-stage Iron Law gate — a PR must clear static(6) · test(2) · e2e(3) · evidence(2) before it merges</title>
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
  <text x="320" y="448" font-family="sans-serif" font-size="13" font-weight="700" fill="#16a34a" text-anchor="middle">all pass → merge OK    ✗    any fail → block</text>
</svg>

</div>

| Stage | What it checks |
|---|---|
| **1.1 Type · 1.2 Lint** | type errors · code style |
| **1.3 Drift** | spec ↔ code mismatches across 28 detectors |
| **1.4 Commit · 1.5 Arch · 1.6 Secret** | clean working tree · architecture invariants (forbidden imports, etc.) · leaked API keys |
| **2.1 Unit · 2.2 Cov** | unit tests pass · project coverage threshold |
| **3.1 Smoke · 3.2 Perf · 3.3 Visual** | end-to-end critical paths · performance budgets · visual regression |
| **4.1 Audit · 4.2 UAT** | every AC (acceptance criteria) has at least one piece of evidence · every `status=done` feature has at least one piece of evidence |

### 3. Tests — 28 drift detectors

Seven categories of mismatch across spec · code · test, all caught automatically. Full catalog: [src/stages/detectors/README.md](src/stages/detectors/README.md).

<table>
<thead>
<tr><th>Category</th><th>What it catches</th><th align="center">Count</th><th>Representative detectors</th></tr>
</thead>
<tbody>
<tr><td>spec ↔ code drift</td><td>something in the spec missing from code, or in code with nothing in the spec</td><td align="center">6</td><td><code>UNMAPPED_ARTIFACT</code>, <code>MISSING_IMPLEMENTATION</code>, <code>AC_DRIFT</code></td></tr>
<tr><td>code ↔ test</td><td>code without tests · coverage falling below threshold</td><td align="center">6</td><td><code>MISSING_TESTS</code>, <code>COVERAGE_DROP</code>, <code>HARDCODED_SECRET</code></td></tr>
<tr><td>spec ↔ test</td><td>an AC in the spec that no test actually verifies</td><td align="center">4</td><td><code>UNTESTED_AC</code>, <code>STATUS_DRIFT</code>, <code>STALE_EVIDENCE</code></td></tr>
<tr><td>spec maintenance</td><td>spec hygiene — slug collisions, ID duplicates</td><td align="center">5</td><td><code>SLUG_CONFLICT</code>, <code>ID_COLLISION</code>, <code>ENRICHMENT_PENDING</code></td></tr>
<tr><td>environment integrity</td><td>build environment and meta-file integrity</td><td align="center">3</td><td><code>HARNESS_INTEGRITY</code>, <code>META_INTEGRITY</code></td></tr>
<tr><td>architecture · capability</td><td>code that breaks the architecture or capability shape declared in the spec</td><td align="center">2</td><td><code>ARCHITECTURE_FROM_SPEC</code>, <code>CAPABILITIES_FEATURE_MAPPING</code></td></tr>
<tr><td>governance · policy</td><td>code that breaks an `ai_hints` policy (e.g. forbidden patterns)</td><td align="center">2</td><td><code>AI_HINTS_FORBIDDEN_PATTERN</code>, <code>ABSENCE_OF_GOVERNANCE</code></td></tr>
</tbody>
</table>

### 4. Cycle — one feature's lifecycle

The 4 steps that wrap SSoT → Code → Test into a single cycle. Merge if drift is 0, block otherwise.

<div align="center">

<svg width="720" height="240" viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="workflow-title">
  <title id="workflow-title">One feature's lifecycle — Define → Sync → Implement → Verify, merge if drift=0 / block otherwise</title>
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
    <text x="380" y="128" font-size="11" fill="#475569" text-anchor="middle">AI writes the code</text>
    <rect x="470" y="70" width="120" height="80" rx="8" fill="#f8fafc" stroke="#1e293b" stroke-width="2"/>
    <text x="530" y="105" font-size="16" font-weight="700" fill="#1e293b" text-anchor="middle">④ Verify</text>
    <text x="530" y="128" font-size="11" font-family="monospace" fill="#475569" text-anchor="middle">clad check</text>
  </g>
  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="140" y1="110" x2="165" y2="110"/><polygon points="160,105 170,110 160,115"/>
    <line x1="290" y1="110" x2="315" y2="110"/><polygon points="310,105 320,110 310,115"/>
    <line x1="440" y1="110" x2="465" y2="110"/><polygon points="460,105 470,110 460,115"/>
  </g>
  <g stroke="#1e293b" stroke-width="2" fill="none">
    <path d="M 590 110 L 620 110 L 620 60 L 660 60" />
    <path d="M 590 110 L 620 110 L 620 160 L 660 160" />
  </g>
  <polygon points="650,55 660,60 650,65" fill="#16a34a"/>
  <polygon points="650,155 660,160 650,165" fill="#ef4444"/>
  <text x="665" y="58"  font-family="sans-serif" font-size="13" font-weight="700" fill="#16a34a">drift = 0</text>
  <text x="665" y="73"  font-family="sans-serif" font-size="12" fill="#15803d">→ merge ✓</text>
  <text x="665" y="158" font-family="sans-serif" font-size="13" font-weight="700" fill="#ef4444">drift &gt; 0</text>
  <text x="665" y="173" font-family="sans-serif" font-size="12" fill="#b91c1c">→ block ✗</text>
</svg>

</div>

## Multi-Agent Workflow

cladding is a **5-agent system** working in concert. Each agent has a clear role under **CQS** (Command-Query Separation — the agents that *do* are kept apart from the agents that *verify*), so no agent can sign off on its own work. This is the foundation that maps cleanly to compliance regimes (EU AI Act · K-AI Framework · SOX).

<div align="center">

<svg width="680" height="420" viewBox="0 0 680 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="multi-agent-title">
  <title id="multi-agent-title">5 personas with CQS — orchestrator dispatches, librarian/specialist/reviewer act, observability watches metrics</title>
  <!-- orchestrator (top) -->
  <rect x="260" y="20" width="160" height="60" rx="8" fill="#1e293b"/>
  <text x="340" y="48" font-family="sans-serif" font-size="15" font-weight="700" fill="#ffffff" text-anchor="middle">orchestrator</text>
  <text x="340" y="68" font-family="monospace" font-size="12" fill="#cbd5e1" text-anchor="middle">dispatch only</text>

  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="340" y1="80" x2="140" y2="160"/>
    <polygon points="142,154 134,162 148,164"/>
    <line x1="340" y1="80" x2="340" y2="160"/>
    <polygon points="334,154 340,164 346,154"/>
    <line x1="340" y1="80" x2="540" y2="160"/>
    <polygon points="538,154 546,162 532,164"/>
  </g>
  <text x="335" y="115" font-family="sans-serif" font-size="11" font-style="italic" fill="#475569" text-anchor="middle">dispatches work</text>

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

  <g stroke="#1e293b" stroke-width="2" fill="#1e293b">
    <line x1="140" y1="255" x2="340" y2="320"/>
    <polygon points="335,314 343,323 329,324"/>
    <line x1="340" y1="255" x2="340" y2="320"/>
    <polygon points="334,314 340,324 346,314"/>
    <line x1="540" y1="255" x2="340" y2="320"/>
    <polygon points="345,314 337,322 351,324"/>
  </g>

  <rect x="260" y="325" width="160" height="60" rx="8" fill="#f1f5f9" stroke="#475569" stroke-width="2"/>
  <text x="340" y="353" font-family="sans-serif" font-size="15" font-weight="700" fill="#334155" text-anchor="middle">observability</text>
  <text x="340" y="373" font-family="monospace" font-size="12" fill="#475569" text-anchor="middle">metrics  ◎ read</text>

  <text x="340" y="408" font-family="sans-serif" font-size="13" font-weight="700" fill="#1e293b" text-anchor="middle">no self-sign-off  ·  command(write) and query(read) separated (CQS)</text>
</svg>

</div>

## Ecosystem

cladding sits at the intersection of three existing categories.

<div align="center">

<svg width="640" height="380" viewBox="0 0 640 380" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="ecosystem-title">
  <title id="ecosystem-title">Ecosystem Venn — cladding sits at the intersection of SDD · Runners · Multi-agent Governance</title>
  <circle cx="200" cy="160" r="130" fill="#dcfce7" fill-opacity="0.55" stroke="#16a34a" stroke-width="2"/>
  <circle cx="440" cy="160" r="130" fill="#dbeafe" fill-opacity="0.55" stroke="#2563eb" stroke-width="2"/>
  <circle cx="320" cy="260" r="130" fill="#fef9c3" fill-opacity="0.55" stroke="#ca8a04" stroke-width="2"/>
  <text x="120" y="55"  font-family="sans-serif" font-size="14" font-weight="700" fill="#15803d">① Spec-Driven Development</text>
  <text x="120" y="73"  font-family="sans-serif" font-size="11" fill="#166534">Spec Kit · OpenSpec · Tessl · Kiro</text>
  <text x="380" y="55"  font-family="sans-serif" font-size="14" font-weight="700" fill="#1d4ed8">② Runners</text>
  <text x="380" y="73"  font-family="sans-serif" font-size="11" fill="#1e3a8a">OpenHands · Cline · Aider · Goose</text>
  <text x="200" y="370" font-family="sans-serif" font-size="14" font-weight="700" fill="#854d0e">③ Multi-agent Governance</text>
  <text x="200" y="355" font-family="sans-serif" font-size="11" fill="#713f12">BMAD · ChatDev · Agent Teams</text>
  <rect x="270" y="180" width="100" height="44" rx="6" fill="#1e293b"/>
  <text x="320" y="208" font-family="sans-serif" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">cladding</text>
</svg>

</div>

### How cladding differs from the neighbors

- **Spec Kit · OpenSpec · Tessl · Kiro** help you *write a good spec*. cladding goes further — it *verifies on every commit* that the code still matches that spec.
- **BMAD · ChatDev · Claude Agent Teams** are about splitting work across multiple AI agents. cladding's 5 agents take that further by tying spec, code, and audit log into the same loop.
- **tdd-guard** forces test-first development. That's roughly what the Unit · Coverage stages do inside cladding's 13-stage gate.
- **OpenHands · Cline · Aider · Goose** are *runners* — they tell the AI to write code. cladding is the *governance layer* that verifies and controls what those runners produce.

cladding's edge is the *combination* — it folds the strongest parts of all four categories into one verification loop.

<!-- ─────────────── Install ─────────────── -->
## Install

There are two paths into cladding — either one lands you in the same place, with the same spec · policies · verification loop.

### Path 1 — Marketplace (fastest)

Install cladding from the Claude Code · Codex CLI · Gemini CLI marketplace, then say one line to the AI:

```
/cladding init "B2B payment SaaS"
```

The AI fills in the spec, the 4-tier docs, and the policies on the spot. No separate npm install required.

### Path 2 — npm (terminal · CI · environments without an AI tool)

```bash
npm install -g cladding
clad init "B2B payment SaaS"
clad check
```

`npm install -g cladding`'s postinstall hook wires up four channels automatically:

| Host | Auto-wired location |
|---|---|
| Claude Code | `~/.claude/plugins/cladding` |
| Codex CLI (skills) | `~/.agents/skills/cladding-*` |
| Codex CLI (MCP server) | `[mcp_servers.cladding]` in `~/.codex/config.toml` |
| Gemini CLI | `~/.gemini/extensions/cladding` |

After that, `/cladding init` and `clad init` work identically from any AI tool.

> If you installed with `npm install --ignore-scripts`, the postinstall is skipped — but the first `clad init` retries it automatically.

### Three init scenarios

`clad init` takes a natural-language intent and picks the right path on its own. Same command, three starting points.

| Starting point | Command (npm path) | What happens |
|---|---|---|
| **An idea, nothing else** | `clad init "I want to build a B2B payment SaaS"` | LLM infers the domain → spec · docs · policies generated, with 2–3 follow-up questions printed |
| **A planning doc** | `clad init docs/plan.md` | cladding detects the file path, loads its contents, and uses them as the intent (absolute and relative paths both work) |
| **Adopting into an existing project** | `clad init "apply cladding to this project"` | scans the existing code (≥3 source files trigger it) → observed patterns are merged with the intent |

> In a marketplace install (Claude Code · Codex CLI · Gemini CLI) the format is `/cladding init "..."` — works the same with free text *and* with paths like `/cladding init docs/plan.md`.

### Init once, then carry on

cladding's goal is to *be the infrastructure that prevents spec ↔ code drift* — after init, you just keep coding. The AI references the spec while it writes, and `clad check` runs automatically in CI or as a pre-commit hook to block anything that drifts. No extra commands to remember.

<!-- ─────────────── Status ─────────────── -->
## Status

<table style="margin:0 auto;border:none">
<tr style="border:none">
<td style="text-align:center;width:140px;background:#f8fafc;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#64748b;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">version</div>
<div style="font-size:24px;font-weight:800;color:#0f172a;margin:8px 0;letter-spacing:-0.5px">v0.3.60</div>
<div style="font-size:11px;color:#64748b">2026-05</div>
</td>
<td style="text-align:center;width:140px;background:#dcfce7;padding:18px 10px;border-radius:8px;border:none">
<div style="font-size:11px;color:#15803d;letter-spacing:1.5px;text-transform:uppercase;font-weight:600">conformance</div>
<div style="font-size:24px;font-weight:800;color:#16a34a;margin:8px 0;letter-spacing:-0.5px">L4</div>
<div style="font-size:11px;color:#15803d">top tier · self-declared</div>
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
<div style="font-size:11px;color:#64748b">spec'd</div>
</td>
</tr>
</table>

<sub>100 test files · installable from the Claude Code · OpenAI Codex · Gemini CLI marketplaces.</sub>

> **Road to Ironclad 1.0** — 1.0 locks when *two independent implementations pass the L4 conformance fixtures* ([GOVERNANCE § 1](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md)). cladding is the first one.

## Docs

- [Why cladding (project context)](docs/project-context.md)
- [4-tier governance model](docs/ssot-model.md)
- [Hash-based feature IDs](docs/spec-ids-multi-dev.md)
- [28 detector catalog](src/stages/detectors/README.md)
- [Benchmark — event store trap catch](docs/benchmarks/event-store-trap-catch.md)
- [A/B evaluation cases](docs/ab-evaluation/)
- [Governance · roadmap to 1.0](GOVERNANCE.md)

## License

MIT. [LICENSE](LICENSE) · Related: [Ironclad](https://github.com/qwerfunch/ironclad) (the standard cladding implements) · [harness-boot](https://github.com/qwerfunch/harness-boot) (the seed project).
