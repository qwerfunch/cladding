<!-- Cladding · Tier B · accepted target-design evidence — implementation pending · Refreshed by: manual -->

# Spec 0.2 — assurance evidence

> Canonical measurement record for the [D21–D23 assurance design](assurance.md#d21--iron-law-assurance-kernel). Return to the [Spec 0.2 continuation router](../spec-0.2.md).

## Iron Law cadence and assurance invalidation

The upstream [Iron Law](https://github.com/qwerfunch/ironclad/blob/main/iron-law.md#stages) defines 13 stages (L1–L4: 6/2/3/2). Shipped `TIER_STAGES` has 15, adding `stage_2.3` Spec conformance and `stage_2.4` Deliverable smoke. Distinguish standard conformance from Cladding's gate; a count does not prove every stage ran or produced non-vacuous proof.

The 2026-08-29 policy truth-table simulation separates standard strictness from
Cladding enforcement:

| Current observation | Ironclad level projection | Cladding strict profile |
|---|---|---|
| hard pass + report pass | complete | GREEN |
| hard pass + report fail | complete; failure reported | RED |
| hard pass + report unobserved | incomplete | unresolved |
| hard fail + report pass | failed | RED |

This preserves shipped blocking while representing the upstream reporting rule;
it does not claim that the Spec 0.2 reducer is implemented.

| Local cadence observation | Result | Reproduction |
|---|---:|---|
| Non-strict pre-commit, 3 shipped stages | 9.06 s real | `/usr/bin/time -p node bin/clad check --tier=pre-commit --json` |
| Non-strict pre-push, 9 shipped stages | 29.73 s real | `/usr/bin/time -p node bin/clad check --tier=pre-push --json` |
| Repository tests | 12.68 s real; 2,981/2,981 passed | `/usr/bin/time -p npm test` |

These are 2026-08-28 single samples on Darwin 25.5.0 arm64, Node 26.0.0 and npm 11.12.1, not portable benchmarks. Capture stdout and `time -p` stderr separately, including failed runs.

| Verified observation | Result | Source |
|---|---:|---|
| Interactive drift partition | significant-edit hook about 5.8 s → 0.5 s | `CHANGELOG.md`; `interactive-drift-profile-6ed216f3.yaml` owns the mechanism |
| Duplicate detector execution | madge 1.27 s + secretlint 3.75 s, about 5.0 s of 11.4 s pre-commit | `gate-run-detector-cache-e53596dd.yaml` |
| Shared Unit/Coverage run | synthetic pre-push median reduction 17.4–33.5%, identical findings | `docs/ab-evaluation/case-test-run-dedup.md` |
| Verdict polling | 2.58 s verdict vs 2.56 s gate, one gate touch | `docs/ab-evaluation/loop-features-live-verification.md` |

These cited observations establish mechanisms and local deltas, not portable latency or adoption claims.

Closure method: `loadSpec` → `reverseIndexOf`; for each of 427 normalized module paths, union all owners and transitive reverse-`depends_on` descendants. Run `inferDependsOn` on exact source bytes; suggestions are not authored truth. Run `buildIterativeImpactSlice` for each of 281 features and count deduplicated returned `test_refs`.

| Measurement | Value | Consequence |
|---|---:|---|
| Features owning a shared module | 257/281 (91.5%) | Multi-owner invalidation is normal. |
| Shared module paths | 202/427 | One path may stale several feature receipts. |
| Owners per module | median 1; p95 7; p99 18; max 61 (`src/cli/clad.ts`) | Direct implementation/receipt fan-out. |
| Authored dependency edges | 249 | Current authoritative ledger; cycle scan returned zero. |
| Import-inferred undeclared edges | 996 across 149 features | The authored DAG is not proven complete; do not silently treat an empty closure as safe. |
| Module change, all-on-edit | 281 features | Sound fallback when closure completeness is unknown. |
| Module owner + full dependent closure | average 22.43; p95 81; max 151 | About 92.0% fewer feature profiles than global on average, conditional on a complete graph. |
| Bounded feature regression set | median 3; p95 31; max 60 test refs | Current iterative query result, not proof that every hidden dependency is covered. |

Negative controls: `UNVERIFIED_AC` accepts an unrelated same-file pass when its target is skipped and stays silent when optional JUnit is absent or unreadable; a criterion-only edit leaves module-only v2 attestation fresh; missing Stage 4 evidence is non-blocking; free-form `identity.author: human` needs no portable verified receipt. The conformance runner has 26 isolated pass/fail fixtures for the upstream 13, none for `stage_2.3`/`stage_2.4`; it misses ordering faults such as Drift reading JUnit before Unit or attestation preceding Audit/UAT.

Preregister three assurance policies against the same mutation corpus:

| Arm | Acceptance criterion |
|---|---|
| A — all-on-every-edit oracle | Recompute all 281 feature profiles and catch every seeded spec/code/test/receipt/tool/environment fault; this is the comparison oracle, not the target cadence. |
| B — event tiers | Produce the same criterion verdict, feature verdict, first blocking stage, and stale receipt set as A. Any unknown/unowned/dynamic input escalates to A; owner-only or fixed-depth dependency bounds are forbidden as GREEN proof. |
| C — closure DAG | Match an independent full recomputation exactly while invalidating only content-addressed contract, implementation, proof, receipt, tool, and environment closures. Injected missing/dynamic/ambiguous edges must mark completeness unknown and escalate, not return an empty safe set. |

A/B/C report affected criteria/features, cache hits, reruns, wall time, and first blocker. Accept efficiency only when B and C are fault-equivalent to A; blast-radius reduction alone is not correctness evidence.
