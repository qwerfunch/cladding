<!-- Cladding · Tier C · deterministic measurement of the graph's search + context efficiency -->

# Measurement — search + context efficiency the graph provides (the goal axis)

<!-- Knowledge-graph binding — this case study is the receipt for the `clad measure` efficiency work README.md cites; its prose reports the finding but sits in a graph-excluded dir, so the link is declared explicitly. -->
<!-- clad-doc-links: F-16138071 -->

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
| **Context efficiency** | per-feature shrink **4.1× smaller** (median of naive÷slice across features); separately, median working-set **3,028 tok** vs median naive (shard+all modules) **14,442 tok** | per-feature shrink **2.7×** (median); median 2,990 vs 7,727 tok |
| **Search efficiency** | median **1 hop** resolved (p95 7), median **4 edges/feature** (max hub 76) | median 1 hop (p95 10), 2 edges (max 20) |
| **Stability / regression set** | median blast-radius coverage **1.0**, median **2** regression tests surfaced; **174/174 stop at `coverage`** | median coverage 1.0, 5 tests; stops: coverage 141 / marginal-yield 16 / max-depth 37 |

So for a real large project, the **median feature's** working-set is ~**4× smaller** than loading
its shard+modules, and the graph resolves the dependency radius + the exact regression tests to run
**for free** — each hop it resolves is a "find all dependents" round you would otherwise grep.

> Note on the two numbers: the **4.1× shrink** is the median of each feature's own naive÷slice
> ratio (the typical feature shrinks 4.1×). The **3,028 vs 14,442 tok** are the median slice and
> median naive sizes taken independently across features — so their quotient (≈4.8×) is a
> different statistic from the 4.1× median-of-ratios, not a contradiction. Both come straight
> from `clad measure` (`medianShrinkFactor` vs `medianSliceTokens`/`medianNaiveTokens`).

> **Correction (0.7.1 — cap attribution).** A later validity check showed the shrink numbers
> above are largely the working set's **3000-token default budget** doing the compressing, not
> the graph: with the cap lifted, the structural slice is ≈**1.16× of naive** on cladding-self —
> the slice is the code PLUS structured metadata, not a smaller artifact. On cladding-self
> 163/199 features hit the cap (their "shrink" is cap arithmetic, ≈3.9×) while the 36 that fit
> actually grow (0.7×). `clad measure` now reports the split (`fitsCount`/`truncatedCount`,
> `medianShrinkFit`/`medianShrinkTruncated`, `medianStructuralRatio`) and its headline
> attributes the reduction to the budget. Read the vapt 4.1× above the same way: the honest
> claim is **a guaranteed token budget with needs/breaks/verify wiring attached**, not "N×
> smaller context".

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
  — a budget-guaranteed bounded context per change (see the 0.7.1 correction: the raw "4.1×
  smaller" is the budget cap enforcing the bound, not structural shrink), dependency radius +
  regression set resolved deterministically, a queryable/visualizable dependency graph (0→698
  edges on vapt). This is the value to feature: *cladding makes the context for a change bounded,
  the blast radius explicit, and the regression set known* — for humans and for agents that
  choose to use it — not "smarter agents".

**Reproduce:** `clad measure` (table) or `clad measure --json` (per-feature). Original vapt
untouched; measured on a disposable clone. No push/deploy.
