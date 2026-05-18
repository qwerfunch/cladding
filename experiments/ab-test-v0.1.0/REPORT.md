# A/B/C Comparative Test — REPORT

> **9 cells · 3 modes · 3 scopes · 2026-05-18**
> Methodology: see [`METHODOLOGY.md`](METHODOLOGY.md).
> Raw artifacts: `~/Developer/work/cladding-abc/` (not git-tracked).
> Per-cell measurements: [`results/<scope>/<mode>/measurement.json`](results/).

## TL;DR

Across nine cells, **cladding** matches harness on factual quality and beats it on token overhead, while **vanilla** consistently *under-reports* its own defects.

| signal | vanilla | harness | cladding |
|---|---|---|---|
| AC completion (avg) | 82.4% | 82.4% | 82.4% |
| **honest status visibility** | ❌ silent | ✅ explicit | ✅ explicit |
| Token overhead vs vanilla | 0% | **+52.4%** | **+34.6%** |
| Time-box hit | never | never | never |
| Drift detection | none | gate-based | 19-detector + gate |

> *Across the three modes the **code** is identical (same TS implementation copied between cells); the **process artifact** differs.* That's the design — cladding doesn't write better code than vanilla, it **refuses to declare done while quality fails**.

## Per-cell summary

| scope | mode | tokens | AC pass | claimed done? | typecheck | tests | wall-clock |
|---|---|---|---|---|---|---|---|
| simple | vanilla | 1,378 | 5/5 | 100% | ✅ | 7/7 | 2.2 min |
| simple | harness | 2,478 | 5/5 | 100% | ✅ | 7/7 | 2.1 min |
| simple | cladding | 1,972 | 5/5 | 100% | ✅ | 7/7 | 1.9 min |
| medium | vanilla | 1,657 | 10/12 | **shipped as 100%** (silently leaves AC-11) | ✅ | 10/10 | 1.2 min |
| medium | harness | 2,446 | 10/12 | F-006 in_progress | ✅ | 10/10 | 1.4 min |
| medium | cladding | 2,293 | 10/12 | F-006 in_progress | ✅ | 10/10 | 1.2 min |
| **large** | **vanilla** | **4,216** | **16/25** | **shipped at 15/15 tests** | **❌ 3 errors** | **15/15** | **3.7 min** |
| **large** | **harness** | **5,467** | **16/25** | **8 features blocked / in_progress** | **❌ 3 errors surfaced** | **15/15** | **1.5 min** |
| **large** | **cladding** | **5,165** | **16/25** | **8 features in_progress** | **❌ 3 errors surfaced** | **1.4 min** | **1.4 min** |

## Axis-by-axis findings

### 1. Token usage

```
                     simple    medium     large    avg overhead
vanilla              1,378     1,657      4,216    baseline
harness              2,478     2,446      5,467    +52.4 %
cladding             1,972     2,293      5,165    +34.6 %
```

- **harness overhead** grows from +1,100 (simple) to +1,251 (large) — *ceremony cost is sub-linear* in project size, which contradicts the intuitive "more code = more ceremony" assumption.
- **cladding sits between** vanilla and harness on every scope. The sharded spec format + the absence of a replayed event log give it a 17-pp advantage over harness without giving up the value of an explicit spec.
- **At large scale the gap shrinks** (vanilla 4,216 ↔ cladding 5,165 = +22.5 % only). Bigger projects amortise the spec ceremony.

### 2. AC completion

All three modes pass exactly the same vitest suite per scope, so the *raw* AC count is identical (5/5 · 10/12 · 16/25). The interesting axis is **how each mode reports the gap**:

- **vanilla** at medium: declared "10/10 tests pass" and stopped. AC-11 (persistence-failure 500) silently absent.
- **harness** + **cladding** at medium: F-006 explicitly marked `status: in_progress` with an `AC-11` blocker. The same gap, exposed instead of hidden.
- **large** showed the strongest contrast: vanilla shipped at "15/15 tests pass" while typecheck had 3 errors and 6 ACs were missing entirely. harness and cladding marked 8 features `in_progress` / `blocked`.

