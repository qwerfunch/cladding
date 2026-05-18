# Sample 01 — Todo CLI (Simple)

> Hand the same prompt body — *verbatim from the next section* — to all three modes (vanilla / harness / cladding). The agent works autonomously inside the 30-minute time-box.

## Prompt body

You are building a small command-line todo list in TypeScript. Before writing any feature code, set up the project: `npm init -y`, a `tsconfig.json` with strict mode and Node target, and `vitest` as the test runner.

Then implement the following commands. The CLI entrypoint is `bin/todo` (a Node shim) which dispatches via `commander` (or equivalent). Persistence: a single JSON file at `.todo.json` in the cwd.

## Acceptance criteria

| id | EARS | sentence |
|---|---|---|
| AC-1 | ubiquitous | The system shall persist tasks to a single JSON file in the current working directory. |
| AC-2 | event | When the user runs `todo add "<text>"`, the system shall append a new task with an auto-generated numeric id, the given text, and `done: false`. |
| AC-3 | event | When the user runs `todo list`, the system shall print one line per task in id order, with a `[ ]` or `[x]` marker. |
| AC-4 | event | When the user runs `todo done <id>`, the system shall mark the matching task `done: true` and persist the change. |
| AC-5 | event | When the user runs `todo delete <id>`, the system shall remove the matching task and persist the change. |

## Constraints

- All five commands must be covered by at least one vitest test that runs against a temporary `cwd` (not the repo root).
- `tsc --noEmit` must exit 0.
- `eslint .` must exit 0 (any reasonable config is fine).
- No external runtime dependencies beyond `commander` (or its equivalent) and Node stdlib. (`vitest` and types are dev-only.)

## Time-box

30 minutes from the start of the first prompt. Stop and submit whatever exists at the cap.
