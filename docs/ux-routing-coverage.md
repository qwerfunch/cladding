---
title: 03-ux-routing.md applied-status report
audience: cladding maintainers · external auditors
applies_to: cladding's user-facing surface
upstream_ssot: https://github.com/qwerfunch/harness-boot/blob/main/ironclad-design/03-ux-routing.md
---

# UX routing coverage

`ironclad-design/03-ux-routing.md` prescribes how the user surface of any Ironclad implementation should behave. This page is the honest tally of how much of that prescription cladding implements today, where each piece lives in the code, and where the remainder lands on the roadmap. Update this page in the same patch that changes the underlying behavior — drift between this page and the code is itself a violation of Iron Core ↔ Soft Shell discipline.

## 12 prescriptions

| # | Prescription | Status | Where (cladding) | Notes |
|---|---|---|---|---|
| P-01 | Iron Core (internal strict IDs / commands) vs Soft Shell (external business language) boundary | partial | `src/ui/softShell.ts` (formatter), `src/router/intent.ts:3` (boundary comment) | The split now exists as a code layer, not just an aspiration. |
| P-02 | Ban on user-facing `F-NNN` / `AC-N` | partial | `src/ui/panel.ts` default view (`renderPanel(spec)` hides ids), `src/cli/clad.ts drive` default (`haltMessage` instead of JSON) | `--internal` / `--json` flags surface the raw view; agents/*.md carry the "user-facing language" guideline. Audit log keeps raw ids. |
| P-03 | 3-path intent (Contextual Inquiry · Implementation Loop · Strategic Orchestration) | not yet | `src/router/intent.ts` maps to 5 verbs (init/work/drive/sync/check), not 3 paths | Requires a mode state machine; queued for v0.2.0+. |
| P-04 | JIT reverse sync (only at intentional breakpoints) | not yet | — | Requires a watcher and a confirmation gate; v0.2.0+. |
| P-05 | Natural-language choice-based remediation | partial | `src/ui/softShell.ts` `haltMessage` returns a sentence; user can read and decide | Full choice menus (e.g. "sync code to spec / replan to match code / approve as intentional") land with the L4 remediation flow in v0.2.0+. |
| P-06 | Soft Shell choice → Iron Core command deterministic mapping | partial | `src/router/intent.ts` (NL → verb) is deterministic; choice-based mapping pending P-05 | — |
| P-07 | Pulse UI silent-success status bar | partial | `src/ui/pulse.ts` exists, line-by-line emission | The animated single-line `[●○○] Analyzing...` form is queued; current shape is functional but not yet that compact dynamic bar. |
| P-08 | Manual mode → Supervised routing demotion | not yet | — | Manual/Auto mode itself does not exist yet. v0.2.0+. |
| P-09 | Manual mode → real-time drift detection | not yet | — | Depends on P-08. |
| P-10 | Manual mode → pre-write confirmation gate | not yet | — | Depends on P-08. |
| P-11 | Non-LLM intent classification (deterministic, rule-based) | applied | `src/router/intent.ts:1-78` (regex rules, bilingual) | Zero LLM dependency in the routing layer; this is the strongest applied-prescription today. |
| P-12 | Senior partner mental model (not police) | partial | `src/agents/orchestrator.md` "Routing table" + "5 invocation principles" | A documented stance; behaviour reinforcement (proactive suggestions instead of demands) lands with P-04 / P-05. |

**Tally**: applied 1 · partial 6 · not yet 5. The v0.1.2 patch raised P-02, P-05, P-07, P-12 from "not yet" to "partial" by introducing the Soft Shell formatter, the default-business-title CLI output, and the per-persona "user-facing language" reminder.

## What unblocks the remaining items

- **P-03 · P-08 · P-09 · P-10** all depend on cladding gaining an explicit Manual vs Autonomous mode state machine. Once `clad work` enters Manual mode, drift-check cadence tightens (P-09), file writes pass a confirmation gate (P-10), and the agent's routing posture demotes from proactive to approval-waiting (P-08). The 3-path intent model (P-03) then layers on top, distinguishing inquiry from execution.
- **P-04** (JIT reverse sync) requires a side watcher that surfaces spec/code drift only at task boundaries — different from the always-on drift detectors which run inside the Iron Law gates. The implementation is small but the trigger heuristics deserve a dedicated patch.
- **P-05** (choice-based remediation) becomes meaningful once a gate failure is paired with one or more candidate remedy commands. The shapes (`sync --reverse` / `replan` / `heal --refs` / `prune --spec`) already exist as Iron Core verbs; what's missing is the user-facing decision menu.
- **P-07** Pulse UI animated bar — a small UI polish using `process.stdout.write` carriage returns. Worth bundling with the next user-visible patch.

## How to keep this page honest

Whenever you change a row from `partial` to `applied`, or from `not yet` to `partial`, do it in the same patch that ships the underlying behavior — never lag, never lead. If a reviewer finds this table claims more than the code delivers, the patch fails Iron Core ↔ Soft Shell discipline (the same kind of drift this very file is meant to surface for users).
