<!-- Cladding · Tier C · deterministic measurement of the graph's search + context efficiency -->

# Measurement — search + context efficiency the graph provides (the goal axis)

**Why this exists.** The graph tooling's goal is **search-efficiency + context-efficiency +
stable development at scale** — NOT making an agent more correct. Four correctness-framed A/Bs
returned NULL, but correctness was never the goal; they measured the wrong axis. This measures
the right one **deterministically** (no agent, no test run, no NULL risk) via `clad measure`
(F-16138071): for every feature, what does the graph hand you for free vs what you'd reconstruct
by hand?

**Method (`clad measure`, pure).** For each feature: working-set token size; the naive baseline
= the feature shard + the full text of all its module files (what you'd load without the slice);
the dependency depth + edges the graph resolves; the iterative slice's coverage + stop reason;
the regression test set handed to you. Reuses buildWorkingSet / buildIterativeImpactSlice /
reverseIndexOf — no new algorithm. Run on a vapt clone with the 698 inferred `depends_on` edges
merged (original untouched), and on cladding-self.

## Result — POSITIVE on the goal axes (first time, because it's the right axis)

| axis | doverunner-vapt (174 feat, 698-edge graph) | cladding-self (194 feat) |
|---|---|---|
| **Context efficiency** | working-set **3,028 tok** vs naive (shard+all modules) **14,442 tok** = **4.1× smaller** (median) | 2,990 vs 7,727 = **2.7× smaller** |
| **Search efficiency** | median **1 hop** resolved (p95 7), median **4 edges/feature** (max hub 76) | median 1 hop (p95 10), 2 edges (max 20) |
| **Stability / regression set** | median blast-radius coverage **1.0**, median **2** regression tests surfaced; **174/174 stop at `coverage`** | median coverage 1.0, 5 tests; stops: coverage 141 / marginal-yield 16 / max-depth 37 |

So for a real large project, one safe change needs ~**4× less context** than loading the
shard+modules, and the graph resolves the dependency radius + the exact regression tests to run
**for free** — each hop it resolves is a "find all dependents" round you would otherwise grep.

## Honest scope (what this does and does NOT claim)
- This is the efficiency the **infrastructure CAN provide** — an upper bound vs **one** naive
  baseline (shard + all module files). It is real, deterministic, and model-independent.
- It is **NOT** proof that a capable agent *adopts* it. The four A/Bs showed strong agents grep
  the full tree regardless of the slice, so the per-call saving does not automatically become an
  end-to-end saving for a strong model. Adoption is a separate question (would likely show only
  for a weaker/budget-capped agent — untested).
- The naive baseline is one plausible "without the tool" cost; a careful agent might read less
  than all modules, so the real-world ratio for a given agent could be lower than 4×.

## The honest bottom line of the whole arc
- **Agent correctness/cost**: NULL ×4 — the graph does not make a capable agent more correct or
  cheaper end-to-end (it greps anyway). Consistent with the long-standing governance-⊥-correctness
  prior.
- **Goal axes (search + context efficiency, stability/traceability)**: **POSITIVE + now quantified**
  — 4.1× smaller context per change, dependency radius + regression set resolved deterministically,
  a queryable/visualizable dependency graph (0→698 edges on vapt). This is the value to feature:
  *cladding makes the context for a change small, the blast radius explicit, and the regression set
  known* — for humans and for agents that choose to use it — not "smarter agents".

**Reproduce:** `clad measure` (table) or `clad measure --json` (per-feature). Original vapt
untouched; measured on a disposable clone. No push/deploy.
