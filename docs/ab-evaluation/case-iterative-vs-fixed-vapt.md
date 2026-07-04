<!-- Cladding · Tier C · A/B: iterative vs fixed impact slice, on vapt WITH the graph populated -->

# A/B — iterative vs fixed impact slice, on a now-populated graph (vapt)

<!-- Knowledge-graph binding — compares the iterative impact slice against the fixed-depth impact slice; declared explicitly. -->
<!-- clad-doc-links: F-96250595, F-7794a6bc -->

**The question this finally answers.** Three prior A/Bs were NULL; we then found the root cause
(the dependency graph was empty in real projects) and fixed it (`clad infer-deps` reconstructs
`depends_on` from the import graph; the `INFERABLE_DEPENDS_ON` detector surfaces the gap). With
the graph **now populated**, does the iterative impact slice (auto-widening + coverage-reported)
beat the old fixed-depth-1 slice? This is the test that was DOA before (0 edges → 0 narrow-miss
candidates); after merging 698 inferred edges into a vapt clone it became runnable (46 candidates).

**Design.** Clone vapt, merge inferred `depends_on` into the clone (original untouched). Target:
`code_rule_loader.py` (feature sast-android-code, F-a8741f8c) — a deliberate return-shape refactor
that can break 2nd-hop dependents. Both arms use the SAME tool; only the slice differs:
- ARM-FIXED: the depth-1 slice — 5 test_refs, 1 impacted feature (omits elf / binary-crypto).
- ARM-ITER: the iterative slice — 9 test_refs (incl. test_elf, test_binary_crypto_corroboration),
  3 impacted, coverage 1.0.
**Budget cap** (the lever the prior NULLs lacked): full 1812-suite forbidden; verified each agent
self-reported `ran_full_suite: false`. n=3/arm = 6 real agents. Blind oracle: a fixed pytest
subset (~226 tests incl. the 2nd-hop elf/binary-crypto) run on each cell's output; regression =
baseline-pass → output-fail.

## Result — NULL again (delta 0pp), 4th in the series

| cell | arm | pytest subset | regressions | files changed | tests the agent ran |
|---|---|---|---|---|---|
| F1 | FIXED | 226 passed | **0** | 8 | 8 files / 107 cases |
| F2 | FIXED | 223 passed | **0** | 15 | 8 / 100 |
| F3 | FIXED | 223 passed | **0** | 7 | 8 / 102 |
| I1 | ITER | 224 passed | **0** | 8 | 11 / 104 |
| I2 | ITER | 223 passed | **0** | 15 | 12 / 127 |
| I3 | ITER | 223 passed | **0** | 12 | 12 / 138 |

**ARM-FIXED 0/3 · ARM-ITER 0/3 · delta 0pp.** Budget cap held (no arm ran the full suite). Both
arms converged on the same correct refactor (a `RuleSet`/`CodeRuleSet` value object with all
consumers updated).

## Why NULL — a NEW mechanism, even with the graph populated + brute-force capped

The prior NULLs died to "agent runs the full suite anyway." This one is capped — and STILL NULL,
for a sharper reason, stated by ARM-FIXED itself (F1, verbatim):
> *"the surfaced fixed depth-1 slice was inaccurate: 3 of its 5 test_refs never import the changed
> symbol, and it missed the true fan-out … I found the real consumers via full-tree grep."*

A capable agent **does not trust a narrow (or inaccurate) slice — it greps the full tree to find
the real consumers.** The fixed-arm agents changed 7–15 files (the true fan-out) despite being
handed only 5 narrow test_refs. The iterative slice's extra breadth (9 vs 5 test_refs) gave the
ITER arm nothing the FIXED arm couldn't recover with grep. The slice width is dominated by the
agent's own dependency discovery.

## Honest verdict — the whole arc
- Across **four** A/Bs (toy CLOBBER, scale Severity accuracy, efficiency, and now iterative-vs-fixed
  on a populated graph), the graph/working-set tooling shows **no measurable win for a capable
  agent's correctness or cost.** Populating the graph (the real gap fix) did not flip it: even with
  698 edges and a budget cap, grep-based discovery dominates a richer slice.
- **What the gap fix DID achieve and stands (not retracted):** vapt's feature-dependency graph went
  0 → 698 edges, so `clad graph serve` now *shows* the dependency network, and impact/working-set
  return non-empty results. That is real **traceability/visualization** value — for humans, audit,
  navigation — which these agent-correctness A/Bs do not measure and do not refute.
- **What remains genuinely untested** (the only places a win could still live): a weaker/cheaper
  model that can't afford full-tree grep; a codebase where grep is genuinely insufficient
  (dynamic/string-based coupling no static grep catches); and the human-facing traceability value.

**Bottom line:** the graph is worth populating for what humans *see* and navigate, not for making a
capable agent more correct or cheaper — consistent with this project's long-standing governance-⊥-
correctness finding, now confirmed a fourth time on the strongest substrate available.

**Scope.** Original doverunner-vapt untouched (scratch clone + worktrees, disposable). No push/deploy.
