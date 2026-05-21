<!-- Cladding · ab-evaluation-extended · methodology · v0.3.49, F-0144b9 -->

# A/B Evaluation (extended) — methodology

The original A/B framework ([`../ab-evaluation/`](../ab-evaluation/)) demonstrated cladding's value at small scale: 2 cases × 2 milestones, 1 feature added per case at M2. The **extended** evaluation pushes scale by ~30× — full UI projects with **30 features** developed against each scenario — to verify whether cladding's value compounds.

## Scenarios

| Scenario | Stack | Features | Status |
|---|---|---|---|
| [task-manager](./scenarios/task-manager/) | React 19 + Vite 6 + TS 5.6 + Tailwind 4 | 30 | shipped in F-0144b9 (v0.3.49) |
| dashboard (planned) | same stack | 30 | next cycle |
| blog/CMS (planned) | same stack | 30 | cycle after |

Each scenario ships **two runnable React projects** committed under `scenarios/<name>/{cladding,vanilla}/`. The cladding group carries the full governance scaffold (spec.yaml + 30 sharded feature shards + architecture + capabilities + project-context + conventions); the vanilla group has the same React source minus governance.

## Browse + run

The committed projects under `scenarios/<name>/{cladding,vanilla}/` are **runnable**. Inspect any group locally:

```bash
cd docs/ab-evaluation-extended/scenarios/task-manager/cladding
npm install
npm run dev   # opens http://localhost:5173
```

The same `npm run dev` works in the vanilla sibling. Both render the same UI; the delta is in the governance layer.

## Methodology

For each scenario, the case test (`tests/scenarios/ab-extended/case-<scenario>.test.ts`):

1. **Curates** the React app for both groups at progressive milestones (1, 5, 10, 15, 20, 25, 30 features). The curator (`_curator.ts`) is deterministic — same input feature set → same output bytes.
2. **Captures snapshots** at each milestone using the existing 8-dimension metrics (`tests/scenarios/ab/_ab-metrics.ts`) + new performance dimension (`_perf-meter.ts`).
3. At M30, applies **4 drift scenarios** (file rename · architecture violation · hardcoded secret · untested AC) and **5 AI domain queries** to measure outcome quality at scale.
4. Renders a **byte-deterministic markdown report** committed to `scenarios/<name>/report.md` (snapshot gate). The committed React projects are regenerated on `UPDATE_AB_REPORTS=1`.

## Metrics dimensions

In addition to the original 8 ([`../ab-evaluation/README.md`](../ab-evaluation/README.md#metrics-dimensions-8)), the extended evaluation adds 4 hypotheses tested at scale:

| Hypothesis | What it measures |
|---|---|
| **H9** | Cladding scales linearly with feature count — spec/code ratio stays bounded as N grows |
| **H10** | AI agent file-lookup cost stays ≤1 file per domain query in cladding regardless of N; vanilla grows O(N) |
| **H11** | Drift catch rate (75% cladding-exclusive in F-ba2e05) is preserved at N=30 |
| **H12** | Snapshot capture duration scales with tree size, not feature count |

## Limitations

### Same as the original A/B framework

The bias-risk inherited from F-4db939's vanilla simulator applies here: vanilla group is **hand-curated**, not live-run via Claude Code. The 30 features were authored at senior quality to keep the comparison fair; reviewers are invited to inspect [`./scenarios/task-manager/vanilla/`](./scenarios/task-manager/vanilla/) and judge for themselves.

### New to the extended evaluation

- **Domain-tuned AI queries**: the 5 query functions (`tests/scenarios/ab/_query-bench.ts`) were designed for payment-saas; some refer to "refund flow" which task-manager doesn't have. Q3 (architecture rules) and Q4 (capability bindings) still answer cleanly in cladding-managed task-manager (`1 file lookup`). A task-manager-specific query set is tracked for a follow-up cycle.
- **AC count includes shard inflation**: 30 features × ~1.13 ACs per feature = 34 ACs at M30 (some features ship 2 ACs). The "AC count" metric reflects what reviewers would see in `grep "^  - id: AC-" spec/features/*.yaml`.
- **Capture duration uses 500ms+ buckets**: wall-clock variance forced rough bucketing. The signal is "scale-bounded", not exact ms. The hypothesis verdict (H12) reports the bucket label, not the ms.

## Future work

- Task-manager-specific AI queries (`refund` → `add-task` etc.)
- Vitest "actually runs in the committed project" verification (currently we only snapshot source state, don't run the React test suite)
- Bundle size measurement (`vite build` output) per group per scenario
- Cross-scenario summary in `./summary.md` once 2+ scenarios ship
- Browser screenshot capture (manual run only, currently)

## Related governance documents

- [`../ssot-model.md`](../ssot-model.md) — 4-tier SSoT policy
- [`../ssot-testing.md`](../ssot-testing.md) — Lifecycle testing methodology
- [`../ab-evaluation/README.md`](../ab-evaluation/README.md) — small-scale A/B framework
- [`./summary.md`](./summary.md) — extended cross-scenario summary
