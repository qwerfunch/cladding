# Value A/B — vacuous-test guard vs vanilla / no-guard baseline

**Date:** 2026-07-11 · **Branch:** `feature/clad-verdict` · **Feature:** vacuous-test
guard (F-b81d203e).

Correctness verification (does the guard fire?) is in the feature's own tests and
was confirmed earlier. This document is the **value** verification the methodology
demands: does the guard catch a real defect that a baseline *misses*? Ablation
control = the SAME cladding built from `develop` (which lacks the 5 loop-support
commits, so it has no guard), plus plain `vitest` as the "no cladding at all"
vanilla arm. All three arms run on the same fixture: two `done` features — one
genuinely tested (`F-real`), one whose own declared test is all `it.skip`
(`F-vac`).

## Result — by scenario

| Scenario | vanilla `vitest run` | cladding@develop (no guard) | cladding@HEAD (guard) | guard's role |
|---|---|---|---|---|
| **a. F-vac's module is 0%-covered (isolated)** | exit 0 — misses | RED via the existing **coverage floor** — catches it | RED via VACUOUS_TESTS | **redundant** (coverage already catches it) |
| **b. F-vac's module is 100%-covered by *another* feature's test, but its own test is all-`it.skip`** | exit 0 — misses | **GREEN — ships F-vac as done** (coverage satisfied elsewhere) | **RED, VACUOUS_TESTS on F-vac; coverage stays green** | **unique — the only mechanism that catches it** |
| **c. coverage not enforced (no report)** | exit 0 — misses | coverage detector returns nothing — misses | RED via VACUOUS_TESTS | **unique (sole defense)** |

No arm ever false-positived the genuinely-tested `F-real`.

**Honest reading:** the guard is *not* a slam-dunk unique win — for an isolated
0%-covered vacuous file, cladding's pre-existing coverage floor already catches it
(scenario a, redundant). Its **genuine, non-redundant value** is real and proven
in the cases coverage cannot see: a feature whose module is exercised by *other*
features' tests but whose *own* declared tests never execute a passing assertion
(b), and any project where coverage is not enforced (c). Both plain tooling and
prior-cladding ship that defect; the guard catches it, with zero false positives.

## The bigger question this session answered — is cladding better than vanilla *for loop engineering*?

Across this session's experiments (two full A/B rounds + scale + this value A/B),
the honest answer splits by axis:

- **As a code generator — NO, roughly tied.** A capable agent produces similar
  output with or without cladding; the generator is commodity and cladding does
  not improve it (the "governance-orthogonal" result, reproduced repeatedly). And
  cladding costs more (more calls / gate runs / context).
- **As the verifier / stop-condition layer — YES, materially better.** This is
  exactly what loop engineering names as the scarce, load-bearing skill ("the
  verifier is the bottleneck, not the generator"). Demonstrated here:
  earned-`done` (won't flip to done unless the strict gate is GREEN), an honest
  one-poll verdict (won't say DONE without a real behavioral proof),
  GATE_NO_PROGRESS (escapes infinite iteration), and this vacuous-test guard
  (catches "done but never actually tested"). Vanilla ships all of these failure
  modes; cladding stops them.
- **Two honest caveats.** (1) Value lands reliably only where it is
  **gate-enforced / automatic**, not in optional tools — exp-2 showed a competent
  agent orients via familiar commands and does not preferentially adopt new
  optional surfaces. (2) The traceability edge (spec answers questions raw source
  cannot) is real for audit / resume / multi-dev, tied for a single capable
  agent's raw comprehension.

**Bottom line:** cladding is not a better generator than vanilla, but it is a
better *verifier* — and loop engineering's decisive battleground is the verifier.
The highest-leverage direction is therefore to keep converting that verifier value
into gate-enforced / automatic mechanisms (this guard is one), not more optional
tools.
