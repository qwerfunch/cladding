<!-- Cladding · Tier B · governance policy · Refreshed by: manual -->
<!-- clad-doc-links: ignore — uses an illustrative F-abc123 example in a test-scenario table, not a real reference -->

# SSoT testing strategy

How cladding verifies the 4-tier SSoT governance (`docs/ssot-model.md`) actually works **across the full project lifecycle**, plus how it polices **token efficiency** so persona/skill prompts don't bloat the AI host's context over time.

## Two case-based lifecycle tests

The governance model is too rich for per-detector tests to validate alone. Cladding ships two end-to-end lifecycle tests under `tests/scenarios/`, each walking through 6 stages and asserting tier integrity at every step.

### Case 1 — Greenfield (`tests/scenarios/greenfield-lifecycle.test.ts`)

Empty tmpdir + user intent "결제 SaaS for B2B":

| Stage | What happens | What we assert |
|---|---|---|
| **S1** | `clad init <intent>` with LLM-mocked onboarding response | All 4 tiers present, every artifact's first line is the standard Tier banner, F-001 title is intent-derived, 2 scenarios shards land |
| **S2** | `clad clarify 법인 사업자만` | First pending question marked answered; untouched generated design updates in place, while user-edited design stays preserved with review proposals |
| **S3** | Test writes 3+ TS files matching the architecture's suggested layers | (no command — simulates real-world development) |
| **S4** | Cross-tier consistency check (`assertCrossTierClean`) | `CAPABILITIES_FEATURE_MAPPING` + `ARCHITECTURE_FROM_SPEC` + `REFERENCE_INTEGRITY` emit zero errors |
| **S5** | `clad init --scan` re-runs after code was written | `docs/conventions.md` + `spec/architecture.yaml` diverted to proposal; live files preserve onboarding seed |
| **S6** | Final digest + size budget assertion | `assertNoBudgetOverages` prints every measurement; fails the test if any artifact exceeds its budget |

### Case 2 — Existing-adoption (`tests/scenarios/existing-adoption-lifecycle.test.ts`)

Pre-existing TS project (`tests/scenarios/_fixtures/sample-existing-ts/`, 8 source files + `package.json` + `README.md`) + adoption intent:

| Stage | What happens | What we assert |
|---|---|---|
| **S1** | Test copies fixture into tmpdir | `SCAN_AUTO_THRESHOLD ≥ 3` satisfied |
| **S2** | `clad init <adoption-intent>` with LLM-mocked existing-adoption response | `onboardingMode = 'existing-adoption'`, observed layers (api/lib/util) in `architecture.yaml`, capabilities from README headings (Install/Usage/API) |
| **S3** | `clad clarify` with a follow-up answer | Tier A `spec.yaml` untouched, Tier B artifacts diverted to proposal |
| **S4** | Hand-author a new feature shard `spec/features/refund-flow-abc123.yaml` + its module | Tier A banner on the new shard; module on disk |
| **S5** | Bind F-abc123 to the 'api' capability via `features[]` | `CAPABILITIES_FEATURE_MAPPING` accepts the link (no errors) |
| **S6** | Final digest + size budget assertion | Same as greenfield S6 |

## Token efficiency measurement

PR #131 (F-d12edf) promised persona prompts would shed ~30-40 lines each by referencing `docs/ssot-model.md` instead of repeating policy. v0.3.46 (F-4747ef) makes that promise auditable.

### Measurement methodology

Every cladding-managed artifact, persona prompt, meta doc, and LLM dispatcher prompt is measured at the end of each lifecycle test. Three values per measurement:

- **lines** — `text.split('\n').length`, matches `wc -l + 1` for newline-terminated files
- **chars** — `text.length` (UTF-16 code units)
- **estTokens** — `chars / 4` heuristic. Suitable for trend tracking and relative comparison; not an exact tokenizer

The heuristic is portable (no extra npm dependency) and the lifecycle tests treat budgets as **relative ratchets**, not absolute caps — accuracy within ±15% is enough to catch regressions.

### Tokenizer migration path

If accurate token counting ever becomes necessary (billing audits, fine-grained prompt tuning), swap the heuristic in `tests/scenarios/_token-meter.ts::measureText`:

```ts
import {countTokens} from '@anthropic-ai/tokenizer';

export function measureText(text: string): SizeMeasurement {
  return {
    lines: text.length === 0 ? 0 : text.split('\n').length,
    chars: text.length,
    estTokens: countTokens(text), // was: Math.round(text.length / CHARS_PER_TOKEN)
  };
}
```

