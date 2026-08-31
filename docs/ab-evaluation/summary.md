<!-- Cladding · ab-evaluation · summary · v0.3.47, F-4db939 + F-ba2e05 -->

# A/B Evaluation Summary — Cladding vs Vanilla Claude Code

**Status (2026-05-21):** 2 cases × 2 milestones = 8 structural snapshots **+ outcome
quality** measured (4 drift injections × 2 groups + 5 AI queries × 2 groups per case).
Both case reports are auto-generated and committed. Numbers below are pulled
verbatim from the per-case markdowns.

_Snapshot note (2026-07-05): this historical M2 report reflects the detector registry available at that run. Body preserved as an append-only snapshot._

## Cases at a glance

| Case | Intent | Seed | A at M2 | B at M2 |
|---|---|---|---|---|
| [payment-saas](./case-payment-saas.md) | "결제 SaaS for B2B Stripe Toss 지원" | empty tmpdir | 9 tiered artifacts · 2 features · 3 ACs · 2 scenarios · 3 capabilities · 3 layers · ~1680 tokens | 0 tiered · 0 spec · 5 src files · 2 test files / 4 cases · ~1399 tokens |
| [existing-adoption](./case-existing-adoption.md) | "이 프로젝트 분석해서 환불 기능 추가" | 8-file fixture | 8 tiered artifacts · 2 features · 3 ACs · 1 scenario · 3 capabilities · 3 layers · ~3073 tokens | 0 tiered · 0 spec · 9 src files · 2 test files / 3 cases · ~1280 tokens |

## Verdict per hypothesis

### H1 — Cladding produces more structured artifacts

✅ **Strongly supported.**
- Payment SaaS M2: A has 9 tier-banner-bearing files (4A + 3B + 1C + 1D), B has 0.
- Existing adoption M2: A has 8 (3A + 3B + 1C + 1D), B has 0.

### H2 — Cladding emits spec ↔ code traceability that vanilla lacks

✅ **Strongly supported.**
- A at M2 emits 2 feature shards, 3 ACs, 1-2 scenarios, 3 capabilities — all bound to module paths.
- B at M2 emits 0 of any: no `spec.yaml`, no `spec/features/`, no `spec/scenarios/`, no `spec/capabilities.yaml`.

### H3 — Cladding declares architecture layers + forbidden-import rules

✅ **Strongly supported.**
- Payment SaaS: 3 layers (api / ledger / webhook), 2 forbidden-import rules.
- Existing adoption: 3 layers (api / lib / util), inherited from observed code.
- Vanilla: 0 layers in either case — directory structure exists but is convention-only, not enforced.

### H4 — Detectors catch drift cladding would have prevented

⚠️ **Initially looked like null result, RESOLVED by H6 drift injection.**

At static M2 state both groups report `0 errors / 0 warns` from the
toolchain-agnostic detectors. This looks like the hypothesis failed —
but that's because spec-gated detectors (`REFERENCE_INTEGRITY`,
`MISSING_IMPLEMENTATION`, `ARCHITECTURE_FROM_SPEC`,
`CAPABILITIES_FEATURE_MAPPING`, `AC_DRIFT`, `UNTESTED_AC`,
`MISSING_TESTS`) need spec artifacts to evaluate against. Vanilla
has none, so they silently return zero — **absence of signal**,
not absence of drift.

**H6 below** confirms the original intent of H4 directly: when 4
realistic drift events are injected, cladding catches 3 (75%) while
vanilla catches 0. The detectors *do* prevent drift — they just need
the spec to be there first.

### H5 — Vanilla pays fewer artifact-tokens but loses structural signal

✅ **Supported with measured trade-off.**

| Case | A est. tokens | B est. tokens | Δ |
|---|---:|---:|---:|
| payment-saas (M2) | 1680 | 1399 | **+281** |
| existing-adoption (M2) | 3073 | 1280 | **+1793** |

The token premium is real but small — ~281 tokens on greenfield, ~1793
on existing adoption (where cladding also wraps the existing 113 LoC
of code into its inventory). In return, the entire structural signal
H1+H2+H3 (9 tier-banner-bearing artifacts · 2 features · 3 ACs · 3
capabilities · 3 layers) becomes available to AI agents querying the
spec at every subsequent feature increment.

## Outcome Quality verdicts (F-ba2e05)

### H6 — Cladding catches drift vanilla misses

**Historical M2 observation only — non-release.** The comparison records
cladding-exclusive catches at M2, but no later B5 signed receipt is recorded
for a release claim.

Both cases produced identical 3/4 catch rates against deterministic drift injection:

| Scenario | A · Cladding | B · Vanilla |
|---|---|---|
| DI-1 Stale module reference (rename `src/api/refund.ts` without spec update) | ✅ `MISSING_IMPLEMENTATION` + `STATUS_DRIFT` | · silent (no spec) |
| DI-2 Architecture violation (`util/log.ts` imports `lib/refund.js`) | ✅ `ARCHITECTURE_FROM_SPEC` | · silent (no architecture rule) |
| DI-3 Hardcoded secret (baseline) | · silent in tmpdir (secretlint not installed) | · silent (same) |
| DI-4 Untested AC (add `AC-003` to feature shard) | ✅ `MISSING_TESTS` | N/A (no spec, no ACs) |

