<!-- Cladding · ab-evaluation-extended · summary · v0.3.49, F-0144b9 -->

# Extended A/B summary

**Status (2026-05-21):** 1 scenario shipped (task-manager). Cross-scenario findings will populate as more scenarios land.

## Per-scenario verdicts

| Scenario | A tier-banner files | A features tracked | A spec/code ratio | Drift catches (A vs B) | AI ≤1-file queries (A vs B) |
|---|---:|---:|---:|---:|---:|
| [task-manager](./scenarios/task-manager/report.md) | 35 | 30 | 0.55 | 3/4 vs 0/3 | 2/5 vs 0/5 |

## What scale changes (vs original A/B framework)

| Metric | Small-scale (F-ba2e05 · 1 feature/case) | Large-scale (F-0144b9 · 30 features/scenario) |
|---|---|---|
| Tier-banner files at M-final (A) | 9 (payment-saas), 8 (existing-adoption) | **35** (task-manager) |
| Features tracked (A) | 2 | **30** |
| ACs tracked (A) | 3 | **34** |
| Source LoC (both groups) | ~126 (payment-saas) | **739** (task-manager) |
| Spec/code ratio (A) | n/a (not measured) | **0.55** |
| Drift catch rate (A) | 3/4 | **3/4** (preserved) |
| AI ≤1-file query rate (A) | 5/5 | **2/5** (some queries domain-tuned to payment) |

The **catch rate stays at 3/4** at 30× the scale — H11 supported. **Spec/code ratio = 0.55** at M30 (cladding adds 55 LoC of spec per 100 LoC of code) — H9 supported. The capture duration stayed in the same bucket (1-2s for cladding, 1-2s for vanilla) as the snapshot scope grew from 1 feature to 30 — H12 supported.

H10 looks weaker at scale (2/5 vs 5/5 in small-scale) but that's because the AI query set (`_query-bench.ts`) was authored for payment-saas — queries Q1/Q2 specifically ask about "refund flow" which task-manager doesn't carry as a feature. The architecture/capability queries (Q3/Q4) still answer cleanly in 1 file for cladding-managed task-manager. A task-manager-specific query set is in `Future work`.

## Hypotheses verdict (all 12 across small + large scale)

| H | Hypothesis | Small (F-ba2e05) | Large (F-0144b9) |
|---|---|---|---|
| H1 | Cladding produces more structured artifacts | ✅ | ✅ (35 vs 0) |
| H2 | Spec ↔ code traceability | ✅ | ✅ (30 features tracked) |
| H3 | Architecture enforcement | ✅ | ✅ (forbidden_imports enforced) |
| H4 | Detectors prevent drift (static state) | ⚠️ resolved by H6 | ⚠️ resolved by H11 |
| H5 | Token trade-off bounded | ✅ | ✅ |
| H6 | Cladding-exclusive drift catches | ✅ 3/4 | ✅ 3/4 preserved |
| H7 | AI agent productivity | ✅ 5/5 in ≤1 file | ⚠️ 2/5 (query set domain-tuned) |
| H8 | Iron Law gates on vanilla = silent pass | ✅ | ✅ |
| **H9** | Cladding scales linearly | n/a | ✅ ratio=0.55 at M30 |
| **H10** | AI query cost bounded at scale | n/a | ⚠️ partial (see H7) |
| **H11** | Drift catch preserved at scale | n/a | ✅ 3/4 preserved |
| **H12** | Capture duration bounded | n/a | ✅ stayed in 1-2s bucket |

## Cross-scale findings

1. **Cladding's value is proportional to feature count**. At 1 feature it produces 9 tier-banner files; at 30 features it produces 35. The 30 spec shards become the queryable knowledge graph that the original "Cladding is a knowledge graph" framing promised.
2. **Detector overhead is bounded**. 14 snapshots × 25 detectors completed in ~33s wall-clock — even at 30 features per snapshot, the loop didn't degrade.
3. **Spec authoring is the cost; spec ↔ code traceability is the return**. Cladding adds ~0.55 LoC of spec per LoC of code. In return: 5 capabilities with explicit bindings, 30 feature shards with explicit modules + ACs, 1-file lookup for architecture rules.
4. **Vanilla never gets there**. At N=30 the vanilla project has the same React app (739 LoC) but **zero** structured artifacts (0 tier banners, 0 features tracked, 0 ACs, 0 capability bindings). Whatever the user shipped, only the code remembers it.

## How to inspect / how to run

Each scenario ships **two runnable React projects**:

```bash
# Cladding-managed group
cd docs/ab-evaluation-extended/scenarios/task-manager/cladding
npm install && npm run dev

# Vanilla group
cd ../vanilla
npm install && npm run dev
```

Both groups render the same task-manager UI. The visible difference is the file tree — `cladding/spec/`, `cladding/docs/project-context.md`, `cladding/docs/conventions.md` exist only in the cladding group.
