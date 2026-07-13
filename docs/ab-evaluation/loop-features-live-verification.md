# Live-run verification — the 4 in-session loop features

**Date:** 2026-07-10 · **Branch:** `feature/clad-verdict` · **Features under test:**
`clad verdict` (F-2e28cc72), gate-error finding-parser (F-b7873005),
prior_attempts (F-59af798d), GATE_NO_PROGRESS (F-b0c8ba2c).

This is the *live-run* experiment `docs/ab-evaluation/README.md` names as future
work (the committed A/B there uses a **simulated** vanilla control). It answers
three questions with a mostly-deterministic protocol and reports the wins **and**
the non-wins without overclaim.

## Questions

- **Q1 — optimized?** Does the loop run better (turns / gate-runs / context)?
- **Q2 — more robust?** Won't false-done, escapes infinite iteration, doesn't
  restart from zero?
- **Q3 — no regression?** Neutral or better on performance?

## Method (pre-registered; decision rules frozen before running)

Because these features are **harness properties, not correctness features**, Q2
and Q3 are answered **deterministically** (pure CLI output + byte-diff, no LLM),
and only Q1's agent-loop economics needs a real loop. Rigs:

- **Isolated external fixtures** (`/tmp/exp-*`, one per trap — `hasBehavioralProof`
  is whole-gate, so traps cannot share a repo), each bootstrapped with
  `clad init … --no-llm` + a symlinked toolchain.
- **Features-absent control:** a `git worktree` of `develop` built to a binary
  (`develop..HEAD` = exactly these 4 commits), for byte-identity diffs.
- **One real Arm-B loop** (Opus generator) building a 3-feature interdependent
  TS project (tokenizer → parser → evaluator) via the optimized cadence
  (`clad verdict` → author → `clad done`).

## Results

### Q3 — no performance regression: **CONFIRMED (clean, deterministic)**

| Probe | Result | Rule | Verdict |
|---|---|---|---|
| verdict vs gate wall-clock | 2.58s vs 2.56s = **1.008×** | ∈ [0.9, 1.2] | PASS — single gate touch, not double |
| green-path stage bytes (feature vs develop) | **identical** (diff exit 0); no `findings` on passing stages either side | byte-identical | PASS — error-parser has zero green-path side effect |
| poll-not-mutate | tracked tree + `attestation.yaml`/`spec.yaml` md5 **unchanged** after 3 polls | unchanged | PASS — only the gitignored `verdict-progress.json` changes |

### Q2 — more robust: **2 clean wins + 1 honest limitation**

- **Stuck-escape (GATE_NO_PROGRESS) — CLEAN.** Two back-to-back polls on an
  unfixable red gate: poll 1 `ITERATE`, poll 2 `ESCALATE` /
  `halt_class: GATE_NO_PROGRESS`. A loop that would iterate to the budget cap now
  halts at attempt 2. (The poll-1 `next_action` was `src/broken.ts:2 TS2322: …` —
  the finding-parser's structured `file:line`, confirmed live.)
- **Memory (prior_attempts) — CLEAN.** A reverted `clad done` →
  `prior_attempts { attempts: 1, drift_history: […] }`; a clean feature → the key
  is **absent** (null-omit). The loop no longer restarts blind.
- **Honest-done guard — TEMPERED.** The intended state (green gate with *zero*
  behavioral proof) is **hard to reach in a real TS project**: cladding's strict
  skip-policy already forces type + unit to run, so verdict's DONE-guard is
  **largely redundant with the existing gate**. Worse, a `vitest` that exits 0
  with **0 tests** (`passWithNoTests`, or an all-`it.skip` suite) yields
  `stage_2.1 = pass` → `hasBehavioralProof = true` → verdict says **DONE** — a
  **vacuous-pass blind spot shared by the gate and the guard**. The guard's logic
  (all-liveness/na/skip → ITERATE) is unit-proven, but its marginal loop
  robustness for real code projects is limited.

### Q1 — optimized: **PARTIAL (structural win, token savings unproven)**

The real 3-feature build ran the cadence correctly: `BOOTSTRAP → ITERATE` (in
`depends_on` DAG order F1→F2→F3) `→ DONE`, with DONE genuinely earned (real
passing tests + a functional smoke that re-ran `(1+2)*3 → "= 9"` end-to-end). The
working-set resolved the transitive dependency chain (F3 needs = [F2, F1]).

- **Structural win:** one honest poll replaces "run the gate + re-derive the
  decision + hunt for context," with a `file:line` next_action. Fewer round-trips
  per decision, at 1.008× gate cost.
- **Token savings — NOT shown:** `contextRatio ≈ 1.5 (> 1)` on all three
  features *even with edges resolved* — the working-set slice was **larger** than
  the naive `shard + all modules` baseline at this scale. Its value is
  *structural* (one call: feature + deps + regression tests + guidance,
  budget-bounded), not raw-token reduction here. This matches
  `src/optimizer/measurement.ts`'s own disclaimer (contextRatio is an upper bound,
  not an adoption measurement).

## Honest limitations (not hidden)

1. **Honest-done guard** is largely redundant with the strict skip-policy for TS
   projects, and shares a vacuous-pass (0-test, exit 0) blind spot. Candidate
   follow-up: make the guard reject a unit stage that passed with zero executed
   tests.
2. **Context-token reduction is unproven** at small/medium scale (working-set
   overhead > naive baseline); may materialize on larger dependency graphs — and
   the measurement baseline itself is narrow.
3. **GATE_NO_PROGRESS false-positive on cold-start** (empty `src/` → identical
   `tsc` "no inputs" finding twice → a spurious "stuck"). Low severity — it is a
   recommendation and self-clears once code exists.

## Verdict

**"No performance hurt, and a more robust loop" is TRUE and deterministically
proven** — the real, load-bearing gains are **escaping infinite iteration** and
**remembering failed attempts**, at zero measured overhead. **"Stronger
honest-done" and "context-token savings" are NOT supported by this experiment.**
Reported as-is.