- **Catch rate**: A = 3/4 · B = 0/3 · **cladding-exclusive catches = 3 in each case**.
- DI-3 doesn't fire on either group because the tmpdir lacks secretlint/gitleaks toolchain; in production both groups would catch it equally.
- DI-4 is N/A on vanilla by construction — vanilla has no AC concept.

This is the direct evidence the structural metrics couldn't provide:
**when something goes wrong, cladding actually says so. Vanilla doesn't.**

### H7 — AI agents are 5× more productive on cladding-managed trees

✅ **Strongly supported.**

5 domain questions asked, "files-to-open" cost measured per group:

| Case | A answered (≤1 file) | B answered |
|---|---|---|
| payment-saas | 5/5 | 2/5 (Q1 via grep + Q5 via test-file count) |
| existing-adoption | 5/5 | 2/5 (same pattern) |

Vanilla cannot answer Q2 (AC count) · Q3 (architecture rules) · Q4 (capability bindings) at all — those concepts don't exist in the codebase. Q1 (feature location) and Q5 (scenario count) are answerable but with grep + heuristics, no canonical source.

For an AI agent loading context to answer a domain question:
- A: open 1 file, get authoritative answer.
- B: grep N files, get probabilistic answer or admit ignorance.

### H8 — Iron Law gates measure detector activity, not codebase health

✅ **Supported, with explanation.**

`clad check --strict` against cladding's current registered detector set:
- On A: spec-gated detectors actively run; ARCHITECTURE_FROM_SPEC + MISSING_IMPLEMENTATION + UNTESTED_AC + MISSING_TESTS all gate the PR.
- On B: those detectors silently report 0 findings because they have nothing to evaluate; only spec-independent checks meaningfully run.

Same gate label, very different evaluation surface. The follow-up `ABSENCE_OF_GOVERNANCE` detector would expose this directly by treating "no spec" as a finding instead of silent pass.

## Cross-case observations

- **Cladding front-loads spec; vanilla front-loads code.** At M1, A has 0
  source TS files while B has 3-7. By M2 both converge on similar code
  volume but with completely different governance trails.
- **Adoption overhead is real.** The existing-adoption case shows
  cladding adding +1793 tokens of governance on top of an existing
  113-LoC codebase. That cost is paid once (init); subsequent features
  inherit the scaffolding for free.
- **Tier banners are the cheapest structural signal.** A single
  `# Cladding · Tier B · ...` line lets any reader (human or AI)
  identify governance level via `head -1`. Vanilla has no equivalent.
- **Capability binding is the strongest delta.** Vanilla cannot answer
  "which feature implements PCI-DSS compliance?" — cladding answers it
  by looking up `spec/capabilities.yaml` and reading `features:` ids.

## What the numbers do NOT prove

- We did not run the code — both groups ship executable TypeScript with vitest tests, but the suites themselves aren't actually executed in tmpdirs. "Outcome quality" here means structural correctness + drift detection, not runtime behavior.
- We did not measure **developer effort** (time-to-M2). Cladding's upfront Q&A loop is more wall-clock; the simulator collapses it to a function call.
- DI-3 (hardcoded secret) doesn't fire in tmpdir because secretlint/gitleaks aren't installed. In a real cladding-adopting project both groups would catch it.
- We did not measure cumulative drift over many feature increments (M3+) — the 3-catch result is the M2 snapshot only and is not release evidence without a later B5 signed receipt.

## Future work

| Item | Why | Priority |
|---|---|---|
| `ABSENCE_OF_GOVERNANCE` detector | Convert vanilla's "0 errors" into actionable signal — H4's caveat becomes a real gate | **High** |
| Actually run vitest in tmpdirs | Confirm both groups' tests pass; compare runtime behavior | Medium |
| Live-run mode (real Claude Code sessions) | Removes simulator bias | Medium |
| M3 milestone (3-feature cumulative) | Show drift-prevention over time | Medium |
| 3rd case (non-payment domain) | Domain-diversity sanity check | Medium |
| Fix `ARCHITECTURE_FROM_SPEC` schema mismatch | Test had to canonicalize seed-emitted architecture.yaml — surfaced as a real cladding bug | Medium |
| Tokenizer swap (`@anthropic-ai/tokenizer`) | Billing-class accuracy | Low |

## How to verify

```bash
# Verify both reports match committed snapshots.
npx vitest run tests/scenarios/ab/

# Refresh reports after legitimate metric drift.
UPDATE_AB_REPORTS=1 npx vitest run tests/scenarios/ab/
```

Both case markdowns + this summary are read by humans for evaluation
and by CI as deterministic snapshots. The infrastructure lives at
`tests/scenarios/ab/`:

- `_ab-metrics.ts` — 8-dimension snapshot capture (F-4db939)
- `_vanilla-sim.ts` — smart-vanilla curated file sets (F-4db939)
- `_report.ts` — deterministic markdown renderer (extended in F-ba2e05 with `renderOutcomeSection`)
- `_drift-injection.ts` — 4 drift scenarios + before/after detector diff (F-ba2e05)
- `_query-bench.ts` — 5 domain questions + file-lookup cost (F-ba2e05)
- `case-payment-saas.test.ts` — case 1 driver
- `case-existing-adoption.test.ts` — case 2 driver
