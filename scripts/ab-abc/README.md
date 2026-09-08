# A/B/C campaign harness — 0.9.4 vs 0.10.0

Runs the release-evidence campaign for 0.10.0: three arms on the identical task,
scored only on what each run leaves behind. The pre-registration — hypotheses,
decision rules, and what a null result buys — lives in
`docs/ab-evaluation/case-version-abc-094-vs-0100.md`. Read that first; this file
is the operating manual.

## Arms

| | Engine | Setup | What it isolates |
|---|---|---|---|
| **A** | none | a `clad` stub that logs every call and exits 127 | the model alone, and a contamination detector |
| **B** | `cladding@0.9.4` from the registry | `clad init --no-llm` (schema 0.1) + `clad setup --host claude` | the released engine |
| **C** | 0.10.0 packed from this checkout | `clad init --schema 0.2 --no-llm` + `clad setup --host claude` | the release candidate |

Every arm gets the same template, the same `TASK.md`, the same prompt bytes, and
the same host flags. Neither the prompt nor the task mentions cladding, a version,
or that a comparison is running. Arm A's stub is deliberate: without it a run with
no engine and a run where the agent quietly reached for a globally installed one
look the same on paper.

## Safety rules

- **Sequential, always.** `run-cell.sh` takes a lock in `ABC_ROOT` and refuses to
  start while another cell holds it. There is no watch loop and no parallel mode:
  a previous campaign lost its wall-clock numbers to a driver that resurrected
  itself and ran cells concurrently.
- **Budget before spending.** `budget.json` carries a cumulative total and a
  campaign cap (default $40). The check runs *before* the host is spawned and the
  ledger is updated immediately after, so a crash can only under-count by the run
  that crashed. Each cell also carries its own `--max-budget-usd` (default $6).
- **Fixtures live outside the repo.** Everything is under `ABC_ROOT`
  (default `~/abc-0100`). Nothing the campaign runs writes into this checkout.
- **Costs are estimates.** `total_cost_usd` is the host's list-price estimate for
  an OAuth session. It is not an amount billed, and every table that reports it
  says so.

## Running it

```bash
export ABC_ROOT=~/abc-0100

bash scripts/ab-abc/freeze.sh                     # pack C, install B, hash both
npx tsx scripts/ab-abc/sidetable.ts --bootstrap   # build the side-table fixtures
npx tsx scripts/ab-abc/sidetable.ts               # deterministic rows, no agent

bash scripts/ab-abc/make-cell.sh A pilot1         # then B pilot1, then C pilot1
bash scripts/ab-abc/run-cell.sh  A pilot1         # one at a time
npx tsx scripts/ab-abc/render.ts "$ABC_ROOT/results" --out "$ABC_ROOT/results/report.md"
```

The deterministic side-table runs first on purpose. It costs nothing, and a row
that comes back wrong is a reason to fix the engine and re-pack *before* spending
anything on live cells.

`ABC_TASK=task2.md` builds a cell around the second, smaller feature, and
`ABC_FROM=<arm>/<cell>` seeds a cell from a **finished** one instead of the
template — the continuation case, where a second feature lands in a workspace
that already completed one. The whole tree comes across, git history and harness
state included, `node_modules` is symlinked rather than copied, and anything the
source cell left uncommitted is committed so the new baseline is again a clean
HEAD.

`make-trap-cell.sh <arm>` builds a different kind of cell: the module is written,
the tests pass, the feature is open — and only the *binding* is broken. Arm B's
shard has its `test_refs` emptied; arm C's covers tokens sit at the END of each
title, where they look bound to a human and are invisible to the engine; arm A
has no spec at all. The agent is told the feature is implemented and tested and
asked to finish it. A run that completes without repairing the binding has
claimed something it did not establish.

`make-done-fixture.sh <arm>` builds the side-table's completed-feature fixture
with no agent at all: template → init → a feature created through the MCP tool →
module and bound tests → sync → strict pre-push → completion, with the completion
output captured verbatim (that capture *is* row L0-5). `sidetable.ts --bootstrap`
calls it for both arms.

