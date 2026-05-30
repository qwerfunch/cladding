# Spec → Code → Tests — the multi-agent orchestration recipe

The deterministic playbook the **orchestrator** conducts to drive a feature from spec to
done. It is genuine multi-**agent** execution: separate, independent agent contexts (the
`cladding:*` host subagents) running concurrently — not one model swapping persona prompts.
That independence is what makes audit separation and adversarial review *real* rather than
nominal.

**Core invariant — agents propose, deterministic gates dispose.** Every `▣` barrier is a
cladding gate (`clad sync`, `clad check`), which is synchronous, LLM-free, and deterministic.
The only non-deterministic part is what the agents *propose*; what *ships* is decided by the
gates. Never advance a phase on an agent's say-so alone, and never skip a `▣`.

Run it with the host's `Agent` tool, using the `Workflow` engine for the fan-out steps and a
separate **git worktree** per concurrent unit so parallel writes never collide.

## Phases

1. **SPEC — `librarian`.** Author/validate each feature shard (`acceptance_criteria` with
   `test_refs`, scenarios, `modules`). One `librarian` per feature; hash ids make concurrent
   `clad_create_feature` collision-free (Principle 3).
   - ▣ **Barrier:** `clad sync` (schema) **and** `clad check --tier=pre-commit` (AC_DRIFT,
     ID_COLLISION, ABSENCE_OF_GOVERNANCE). **No implementation before this is green —
     spec-first is a hard gate, not a suggestion.**

2. **PLAN — orchestrator.** Read the validated spec, resolve the `depends_on` DAG, cut it into
   independent work-units (no shared `modules` ⇒ no write overlap). Independent units fan out
   concurrently (Principle 3); dependent ones serialize.

3. **IMPLEMENT — `specialists` (code).** One implementer per unit writes production code in its
   own worktree. `clad checkpoint <featureId>` before each so a failed unit rolls back cleanly.

4. **TEST — independent author.** A *separate* `specialists` dispatch — handed the feature's
   `acceptance_criteria` **only** (never the implementation) — authors the acceptance tests bound
   to each AC's `test_refs`. The code-dispatch and the test-dispatch are independent agent
   contexts (the recipe never routes both to one dispatch), which makes Principle 2 (audit
   separation) **structural** — the tests encode the spec, not the code. A dedicated `test-author`
   persona is a future option; the separate-dispatch contract delivers the same independence now.
   - ▣ **Barrier:** `clad check --tier=pre-push --strict` — type / lint / unit / cov **and**
     drift (MISSING_IMPLEMENTATION, UNTESTED_AC, MISSING_TESTS, STATUS_DRIFT). Zero
     error-severity ⇒ proceed; otherwise loop back to 3/4 until green (loop-until-green).

5. **REVIEW — `reviewer` (multi-lens, parallel).** Fan out one read-only `reviewer` per lens
   (correctness · spec-conformance · security · performance), each an independent context. Each
   judges code+tests against the ACs and returns its `{passes, violations}` verdict.
   - ▣ **Barrier:** reviewer **consensus** (≥ majority `passes`) **and** the step-4 gate still
     green. A reviewer that implemented or tested the unit may not clear it (Principle 2).

6. **EVIDENCE + DONE — `observability`.** Record per-AC evidence to `.cladding/audit.log.jsonl`;
   flip `status: done` **only now**. The sign-off identity must differ from every implementer
   (an independent agent, or a human at L4 / UAT) — `clad check --tier=all` re-checks
   anti-self-cert (stage_4.1) and UAT (stage_4.2).

## Fan-out vs barrier at a glance

| Parallel (fan-out) | Barrier (synchronize) |
|---|---|
| SPEC per feature · IMPLEMENT∥TEST per independent unit (code and test are *different* agents) · REVIEW per lens | spec-valid (1▣) · gate-green (4▣) · review-consensus + done (5▣/6) |

## Parallel execution & isolation

Independent units (no shared `modules` in the `depends_on` DAG) fan out concurrently; dependent
units serialize. The DAG — not an agent — decides what may run together. Isolation rules so
parallel writes never corrupt each other:

- **One git worktree per unit.** Run a unit's IMPLEMENT∥TEST inside its own worktree
  (`git worktree add`) so concurrent code/test writes touch disjoint trees.
- **Checkpoint before, rollback on fail.** `clad checkpoint <featureId>` pins HEAD + the spec
  digest before a unit starts; if its gate (step 4 ▣) fails past the retry budget,
  `clad rollback <featureId>` discards that unit cleanly — siblings are untouched.
- **Merge on green only.** Merge a unit back to the integration branch after its local
  type / lint / unit pass; the final ▣ (`clad check --strict`) runs on the *merged* tree so
  cross-unit drift (a module two units both touched, a broken integration) is caught.
- **Concurrency cap.** Fan out at most what the host engine schedules at once.
- **Evidence under concurrency.** Each unit's dispatches record their own audit entries; the
  integration gate is the authority on "done", so a mid-flight audit interleave never decides
  completion. (Until per-worktree audit logs land, treat the merge barrier as the evidence
  reconciliation point.)

## Execution surface

- **Host-engine (in-session, the supported path):** the host (Claude Code) authors files with
  its own Write/Edit when it embodies `cladding:specialists`; cladding's transports are not
  involved. cladding owns the recipe + the gates; the host owns the parallel execution engine.
- **Headless `clad drive`:** a sequential reference loop. Its transports do **not** yet author
  code (the tool-use/mutation protocol is unbuilt — see `src/adapters/host/transport.ts`), so a
  no-real-dispatch run is honestly degraded, never reported as success. Autonomous headless
  authoring is a separate, deferred track.
