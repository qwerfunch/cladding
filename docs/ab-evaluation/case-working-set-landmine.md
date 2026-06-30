<!-- Cladding · Tier C · A/B: working-set context tooling (landmine outcome trial) -->

# A/B — does the working-set context tooling reduce regressions? (landmine trial)

**Question.** Do `clad_get_working_set` (F-06dfdad6) + the PostToolUse impact card + the
ai_hints/persona nudge (F-d6b93648) make an LLM **avoid introducing spec↔code drift** on a
refactor that silently breaks a non-obvious downstream dependent — vs the old context path?

**Design (pre-registered).** Real-LLM landmine trial, scored blind by `runDrift` (the
detectors are the judge: `errors_after − errors_before > 0` ⇒ regression introduced).
ARM A = old path (no card, no nudge); ARM B = working-set + auto impact-card + nudge.
Isolate the feature's delta (NOT cladding-vs-vanilla). MDE = 15pp; NULL if delta < 15pp;
"insufficient discriminating power" if the control also passes (both < 10%).

## Instrument validation (deterministic, no agents)
Built scratch cladding projects; confirmed each landmine discriminates baseline→blind→informed:

| Landmine | blind refactor fires | scorable by drift? |
|---|---|---|
| CLOBBER (rename a 3-feature shared module, no spec update) | MISSING_IMPLEMENTATION×3 + STATUS_DRIFT×3 | ✅ yes |
| ARCHITECTURE (util-layer file adds a forbidden import to api) | ARCHITECTURE_FROM_SPEC×1 | ✅ yes |
| REGRESSION (edit upstream util, skip the scattered regression tests) | — | ❌ **no** — a logic/behavioral break; MISSING_TESTS only checks test_refs are *declared*, not run/passing |
| AC-RISK (refactor removes an EARS-`unwanted` 401 check) | — | ❌ **no** — behavioral; the AC + test_ref stay declared, so no drift detector fires |

**Honest finding #1:** only the two *structural* landmines are cleanly drift-scorable. The
behavioral ones (REGRESSION, AC-RISK) — where the tooling's "run these tests" / "high-risk AC"
surfacing would plausibly help most — need a **test-execution oracle** (run the suite, check
pass/fail), not drift detectors. They are out of scope for this metric.

## Phase-1 pilot — CLOBBER, real agents, n=3/arm
6 neutral agents (no cladding persona, identical task) each renamed `src/api/auth.ts` →
`src/api/login.ts` in an isolated copy. ARM A got no blast-radius hint; ARM B got the
auto-surfaced impact card + working-set ("declared by 3 features: F-a00001/b00002/c00003").

| | regression rate | what happened |
|---|---|---|
| ARM A (no card) | **0/3 = 0%** | every agent `grep`'d `auth.ts`, found the 3 `modules:` refs in spec.yaml, updated all 3 |
| ARM B (card+ws) | **0/3 = 0%** | same |
| **delta** | **0pp** | — |

**Verdict: NULL.** And the *reason* is decisive (not a sample-size issue): the CLOBBER
dependency is **grep-discoverable**, so a capable agent catches it without the card — `grep`
fully substitutes for the auto-surfaced impact. Scaling n will not change a mechanism that
the control already solves. Per the pre-registered rule, the CLOBBER instrument has
**insufficient discriminating power** for capable agents.

## Honest conclusion
- On the **cleanly-measurable structural case**, the working-set tooling produced **no
  measurable reduction in regressions** — consistent with this project's recurring finding
  that capable agents already do the diligent thing (here: grep + update the spec). The
  auto-card's value (surfacing what grep would find) is redundant when grep suffices.
- The tooling's **plausible** value is elsewhere and **was not measurable here**:
  (a) surfacing dependencies that are NOT grep-discoverable (transitive/graph-only, or buried
  in a large repo where grep returns too much), and (b) behavioral verification-prompting
  ("run these 8 tests", "this AC is high-risk") — which needs a test-execution oracle.
- This does **not** prove the tooling is worthless — it proves the *structural-drift A/B* can't
  detect an effect, and that the obvious landmine is grep-substitutable. A fair test of the real
  value requires a **behavioral oracle + a large/indirect-dependency corpus** (a heavier,
  separate experiment).

**Status:** Phase 2 (ablation) NOT run — gated on a Phase-1 positive, which did not occur.
Token cost kept low by stopping at the conclusive pilot rather than scaling a non-discriminating trial.