`make-done-fixture.sh C --stop-before-done` builds the same project one step
short of completion, raises it to L4 inside its cycle, and adds the project-owned
`smoke`, `perf` and `visual` scripts an L4 profile calls. Without those three the
stages skip, and a skipped stage is an unobserved obligation — the L4 row would
then fail for a missing runner rather than for a missing receipt. The L4 row runs
the completion itself, which is what publishes the L4 attestation row.

**Bash 3.2.** The stock macOS shell is bash 3.2, so nothing here uses `mapfile`,
associative arrays, or the other bash-4 conveniences. Where a helper reads one
line of a pipeline it uses `sed -n 1p` rather than `head -1`, because `head`
closes the pipe early and the writer then dies of EPIPE mid-fixture.

## What gets measured

Everything is deterministic and computed after the session ends. `run-cell.sh`
runs a **measurement pass** inside the arm's own fixture — `tsc`, ESLint, a JUnit
test run, a coverage run, and the hidden oracle — and `score.ts` turns those
artifacts, the harness event log, the workspace files and git into one
`score.json`. The transcript's prose is never read or scored.

**1 · What the arm produced — code** (`src/**`): `loc_src` (code lines, blanks
and comment lines excluded), `lint_errors` / `lint_warnings`, `tsc_clean`,
`complexity_max` / `complexity_mean`, `any_count`, `api_conformance` (is
`slugify` exported, does its signature match the brief, is `EmptySlugError` a
real `Error` subclass), `error_class_named`, `comment_density` with the JSDoc
block count beside it, `header_comment_present`, and `files_outside_scope`
(changes outside `src/` and `tests/`).

**2 · What the arm produced — tests** (`tests/**`): `test_count` from the JUnit
report, `assertion_count`, `ac_titled` (which acceptance criteria are named in a
test title — the one habit the brief asks of every arm), `negative_test_present`,
`skip_or_only`, `coverage_lines_pct` from `coverage-summary.json`, and
`blind_oracle_pass`.

