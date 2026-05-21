<!-- Cladding · ab-evaluation · summary · v0.3.47, F-4db939 -->

# A/B Evaluation Summary — Cladding vs Vanilla Claude Code

**Status (2026-05-21):** 2 cases × 2 milestones = 8 snapshots captured. Both
case reports are auto-generated and committed. Numbers below are pulled
verbatim from the per-case markdowns.

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

⚠️ **Partially supported, with major caveat.**

Both groups report `0 errors / 0 warns` from the 23 toolchain-agnostic
detectors in both cases. This looks like the hypothesis failed — but it
actually reflects a **limitation of the detectors**, not the absence of
drift:

> The spec-gated detectors (`REFERENCE_INTEGRITY`,
> `MISSING_IMPLEMENTATION`, `ARCHITECTURE_FROM_SPEC`,
> `CAPABILITIES_FEATURE_MAPPING`, `AC_DRIFT`, `UNTESTED_AC`) need
> `spec.yaml` + sharded features to evaluate against. Vanilla has none
> of those, so the detectors have nothing to compare and silently
> return zero findings. The "0 errors on vanilla" is therefore
> **absence of signal**, not absence of drift.

Tracked as a follow-up in [README §Limitations](./README.md#2-spec-gated-detectors--0-errors-on-vanilla-is-absence-of-signal).
A future `ABSENCE_OF_GOVERNANCE` detector could flag trees that lack
cladding scaffolding entirely; out of scope for v0.3.47.

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

- We did not measure **outcome quality** (does the code work? does it
  meet the user's intent? does it ship?). Both groups ship executable
  code; we don't run it.
- We did not measure **developer effort** (time-to-M2). Cladding's
  upfront Q&A loop is more wall-clock; the simulator collapses it
  to a function call.
- We did not measure **AI-context efficiency** (how much spec must
  an AI agent load to answer a question?). Tracked as a follow-up.

## Future work

| Item | Why | Priority |
|---|---|---|
| Live-run mode (real Claude Code sessions) | Removes simulator bias | Medium |
| M3 milestone (3-feature cumulative) | Show drift-prevention over time | Medium |
| `ABSENCE_OF_GOVERNANCE` detector | Convert vanilla's "0 errors" into actionable signal | High |
| Tokenizer swap (`@anthropic-ai/tokenizer`) | Billing-class accuracy | Low |
| 3rd case (non-payment domain) | Domain-diversity sanity check | Medium |

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

- `_ab-metrics.ts` — 8-dimension snapshot capture
- `_vanilla-sim.ts` — smart-vanilla curated file sets
- `_report.ts` — deterministic markdown renderer
- `case-payment-saas.test.ts` — case 1 driver
- `case-existing-adoption.test.ts` — case 2 driver
