---
project: cladding
component: agents
ironclad-track: T9 (multi-agent orchestrator)
---

# agents

## [CLAIM]

The 6 agent personas — orchestrator · planner (formerly `librarian`) · reviewer · observability · developer (formerly `specialists`) · blind-author — each shipped as a Claude Code subagent (frontmatter + system prompt). Their canonical source lives in this directory; `npm run build:plugin` mirrors them into `plugins/claude-code/agents/`, `plugins/codex/skills/`, and `plugins/antigravity/skills/`.

## [PERSONAS]

Each persona's individual `.md` carries a "Sources (what you read, by Tier)" section that names the exact Tier slice it loads. See [`../../docs/ssot-model.md`](../../docs/ssot-model.md) for the 4-tier governance policy.

| name | role | tools | reads (by tier) | writes |
|---|---|---|---|---|
| `orchestrator` | Workflow conductor; routes intent to the right persona | Read, Write, Edit, Bash, Agent | B (project-context) + D (events.log, onboarding state) + A (dispatch slice) | (delegates only) |
| `planner` | Spec author-custodian; spec.yaml + EARS hygiene | Read, Write, Edit, Bash | A (write target) + B (cross-validate) | spec.yaml, spec/** |
| `reviewer` | Philosophical guardrails; independent audit | Read, Bash | A + B + C + D evidence | (none — audit only) |
| `observability` | Log + metrics analyst | Read, Bash | D only (events.log, audit.log, perf, coverage) | (reports only) |
| `developer` | Implementer (code, tests, migrations) | Read, Write, Edit, Bash | B (project-context, architecture, capabilities) + C (conventions) + A (current feature slice) | stages/, tests/, hitl/ |
| `blind-author` | Impl-blind test/oracle author (no Read/Grep/Glob/Edit by construction) | Write, Bash | A (acceptance criteria + module signatures only — never the implementation) | tests/ (conformance oracles) |

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
- `planner` never touches `src/stages/` · `src/hitl/` · production code
- `reviewer` never writes anywhere (read-only by design)
- `developer` never edits `spec.yaml` (file for `planner` instead)
- `observability` never invents metrics (only aggregates existing artifacts)
- `orchestrator` only delegates; it implements nothing

## [DONE_SINCE_T9]

- LLM-assisted CONVENTION_DRIFT detector — landed at `src/stages/detectors/convention-drift.ts`. Reads the observed `docs/conventions.md` and emits `warn`/`error` findings on style deviation.
- UNTESTED_AC detector that resolves `test_refs` to real vitest names — landed at `src/stages/detectors/untested-ac.ts`.
- Per-artifact LLM refinement (v0.3.33–35) and `sentinel_miss` telemetry (v0.3.39) plus the `clad doctor` consumer (v0.3.40) — `observability` now owns the sentinel-miss summary surface.

## [TBD]

- Routing config (`src/agents/routing.yaml`) with intent → agent mapping. Per-verb skills live under `skills/<verb>/SKILL.md`, auto-mirrored to `plugins/codex/skills/<verb>/` and `plugins/antigravity/skills/<verb>/` (Gemini receives only the init command as `plugins/gemini-cli/commands/init.toml`).
