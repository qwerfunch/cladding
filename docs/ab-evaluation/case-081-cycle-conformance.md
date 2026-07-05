<!-- Cladding · Tier C — A/B case study (hand-authored judgment record) -->
<!-- clad-doc-links: F-b0f898a6, F-10cc42d1, F-6ed216f3, F-0023ba22, F-1e7a10c3 -->

# Case: 0.8.1 full-cycle principle-conformance A/B (engine v0.8.0 vs the 0.8.1 PR build)

*2026-07-06 · pre-registered criteria fixed before execution · deterministic traps + live Sonnet 5 cycles · harness + raw JSONL preserved in the session scratchpad (`ab-081/`)*

**Question.** Does the 0.8.1 engine run the full cladding cycle according to the project's own principles — earned done, violation trapping, merge self-healing, honest pull/push metering — and what exactly changed versus the published 0.8.0? Code quality was deliberately NOT measured (eight prior NULLs).

**Arms.** A = v0.8.0 tag build (worktree, absolute-path pinned — the PATH `clad` was a stale 0.7.0, a real shadow trap). B = the PR build. Identical self-attesting mini-TS fixtures; identical fixed prompts for the live agents.

## Verdict table (all pre-registered criteria MET)

| Scenario | Result | Receipt |
|---|---|---|
| S3 violation traps ×5 | **B 5/5 as specified; A matched on the 3 regression traps; A's missing mid-merge guards reproduced the half-tree pollution** (done proceeded; gate re-stamped a half-merged tree). B refused (`refusing done`, exit 1) and deferred the stamp. | `s3-traps-{a,b}.jsonl` |
| DI drift sweep ×4 | 4/4 caught in both arms — governance regressions none. | `s3-di-sweep-{a,b}.jsonl` |
| S1 live cycles ×4 (2/arm) | 4/4 ledger-intact: `done_attempted{kept}` present, attestation entries present, zero hand-flips; every `clad done` earned on the first attempt in both arms. | `cycle-audit` runs |
| S2 merge (shared-module cascade) | **The structural claim holds at the data layer**: B's `attested_modules` section = **0 conflicts** while A's id-keyed `attested:` hash data = 1 conflict block. Both arms then hit the *documented* adjacent-id boundary in the marker/index sections (the fixture's sequential stub ids `F-cccccc01/02` sort adjacent — a deliberate worst case; production hash ids make this a ~0.5% tail). Reconcile ritual: 5 steps → GREEN, 0 duplicate keys, both arms. B's residual conflict surface is *constant markers* (either side is correct — no data at risk); A's is *hash data*. | `s2-merge-{a,b}.jsonl` per-section counts |
| S4 adoption-meter truthfulness | The meter is honest end-to-end: an **unresolved** pull (the live agent queried its module *before creating it* — a real behavior worth knowing) landed in the ledger and was **correctly excluded**; a deterministic **resolved** pull then counted (`pullsTotal 1`, tool attributed) while `cyclePullRate` stayed 0 because the pull fell outside the cycle window — timestamp containment works; the uninduced run (zero events) still rendered `hasSignal: true` with `insufficient_data` — cycles-only ledgers are reported, never suppressed, and nothing short of the thresholds can ever read `confirmed`. 0.8.0 has no verdict surface at all (absence recorded, not scored). | `measure --sessions --json` dumps + ledger grep |
| S5 hook latency | median **A 1,125ms vs B 151ms (7.4×)** on the mini fixture (5 runs, sidecars cleared). | `s5-latency-{a,b}.jsonl` |

## Honest annotations

- The fixture scaffold pre-implemented the S1 modules, so the live agents verified rather than authored code; the cycle *mechanics* (sync → strict gate → earned done) were fully exercised — which is what S1 measures — but coding realism was reduced.
- The S2 file-level counts alone would have misread the result; only the per-section split shows the encoding claim. Anyone re-running this: judge `attested_modules` vs `attested:`/`attested_features` separately.
- The S4 pre-creation pull (`resolved:false`) is an ecological finding: agents may consult context for artifacts that do not exist yet; the meter's resolved-only rule handles it correctly, and the B1 protocol's blind-spot note stands.
- One live sub-agent reported encountering an injected instruction inside a tool result during background research and ignored it; no effect on any measurement — noted for hygiene.

**Bottom line.** The 0.8.1 engine passed every pre-registered principle-conformance criterion; the two genuinely new guards (mid-merge done refusal, attestation deferral) and the adoption verdict behave exactly as specified, the v2 encoding moves merge conflicts from hash data to constant markers, and no regression appeared anywhere the two engines were supposed to agree.
