---
project: cladding
component: agents
ironclad-track: T9 (multi-agent orchestrator)
---

# agents

## [CLAIM]

The 5 agent personas from `ironclad-design/14-agent-orchestration.md`, each shipped as a Claude Code subagent (frontmatter + system prompt).

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

## [TBD]

- Routing config (`src/agents/routing.yaml`) with intent → agent mapping — folded into `commands/work.md` in v0.1
- LLM-assisted CONVENTION_DRIFT detector — lives behind `reviewer` (T9b · L16)
- UNTESTED_AC detector that resolves `test_refs` to real vitest names — lives behind `specialists` (T9b · L16)
