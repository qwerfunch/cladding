<!-- Cladding · Tier C · A/B: working-set tooling at SCALE (doverunner-vapt, Severity-enum landmine) -->

# A/B (scale) — does the working-set tooling help on a real 400-module project?

**Question.** The toy CLOBBER A/B was NULL because the dependency was grep-discoverable.
Does the working-set / impact-card tooling help at **real scale**, where a module's
dependents are numerous + indirect + grep-noisy and the tests are scattered?

**Substrate.** doverunner-vapt — a real, user-owned cladding-managed project: 404 Python
backend modules, 174 feature shards, **1,812 deterministic pytest tests** (a real behavioral
oracle the toy lacked). Cloned to scratch; the original was never touched (git worktrees off
the clone; original `.venv` python used for the suite via `pythonpath=["backend","."]`).

**Discriminator (pre-registered).** Refactor `Severity` in
`backend/core/schemas/vulnerability.py` from a string enum to an integer-ranked `IntEnum`.
Real fan-out: **121 direct importers, ~161 total dependents, 88 test files**, plus
grep-evading indirect consumers — hardcoded `severity == "high"` in reconcilers, raw SQL
`WHERE severity = 'critical'`, test-fixture JSON, an implicit CRITICAL>HIGH ordering contract.

**Arms (isolating THIS feature's delta).**
- ARM A (control): grep + code-reading only, no cladding context tooling.
- ARM B (treatment): same task + the **surfaced impact card** (3 owner features + the 11
  regression test_refs from `buildImpactSlice` on the module) + the nudge.

**Oracle (blind).** A fixed 220-test Severity-impact subset (`-k "severity or correlat or
catalog or vulnerability or triage or sqlite"`, 220 passed / ~13s on the clean clone) is run
on each cell's final output. Regression = baseline-pass → output-fail. The agents do not see
this scorer. Pilot: n=3/arm = 6 real neutral agents (no cladding persona).

## Result — NULL (delta 0pp)

| cell | arm | files changed | 220-subset result | regressions |
|---|---|---|---|---|
| A1 | grep-only | 23 | 220 passed | **0** |
| A2 | grep-only | 24 | 220 passed | **0** |
| A3 | grep-only | 24 | 220 passed | **0** |
| B1 | card+ws | 24 | 220 passed | **0** |
| B2 | card+ws | 23 | 220 passed | **0** |
| B3 | card+ws | 23 | 220 passed | **0** |

**ARM A 0/3 · ARM B 0/3 · delta 0pp.** (Several agents in BOTH arms also reported running
the full 1,812-test suite green, ~2m53s.)

## Why NULL — and it's a *different* reason than the toy

1. **Capable agents self-select breadth without the card.** ARM A agents didn't just grep —
   several ran the **entire 1,812-test suite** to verify. The card's contribution (a curated
   list of 11 tests to run) was strictly dominated by "just run everything," which a capable
   agent does on its own. The surfaced test set added nothing the agent didn't already cover.
2. **Both arms converged on the SAME smarter design.** Every cell (A and B alike) shipped the
   same senior-engineer solution: make `Severity` an `IntEnum` in memory **but keep the
   lowercase-string wire/SQL/JSON/report form byte-identical** (via a `label`/`_missing_`/
   pydantic-serializer shim). That design **eliminates the indirect breakage at the source** —
   the reconciler strings, SQL literals, fixture JSON, and ordering all keep working because
   the external contract never changed. The landmine's "grep-evading consumers" never fired
   for either arm, so there was nothing for the card to save.

This satisfies the pre-registered falsifier: *"both arms 0 regressions → the oracle/agent
skill rescues both → the tooling is not the deciding factor."*

## Honest verdict
- At scale, on a clean drift-scorable refactor, the working-set tooling produced **no
  measurable regression reduction** — consistent with this project's recurring finding that
  governance/context tooling tests **orthogonal to correctness** for capable agents. Scale did
  NOT flip the result; it just moved the reason from "grep substitutes" to "the agent runs the
  whole suite AND finds a contract-preserving design that avoids the breakage entirely."
- **What this does NOT disprove** (genuinely unmeasured here): value under (a) a *weaker/cheaper*
  model that won't run 1,812 tests or find the contract-preserving design; (b) a token/time
  budget too tight to run the full suite — where the card's *targeted* 11-test list would be a
  real efficiency win over brute-forcing everything; (c) truly hidden dependents with NO test
  coverage at all (the oracle can't score what isn't tested). A fair test of (b) would cap the
  agent's tool budget and measure tokens-to-correct, not just pass/fail.

**Scope.** Pilot stopped at n=3/arm on the best-isolated discriminator — per the cost gate,
a clean 0pp delta does not justify scaling to 3×n5. Original doverunner-vapt untouched;
scratch clone + worktrees are disposable. No push/deploy.
