---
project: cladding
component: agents
ironclad-track: T9 (multi-agent orchestrator)
---

# agents

## [CLAIM]

The 5 agent personas — orchestrator · librarian · reviewer · observability · specialists — each shipped as a Claude Code subagent (frontmatter + system prompt). Their canonical source lives in this directory; `npm run build:plugin` mirrors them into `agents/`, `plugins/codex/skills/`, and `plugins/gemini-cli/commands/`.

## [PERSONAS]

| name | role | tools | reads | writes |
|---|---|---|---|---|
| `orchestrator` | Workflow conductor; routes intent to specialists | Read, Write, Edit, Bash, Agent | spec, code, evidence | (delegates only) |
| `librarian` | SSoT custodian; spec.yaml + EARS hygiene | Read, Write, Edit, Bash | spec | spec.yaml, spec/** |
| `reviewer` | Philosophical guardrails; independent audit | Read, Bash | code, spec, evidence | (none — audit only) |
| `observability` | Log + metrics analyst | Read, Bash | audit log, perf, coverage | (reports only) |
| `specialists` | Domain implementer (code, tests, migrations) | Read, Write, Edit, Bash | spec, code | stages/, tests/, hitl/ |

## [INVOCATION_PRINCIPLES]

Per `orchestrator.md`:

1. **Specialization** — pick the narrowest agent for the task
2. **Audit separation** — implementer ≠ verifier
3. **Parallelism** — concurrent dispatch when write sets don't overlap
4. **Evidence-first** — refuse stage advance without prior-stage evidence
5. **Least context** — forward tagged guardrails + relevant modules, never the whole spec

## [HAND_OFF_CONTRACT]

Each delegation carries:
- `feature_id` and the **subset** of spec that mentions it
- The currently failing Iron Law stage's `StageResult` (if any)
- The audit-log slice for that feature

## [BOUNDARIES]

Cross-boundary rules:
- `librarian` never touches `src/stages/` · `src/hitl/` · production code
- `reviewer` never writes anywhere (read-only by design)
- `specialists` never edits `spec.yaml` (file for `librarian` instead)
- `observability` never invents metrics (only aggregates existing artifacts)
- `orchestrator` only delegates; it implements nothing

## [DONE_SINCE_T9]

- LLM-assisted CONVENTION_DRIFT detector — landed at `src/stages/detectors/convention-drift.ts`. Reads the observed `docs/conventions.md` and emits `warn`/`error` findings on style deviation.
- UNTESTED_AC detector that resolves `test_refs` to real vitest names — landed at `src/stages/detectors/untested-ac.ts`.
- Per-artifact LLM refinement (v0.3.33–35) and `sentinel_miss` telemetry (v0.3.39) plus the `clad doctor` consumer (v0.3.40) — `observability` now owns the sentinel-miss summary surface.

## [TBD]

- Routing config (`src/agents/routing.yaml`) with intent → agent mapping. `commands/clad.md` is the single user-facing verb manifest today; per-verb skills live under `skills/<verb>/SKILL.md` (auto-mirrored to `commands/<verb>.md`, `plugins/codex/skills/<verb>.md`, `plugins/gemini-cli/commands/<verb>.md`).
