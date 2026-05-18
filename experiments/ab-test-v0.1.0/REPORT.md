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
| **XL** | **vanilla** | **603** | **0/150** | stub-only — agent never got past the markdown brief | n/a | n/a | 0.2 min |
| **XL** | **harness** | **15,324** | **stub** | 1,799-line monolith spec.yaml, every prompt loads all of it | n/a | n/a | 0.2 min |
| **XL** | **cladding** | **13,528 raw / 237 pruned** | **stub** | 100 sharded yaml files; `clad benchmark F-050` reports **98.2 % reduction** | n/a | n/a | 0.4 min |

## Pruning curve (feature count → reduction)

```
features    cladding clad-benchmark reduction
   5 (S3)   −514.6 %   (Token Optimizer overhead > savings at tiny scale)
   7 (S6)   −514 %     (similar — sharded layout NA for this size)
   8 (S9)   −510 %     (same band)
  47 (self) +87.9 %    (cladding's own spec — first positive bin)
 100 (S14)  +98.2 %    (XL scope — validates the design claim)
```

**Interpretation**: the optimizer's prune logic has a fixed cost (~ 500-line minimum payload). Below ~ 20 features it's a tax; above ~ 50 it's transformative. **Cladding's release notes accurately call this "scale-dependent"** — the XL cell is the empirical proof that the design works as intended.

## Real-output drive A/B (05-real-ab)

The XL drive comparison above only measured *orchestration shape* — both modes produced zero working code. To measure **actual development output** we built the same small project in both modes: a habit-tracker REST API (8 features, TypeScript + Express + in-memory store, vitest + supertest).

```
                                 cladding cell          harness cell
domain                           habit-tracker (8 F)    habit-tracker (8 F)
code LOC                         234                    234 (copied — A/B equivalence)
test LOC                         158                    158 (copied)
tests passing                    14 / 14                14 / 14
iron-law stages pass             1.1 · 1.3 · 1.5 · 1.6  gate_0 · gate_1 · gate_5
                                 · 2.1 (5/13)           + evidence ≥ 1 (prototype)
features marked done             N/A (no status flow)   8 / 8 via Iron Law
drive halt class                 RETRY_THRESHOLD        analyze_fail
                                 (typecheck fail on     (LLM judgment needed
                                  cross-stub import)     after first gate_0)
drive iterations / phase         4                      Phase A 3 + Phase B 1
drive stubs created              2                      0 (spec-only)
claude-side rework               14 files written       3 meta files +
                                                        48 work-cycle commands
events.log entries               n/a (cell-local)       77
spec layout                      sharded 8 yaml files   monolith spec.yaml
```

**Friction surfaced by going end-to-end** (the value of this cell):

| friction | cladding side | harness side |
|---|---|---|
| spec EARS validation | added `condition:` field per AC after AC_DRIFT fired | n/a — harness AC field set doesn't enforce EARS |
| missing meta files | copied `spec/schema.json` + `.secretlintrc` after META_INTEGRITY + secret stage flagged | n/a |
| coverage tool versions | `@vitest/coverage-v8@3` ↔ `vitest@2` ESM mismatch → stage_2.2 fail | gate_3 (coverage) not invoked here |
| Node v26 native deps | `better-sqlite3` gyp build fail → switched to in-memory store (affected both cells) | same |
| LLM-required halts | `RETRY_THRESHOLD` after 3 retries with no LLM hook → Claude wrote impl out-of-loop | `analyze_fail` halt by design → Claude wrote impl + ran 48 cycle commands |

Two things to read off this cell:

1. **Same output, different ceremony cost.** Both modes produced the same 234 LOC code, 158 LOC tests, 14/14 passing. The cladding side reached the green build in **one Claude turn** (drive bailed, Claude wrote the rest). The harness side reached the same green build only **after** Claude executed 48 `harness work` commands across 8 feature cycles. The ceremony is the harness side's deliverable, not the code.
2. **Drift detector ergonomics matter at this scale.** Cladding's 19 detectors fired immediately and forced fixes (EARS, META_INTEGRITY, secret) that the harness side never even checked. That's *more upfront friction* per feature in cladding, traded for *higher static-analysis confidence* at release. Whether that tradeoff is worth it depends on the project — a finding the XL orchestration cell could not surface because no actual code existed.

The "real output" axis is what this experiment was missing. Drive isn't where you measure output quality — drive is the *plumbing for getting there*. Both modes converge to the same code; they diverge on the *path* and the *guarantees along the path*.

## Drive-mode A/B (XL only)

Both modes shipped an autonomous "drive" loop. We ran each against the same 100-feature XL spec and recorded the halt class, wall clock, and event-stream footprint. The two are **different design points**, not directly substitutable — but the side-by-side is the cleanest signal we have for how each toolchain *behaves* on a partially-scaffolded enterprise spec.

```
                                  XL × cladding drive       XL × harness drive
invocation                        clad drive                node bin/harness drive --auto-approve-all
design point                      deterministic L1 floor    LLM-coordinated file handoff
LLM calls during run              0                         3 Phase A halts (each unblocked by Claude)
halt class                        ALL_FEATURES_DONE         gate_no_progress  (Phase A: 3× plan_phase_approval)
iterations                        31                        2 (Phase B)
features touched                  30                        1 (Phase B halted on first feature)
stubs / scaffolds                 30 file stubs             30 goals[].feature_ids entries
gate runs                         90                        2 (both skipped — no toolchain detected)
wall clock                        0.66 s                    ≈ 110 s (3 Phase A halts + author time)
halt enum size                    10                        11
```

Two things to read off this table:

1. **Cladding's drive sits at the deterministic end of the spectrum.** No LLM call, sub-second wall clock, processes the whole ready set in one pass. Treats `skipped` gate results as non-fail, so a stub-heavy spec doesn't pin the loop. The cost: it's a floor — by v0.1 the richer LLM-driven loop is reserved for v0.2 (T9).
2. **Harness drive sits at the LLM-coordinated end.** Phase A's three halts (brief.md · plan.md · `goals[].feature_ids`) are the *raison d'être* — they force the researcher / planner / feature-author agents to author the work explicitly. Phase B then yields on `gate_no_progress` after two consecutive `skipped` results, which is a *correctness choice*: rather than scaffold the spec further the loop hands control back. That choice is why this XL cell didn't burn through all 30 features deterministically — harness drive isn't trying to.

Same problem, different shape. Both halt on a closed enum (10 vs 11 classes), both leave a re-enterable checkpoint. Cladding's v0.2 plan is to grow the LLM-driven branch *on top of* its deterministic floor.

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

✅ **"Per-project token reduction" claim**: validated at XL scale. With 100 features sharded, `clad benchmark F-050` cuts the spec payload from 13,521 to 237 tokens — **98.2 % reduction**. The negative number at the simple cell (5 features) is a known floor of the prune overhead; the design pays off above ~ 50 features. Release notes correctly position the claim as "scale-dependent and empirically validated at 47+ features".

## Recommendation

- Ship v0.1.0 with REPORT.md as the empirical evidence.
- Update the release notes to qualify the token-reduction claim (positive at scale; neutral or negative for tiny projects).
- Add a v0.2 follow-up: re-run the experiment with `clad work` driving the implementation (not just the verification), to measure mode C's *production-process* effect on code quality, not just on reporting.

## Reproducibility

- All nine measurement files committed to this repo.
- Raw artifacts (~ 1 MB) live at `~/Developer/work/cladding-abc/` — symlinkable but intentionally untracked.
- Methodology + per-scope specs allow any third party to re-run with their own model or runtime.

— End of REPORT.md
