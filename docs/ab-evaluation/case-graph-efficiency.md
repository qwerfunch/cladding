<!-- Cladding · Tier C · A/B: graph-retrieval EFFICIENCY (cost-to-correct) -->

# A/B (efficiency) — does graph retrieval cost LESS to reach a correct refactor?

**Question (the user's).** The two prior A/Bs measured *regression rate* (accuracy) and were
NULL — capable agents reached correct anyway. But retrieval **efficiency** is a different axis:
getting "these 11 regression tests + these 29 modules" handed over should cost *less* than
grepping a 1016-file repo and brute-running 1812 tests. Is it cheaper?

**Design (pre-registered).** Same real doverunner-vapt Severity str→IntEnum refactor (121
importers, 1812 tests). ARM A = grep, no cladding tools (natural behavior). ARM B = the
working-set/impact surfaced (3 owners + the curated 11 regression test_refs + 29-module
radius) telling it exactly what to run. Both run to a correct result; we compare cost.
Pre-registered primary = token ratio (<0.6 win / 0.6–1.2 tie / >1.2 refute). Pre-registered
falsifier: "ARM B hedges to the full 1812-test suite despite test_refs → efficiency negated."

**Measurement note (honest).** Per-agent token transcripts are auto-cleaned after a workflow
completes in this environment, so post-hoc token parsing was infeasible. We fell back to a
schema-forced **self-reported behavioral tally** (files read, greps, test commands, test
cases run, full-suite y/n), with `files_changed` cross-checked against `git diff` (matched:
24 / 26 — the self-report is trustworthy). Tokens are not directly measured; the behavioral
counts ARE the efficiency signal the question is about (search + test brute-force volume).

## Result — NULL, and slightly INVERTED (ARM B cost MORE)

Accuracy gate: both arms **0 regressions** (fixed 220-test Severity subset green) → cost
comparison valid.

| metric | ARM A (grep) | ARM B (graph surfaced) | winner |
|---|---|---|---|
| **test cases run** | 1,813 | **2,533** | A (B ran more) |
| test commands | 1 | 3 | A |
| grep searches | 24 | 30 | A |
| files read | 40 | 36 | ~tie (B −10%) |
| files changed | 24 | 26 | ~tie |
| **ran full 1812 suite?** | **yes** | **yes** | — |

ARM B was **not cheaper — it was marginally more expensive** on every cost axis except a
slight edge in files-read. The pre-registered token-ratio win (<0.6) is refuted; this is a
clear **falsifier hit**.

## Why — the surfaced test set was not trusted

ARM B was handed the exact 11-test regression set and told it did **not** need to grep for
tests or run the full suite. It did both anyway: it grep-mapped every usage (30 searches),
then ran a targeted batch **plus a re-run of failures plus the full 1812-suite** (2,533 cases
total). The curated list was treated as a *starting hint*, not a *replacement* for "verify
everything myself." A capable agent's safety instinct ("did I miss a dependent? run it all")
**dominates** the efficiency the curated set was supposed to buy — the same mechanism that
made the accuracy A/Bs NULL, now eating the efficiency case too.

This is the pre-registered falsifier verbatim: *ARM B hedged to the full suite despite
test_refs → efficiency negated (ratio ≈ 1.0, here slightly worse).*

## Honest verdict
- **The graph's retrieval is efficient in ISOLATION** (a prior static measure: the working-set
  payload is ~5–8× smaller than reading the shard + all module files). But that **per-call**
  efficiency does **not** translate to **end-to-end task** efficiency, because the agent does
  not *trust the curated set enough to skip its own exhaustive verification*. The bounded
  test_refs are additive to, not substitutive for, the full-suite run.
- So across all three axes now tested — accuracy (toy + scale) and efficiency — the working-set
  tooling shows **no measurable win for a capable agent**, consistent with this project's
  recurring governance-⊥-correctness prior.

## What would change the result (genuinely untested)
1. **Trust labeling.** If the surfaced set carried a credible "this is the *complete* regression
   set — running more is redundant" guarantee the agent believes, it might skip the full suite.
   That requires the impact slice to be *provably complete*, which it is not today (it is a
   spec-mapping view, not a code-coverage proof).
2. **A weaker/cheaper model** that *cannot* afford to brute-run 1812 tests — there the curated
   11 may be the only affordable verification, and the tooling would win by enabling correctness
   the control can't reach. (Not tested; would need a budget-capped arm + a smaller model.)
3. **A test suite too slow to brute-force** (minutes→hours) — then "run only the 11" is a real
   wall-clock win a rational agent would take. doverunner's 1812 tests run in ~3 min, cheap
   enough that brute-forcing is the safe default.

**Scope.** Pilot n=1/arm; per the cost gate a refuted/NULL pilot does not justify scaling.
Original doverunner-vapt untouched (scratch clone + worktrees, disposable). No push/deploy.