**3 · Development time**: `duration_ms` and `duration_api_ms` from the host,
`wall_ms` measured by the driver around the call, `num_turns`,
`time_to_first_edit_ms` (from the session's start to the first Write/Edit), and
two ordinals — which tool call first reached for a gate, and which gate run
first came back green.

**4 · Tokens**: input, output, cache read, cache creation, thinking, their total
and the cache-read ratio, `total_cost_usd`, the per-model split, and
`static_instruction_tokens` — an estimate of the standing instruction bytes each
arm injects (`prompt.txt` plus any `AGENTS.md` / `CLAUDE.md` its setup wrote).
That last one is how much context an arm spends before doing anything.

**5 · Friction, gates, spec artifacts**: `tool_calls_total` / `tool_calls_mcp` /
`tool_errors` / `permission_denials`, `gate_runs` and `gate_red_then_green` (an
honest red that later became green), `git_commits` with their messages,
`worktree_clean_at_end`, `spec_artifacts` (shards, criteria, how many carry a
statement, an `ears` field, or test refs), the judge's exit and its findings
counted per detector and severity, and `scorer_reproducible` — the driver scores
each cell twice and records whether the two results are byte-identical.

### The judge

The arm's **own** engine re-runs `check --tier=pre-push --strict --json` after
the session, so a claim of completion is never taken on the agent's word. Arm A
has no engine, so its judgement is the same fixture's `npm test` and
`npx tsc --noEmit`, plus whether the acceptance criteria are named in the test
titles.

### The hidden oracle

`oracle/slugify.oracle.test.ts` is written before the campaign and is never in
any arm's fixture: the driver copies it in after the session, runs it once,
records pass and total, and deletes it. It reaches past the three stated criteria
— trailing separators, idempotence, decomposed Unicode — because it asks what an
arm *built*, not whether it satisfied the brief it read. It imports `slugify`
alone and checks the error by name, so an arm that keeps its error type private
is not penalised for a choice nobody constrained.

**This axis is pre-registered as reported-only.** Four prior campaigns found
correctness orthogonal to the harness. Whatever the oracle says, it is published
and it does not feed the release verdict. The same holds for the whole
code-quality group.

### How complexity is counted

Not with ESLint. The `complexity` rule needs a TypeScript parser, and the fixture
deliberately ships a bare ESLint config so `npm run lint` means the same trivial
thing in all three arms — adding a parser to measure the arms would change what
the arms were asked to do. So `score.ts` states its own count instead: one per
function, plus one for each `if`, `for`, `while`, `case`, `catch`, `&&`, `||`,
`??` and `?:` in its body, with bodies found by brace matching. It is a coarse
measure for comparing three implementations of one small module, never a
pass/fail. For the same reason `lint_errors` will usually be zero: it records
that the fixture's own lint stayed quiet, nothing more.

### The rubric that is not run

`judge.sh` would build an arm-blinded snapshot of `src/` and `tests/` and ask a
separate model to score readability, error handling and test design out of five.
It is **secondary and not part of the campaign**: model-graded, non-deterministic,
roughly $0.10 per cell. It refuses to run without `ABC_JUDGE_CONFIRM=yes-spend`.
It exists so its absence is a recorded decision rather than an oversight.

## Disqualifiers

`score.json` records these; a disqualified cell is kept as evidence and excluded
from the statistics by hand.

- an error result, or a subtype other than success (this is also how a
  budget-capped run appears — kept, because it is the evidence R2 asks for)
- arm A: the stub was called, or a Bash command reached for the engine directly
- arm B/C: the launcher's engine path falls outside the arm's prefix
- **a cladding tool call was denied** — the arm was prevented from using the very
  thing under test
- **models other than the primary carried more than a tenth of the cost** — at
  that point the cell is no longer a measurement of the model it names

Two candidate rules were deliberately **not** adopted, because the reference host
run showed each would disqualify every cell for reasons unrelated to the engine.
A second model appearing in `modelUsage` at all is the host's own auxiliary work
(the reference run showed two models with zero subagents spawned); it is reported
as `secondaryModelCostUsd` instead. And an ordinary permission denial is recorded
as friction, with the denied tools named, rather than thrown away. Host
permissions are the same for all three arms and deliberately wide —
`--permission-mode acceptEdits` with an ordinary shell allowed — because a cell
denied `mkdir` would be measuring the allow-list. Bypassing the permission system
itself is not allowed in any arm.

## The deterministic side-table

`expectations.yaml` holds the L0/L3 rows. Four fixture families are kept apart:

- **shared-0.1** — one schema-0.1 workspace driven by *both* engines, carrying one
  feature created once by the released engine so both arms read identical bytes.
  A difference here is a back-compatibility change. A row names that feature by
  writing `{shared_feature}` in a tool argument; the runner substitutes the id the
  bootstrap recorded.
- **per-version-init** — each engine scaffolds its own default from the identical
  template. A difference here is the intended 0.2 delta.
- **done** — that project carried to completion by the arm's own engine.
- **inprogress** — the same project stopped one step short of completion and
  raised to L4, carrying the project-owned smoke, performance and visual runners
  an L4 profile calls for. Two rows use it: the L4 replay, and the same replay
  with the independence policy turned up.

Every row carries a pre-registered `expect`, and **the expectation is itself
under test**. A run fills `observed`; a human then marks each row `match`,
`defect-fixed` (something had to be repaired before the row could be believed),
`expectation-wrong` (the engine is fine, the guess was not), `designed` (a
deliberate 0.2 change, named in the case document before the fact), or `record`
(the row exists to write down what each engine says). While the file says
`status: unlocked` a mismatch is a finding to classify, never a blocker.

Once every row is classified, flip the file to `locked`. That is not a label: each
row must then also carry a `lock:` map — one entry per `<step>-<arm>` pinning the
exit code, plus the byte count and the literal strings the output must still
carry wherever the substance is in the output rather than the exit. `sidetable.ts`
compares every pin against what it just saw, names each difference in the verdict
column and in `results/sidetable-mismatches.txt`, and exits non-zero. A locked row
that pins nothing, or carries no classification, is itself a mismatch — locking a
row without pinning anything would make the gate vacuous, which is the failure
mode this campaign exists to avoid. Pinned literals are matched against the
artifact's own bytes, so a string that lands inside a JSON payload is pinned in
its escaped form.

`sidetable.ts --only L0-1,L0-4` re-runs a few rows and carries the rest of the
table forward from the previous run, so a targeted re-run never blanks the record
of the rows it did not touch.

Every row runs automatically. The ones that need a project which has actually
finished something use the `done` fixture; the ones that need deliberate damage
name a **mutation** — `strip-module-header`, `covers-token-trailing`,
`require-independence`, `vacuous-green` — so a reader can see what was broken
without reading code, and each mutation is applied to that row's own fresh
workspace so it cannot leak. Four rows are shell scripts of their own, because
they are sequences rather than single calls: the migration (preview, reject,
accept, gate), the stale typed edit, the L4 replay, and the refused L4 cycle. The
last two need `expect` for the interactive signing prompts and record *not run* if
it is absent, rather than guessing. The refused cycle is `row-l4.sh` again with
`ABC_L4_POLICY=require`: same fixture, same signing, and the completion must be
turned down with a refusal that names a registered issuer as the remedy. It
checks the mutation is visible in the workspace's own `spec.yaml` before it
measures anything, and fails the row rather than passing quietly if the
completion succeeds — a policy that never landed and a policy with nothing to
refuse look identical from the outside.

The runner prints each arm's engine path and version before it records anything:
which engine is which is the one thing this table cannot afford to get wrong.

## Files

| File | Role |
|---|---|
| `freeze.sh` | build + pack C, install B, verify versions and dist hashes, open the ledger |
| `make-cell.sh` | build one cell's fixture; the only place the arms differ |
| `run-cell.sh` | budget check → one live session → artifacts → judge → score |
| `budget.mjs` | the cumulative ledger: `check` before, `record` after |
| `score.ts` | one cell's artifacts → `score.json` |
| `render.ts` | `score.json[]` + `sidetable.json` → markdown tables |
| `sidetable.ts` | the agent-free L0/L3 runner and its fixture bootstrap |
| `expectations.yaml` | the side-table rows, their expectations, and the lock |
| `mcp-client.mjs` | stdio MCP client for rows that must exercise the tool surface |
| `oracle/` | the hidden oracle, copied into a cell only after it has finished |
| `lib-fixture.sh` | the shared fixture steps: seed, init, create a feature, bind or unbind |
| `make-done-fixture.sh` | a completed feature, built with no agent — the side-table's hardest input |
| `make-trap-cell.sh` | the completion-claim trap cell, plus `prompt-trap.txt` |
| `write-tests.mjs` | generates the fixture's tests with the binding a row asks for |
| `row-migrate.sh` | the migration row: preview, reject, accept, then the strict gate |
| `row-stale-edit.sh` | the stale typed-edit row |
| `row-l4.sh` | the L4 replay row, driving the signing prompts through `expect`; `ABC_L4_POLICY=require` switches it to the refusal case |
| `row-l4-require.sh` | that switch, as the row's own entry point: a self-signed L4 cycle must be refused |
| `judge.sh` | the blinded model rubric — secondary, and not run |
| `template/` | the fixture every arm starts from (no `node_modules`; `npm ci` fills it) |
| `prompt.txt`, `task.md`, `task2.md` | the bytes every arm receives |

Catalogue bytes: `mcp-client.mjs` reports the pretty-printed whole result (158 700 B on 0.10.0) and, inside it, a compact `tools/list` slice of 60 135 B; neither is the release pin, which is `npm run validate:spec-0.2`'s compact `stableJson({tools, resources, prompts})` at 140 498 B over the same 27 tools.