### 3. Code quality

The three modes shared a single TypeScript implementation per scope (copied between cells, then verified independently). Quality findings:

- **simple** + **medium**: typecheck + lint clean across all three modes.
- **large**: 3 typecheck errors (`req.query` string-vs-string[] inference; `JwtPayload` cast) in `src/app.ts:89,106` and `src/auth.ts:38`. Tests still 15/15.

> **The same code shipped from vanilla as 'done' would have surfaced as 'gate_1 failed' in either harness or cladding.** That's the gate-based mode's *de facto* product: catching real defects before they ship.

### 4. Drift / detector coverage

- **vanilla**: no spec, no drift detection. ACs live as test names; missing AC = silent.
- **harness**: 15 drift kinds (per harness-boot's existing detector set), gate-based BR-004 enforces evidence ≥ N before status=done.
- **cladding**: 19 drift detectors (full Ironclad catalog), L4 conformant. Anti-self-cert guard would block stage_4 on LLM-only evidence — *but only HITL stages, not the L1 gate that surfaced the typecheck errors here*.

### 5. Wall-clock time

All cells stayed well inside their time-box (worst case 3.7 min vs 120 min cap). The harness ceremony doesn't add measurable wall-clock cost — the bottleneck is implementation time, not bookkeeping.

### 6. Maintainability (self-score, 1-5)

```
                    simple    medium    large    avg
vanilla             3.3       3.0       2.7      3.0
harness             3.8       3.5       3.6      3.6
cladding            4.0       3.8       3.8      3.9
```

Cladding's edge over harness comes from **discoverability** (`clad panel`, sharded spec files) and **honest status surfacing** (`gate_1: fail` printed before any release attempt).

## Limitations (be honest)

1. **N=1 per cell.** No statistical claim. The numbers are *individual data points*, not a distribution.
2. **Self-measurement bias.** The same author (cladding maintainer) ran all nine cells, then scored them. The structural axes (typecheck, tests, token counts) are mechanical; only axis 6 (maintainability) is judgement-dependent.
3. **Shared codebase per scope.** Modes B + C cells received a copy of mode A's source so the *process artifact* axis could be isolated. Real-world cladding adoption would influence the source too (TDD via stage_2.1, drift-driven refactors). Those second-order effects are out of scope here.
4. **Vanilla didn't run drift detectors.** Without a spec.yaml there's nothing to drift against. That's both a finding and a measurement gap.
5. **Token counts approximate via char/4.** Claude API metering would be more accurate; that infrastructure is out of scope for this release.

## What this means for v0.1.0

The empirical signal supports two of cladding's release-notes claims and complicates one:

✅ **"Anti-silent-defect" claim**: vanilla shipped a project with typecheck errors and 9 missing ACs as if it were done. Harness and cladding refused. This is the gate-based value proposition.

✅ **"Lower ceremony overhead than harness" claim**: cladding ran 17 percentage points lighter than harness on average. The sharded spec + the panel renderer pay for themselves.

⚠️ **"Per-project token reduction" claim**: cladding's `clad benchmark` showed *negative* reduction on the simple project (93 → 567 tokens) because the optimizer's pruning logic costs more bytes than it saves at tiny scale. We've verified the reduction is positive at cladding's own 47-feature scale (87.9 % on F-008). Release notes should call out: **pruning value is scale-dependent**.

## Recommendation

- Ship v0.1.0 with REPORT.md as the empirical evidence.
- Update the release notes to qualify the token-reduction claim (positive at scale; neutral or negative for tiny projects).
- Add a v0.2 follow-up: re-run the experiment with `clad work` driving the implementation (not just the verification), to measure mode C's *production-process* effect on code quality, not just on reporting.

## Reproducibility

- All nine measurement files committed to this repo.
- Raw artifacts (~ 1 MB) live at `~/Developer/work/cladding-abc/` — symlinkable but intentionally untracked.
- Methodology + per-scope specs allow any third party to re-run with their own model or runtime.

— End of REPORT.md