No other code changes — every assertion downstream uses the `estTokens` value via the budget interface. The migration is a one-line swap + an `npm install` away.

### Size budgets — the ratchet

Budgets live in `tests/scenarios/_size-budgets.ts`. Each entry was calibrated from the **current baseline + 20-25% headroom** so reasonable growth (one new persona principle, one extra capability entry) doesn't force a budget bump.

When a legitimate growth crosses a budget, the workflow is:
1. **Bump the budget in `_size-budgets.ts` first** (PR review enforces this as a considered change, not silent drift)
2. **Then merge the artifact change**

This is the same pattern cladding uses for the plugin manifest detector count (auto-recounted by `build:plugin`; the committed value is the source of truth).

### Categories tracked

| Category | What | Budget shape |
|---|---|---|
| Persona prompts | 5 personas under `src/agents/` | per-file `maxLines` + `maxChars` |
| Meta docs | `docs/ssot-model.md` | per-file `maxLines` + `maxChars` |
| LLM onboarding prompt | `buildOnboardingPrompt` output | `onboardingMaxTokens` |
| LLM refinement prompt | `buildRefinementPrompt` output | `refinementBaseMaxTokens` + `refinementPerQaPairMaxTokens` × N (linear growth allowed) |
| Generated artifacts | each Tier B/C body + scenario shards + onboarding state | per-file `maxLines` + `maxChars` |

### Reading the digest

Each lifecycle test's final stage calls `assertNoBudgetOverages` which prints a digest like:

```
=== Greenfield S6 final ===
── Token efficiency digest ──

[persona]
  ✓ src/agents/orchestrator.md: 64 lines · 4962 chars · ~1241 tokens  (budget: 80L / 5500c / ~1375t)
  ✓ src/agents/planner.md: 58 lines · 3426 chars · ~857 tokens  (budget: 75L / 4200c / ~1050t)
  …

[meta-doc]
  ✓ docs/ssot-model.md: 194 lines · 13676 chars · ~3419 tokens  (budget: 250L / 16500c / ~4125t)

[artifact]
  ✓ docs/project-context.md: 28 lines · 1124 chars · ~281 tokens  (budget: 220L / 9000c / ~2250t)
  …
```

If anything exceeds budget, the digest lists the overage and the test fails. The digest is printed even on PASS so the user can audit trends across PRs.

## Quality verification — does SSoT actually improve dev output?

PR #131's claim is that the 4-tier model improves development output quality. The lifecycle tests verify three concrete signals:

1. **Every Tier B artifact has a producer + consumer** — `architecture.yaml`/`capabilities.yaml`/`project-context.md` all produced by onboarding, consumed by detector + scenario generator + persona. Verified at S6 by `assertNoBudgetOverages` + `assertSpecCompleteness`.

2. **Cross-document drift errors → 0** — every detector emits clean at end-of-lifecycle. `CAPABILITIES_FEATURE_MAPPING` confirms the capability ↔ feature link in Case 2 S5.

3. **Refresh policy preserved** — re-running `clad init --scan` (Greenfield S5) diverts to `.cladding/scan/*.proposal`. During active onboarding, `clad clarify` updates byte-identical generated design directly; if a user edited it, the answer remains `needs_review` and proposal-diverts until explicitly accepted.

If these three signals stay green across the full lifecycle, the SSoT model is delivering the promised quality improvement. If any regress, the failing test names the gap.

## Running the tests

```bash
npm test -- tests/scenarios/                   # both lifecycle tests
npm test -- tests/scenarios/greenfield-lifecycle.test.ts
npm test -- tests/scenarios/existing-adoption-lifecycle.test.ts
```

Each test runs in ~500ms (tmpdir + multi-stage). Total addition to `npm test` runtime: ~1.5-2s.

The digest output for each test is printed to stdout regardless of pass/fail so you can audit budget headroom even on a clean run.

## See also

- [`docs/ssot-model.md`](./ssot-model.md) — the 4-tier governance policy being tested here
- [`tests/scenarios/_size-budgets.ts`](../tests/scenarios/_size-budgets.ts) — the budget definitions
- [`tests/scenarios/_token-meter.ts`](../tests/scenarios/_token-meter.ts) — measurement primitives
- [`tests/scenarios/_assertions.ts`](../tests/scenarios/_assertions.ts) — lifecycle assertion library
