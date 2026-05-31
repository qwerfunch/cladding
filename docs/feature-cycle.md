# The feature cycle — one feature's lifecycle (spec → code → test → gate → done)

The loop the **orchestrator** runs to take **ONE** feature from spec to done, then start the
next. It is genuine multi-**agent** execution: separate, independent agent contexts (the
`cladding:*` host subagents) — not one model swapping persona prompts. That independence is what
makes audit separation and adversarial review *real* rather than nominal.

**Core invariant — agents propose, deterministic gates dispose.** Every `▣` barrier is a cladding
gate (`clad sync`, `clad check`), synchronous, LLM-free, deterministic. The only non-deterministic
part is what the agents *propose*; what *ships* the gate decides. Never advance on an agent's
say-so alone, never skip a `▣`.

> **One feature at a time.** Do NOT author all feature shards up front and implement them in a
> batch — that races the spec ahead of the code and breaks the spec↔code↔test lockstep cladding
> exists to keep. Run the cycle below for ONE feature to `done`, *then* the next. (Enforced by the
> `PLANNED_BACKLOG` drift detector: too many `planned` features with no code on disk fails the gate
> under `--strict`.)

## The cycle (one feature; repeat)

1. **SPEC — `librarian`.** Author *this* feature's shard now: `acceptance_criteria` (with
   `test_refs`) + the `modules` you're about to build + any scenario it needs — in one
   `clad_create_feature` call (the tool takes ACs/modules). Not the whole backlog; just the feature
   you're about to build.
   - ▣ **Barrier:** `clad sync` — the shard itself must be valid (schema, EARS shape, consistent
     inventory) before any code. **Spec-first is the hard rule:** you author the shard *before* the
     code, and no code that no feature claims may land (`UNMAPPED_ARTIFACT` blocks that at step 3's
     gate). Run the *full* detector suite (`clad check`) at step 3, not here — the spec-vs-code
     detectors (MISSING_IMPLEMENTATION, UNTESTED_AC) are status-blind and would fire on a shard
     whose `modules` you've declared but not yet built. Declaring `modules` now is the binding step
     3 verifies, not a promise to check before you've written them.

2. **IMPLEMENT — `specialists` (code).** One implementer writes the production code for this
   feature in its own worktree. `clad checkpoint <featureId>` first so a failed cycle rolls back.

3. **TEST — independent author.** A *separate* `specialists` dispatch — handed the feature's
   `acceptance_criteria` **only** (never the implementation) — authors the acceptance tests bound
   to each AC's `test_refs`. Implementer ≠ test-author = independent contexts → Principle 2 (audit
   separation) is **structural**: the tests encode the spec, not the code.
   - ▣ **Barrier:** `clad check --tier=pre-push --strict` — type / lint / unit / cov **and** drift
     (MISSING_IMPLEMENTATION, UNTESTED_AC, MISSING_TESTS, STATUS_DRIFT). Zero error-severity ⇒
     proceed; else loop back to 2/3 until green.

4. **REVIEW — `reviewer` (multi-lens, parallel).** Fan out one read-only `reviewer` per lens
   (correctness · spec-conformance · security · performance), each an independent context, judging
   code+tests against the ACs → `{passes, violations}`.
   - ▣ **Barrier:** reviewer **consensus** (≥ majority `passes`) **and** the step-3 gate still
     green. A reviewer that implemented or tested the feature may not clear it.

5. **DONE — `observability`.** Record per-AC evidence to `.cladding/audit.log.jsonl`, then flip
   the feature to done with **`clad done <featureId>`** — it re-runs the pre-push strict gate with
   the feature evaluated as done and writes `status: done` **only if that gate is GREEN**, reverting
   otherwise. Do not hand-write `status: done`: the verb is what keeps "done" from claiming more than
   the gate verifies. `clad sync` keeps the inventory honest. Sign-off identity ≠ any implementer
   (independent agent, or a human at L4 / UAT). **Then start the next feature's cycle.**

## Parallelism = N concurrent instances of this same cycle

When several features are independent (no shared `modules`, and `depends_on` already `done`), run
the **same one-feature cycle** for each in parallel — one git worktree per feature. This is fan-out
of the cycle, **not** a global "spec everything, then implement everything" phase. The `depends_on`
DAG — not an agent — decides what may run together; a dependent feature's spec never races ahead of
its dependency's code.

## Mode × how cladding drives (same cycle, only granularity/autonomy differ)

| Host mode | WIP ahead of green code | who fires the next cycle |
|---|---|---|
| conversational → multi-feature | 1 (wider only across *independent* DAG units) | host; user between cycles |
| prompt → ONE feature | 1 | single pass |
| `/goal` → autonomous | 1 (N for independent units) | host self-loops to the goal |
| headless `clad drive` | 1 (`nextReady` already does this) | the loop |

The cycle steps are **byte-identical across modes** — no mode-specific control-flow. The
always-loaded CLAUDE.md states the cadence so the host structures its own plan around it, and the
gate judges filesystem truth in every mode, so a misclassification only changes WIP *intent* — the
gate still blocks a too-wide batch (fails safe).

## Parallel execution & isolation

- **One git worktree per feature.** Run a feature's IMPLEMENT/TEST inside its own worktree
  (`git worktree add`) so concurrent writes touch disjoint trees.
- **Checkpoint before, rollback on fail.** `clad checkpoint <featureId>` pins HEAD + the spec
  digest before a cycle starts; if its gate fails past the retry budget, `clad rollback <featureId>`
  discards that feature cleanly — siblings untouched.
- **Merge on green only.** Merge a feature back after its local type/lint/unit pass; the final
  `clad check --strict` runs on the *merged* tree so cross-feature drift is caught.
- **Concurrency cap.** Fan out at most what the host engine schedules at once.
- **Evidence under concurrency.** Each cycle records its own audit entries; the integration gate is
  the authority on "done", so a mid-flight interleave never decides completion.

## Execution surface

- **Host-engine (in-session, the supported path):** the host (Claude Code) authors files with its
  own Write/Edit when it embodies `cladding:specialists`; cladding owns the cycle + the gates, the
  host owns the parallel execution engine.
- **Headless `clad drive`:** a sequential reference loop — `nextReady` already drives ONE feature at
  a time. Its transports do **not** yet author code (the tool-use/mutation protocol is unbuilt), so
  a no-real-dispatch run is honestly degraded, never reported as success.
