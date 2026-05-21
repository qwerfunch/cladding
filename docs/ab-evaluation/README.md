<!-- Cladding · ab-evaluation · methodology · v0.3.47, F-4db939 -->

# A/B evaluation — Cladding vs Vanilla Claude Code

This directory holds **comparative case studies** between two development
modes for the same intent:

- **Group A — Cladding-managed**: a developer using `clad init <intent>`
  followed by `clad refine` Q-A cycles and TDD-style feature shards.
- **Group B — Vanilla Claude Code**: a developer using plain Claude Code
  (no cladding plugin), writing files directly under `src/` + `tests/`
  with a hand-written README.

The case studies live at sibling-level: [`case-payment-saas.md`](./case-payment-saas.md)
(greenfield) and [`case-existing-adoption.md`](./case-existing-adoption.md)
(existing 8-source-file TypeScript service). Each report is
**auto-generated** by `tests/scenarios/ab/case-*.test.ts` and committed
to disk so reviewers can read it as documentation, while regressions in
the underlying mechanics fail CI.

## Methodology

For each case the test:

1. Sets up **two isolated tmpdirs** (one per group).
2. Drives **Group A** through `runInit({intent})` against a mocked
   LLM dispatcher that emits the same realistic seven-sentinel response
   the lifecycle tests use. At **M2** (first feature complete) Group A
   additionally hand-authors a feature shard + matching module + test.
3. Drives **Group B** through `applyFileSet(cwd, session.m1Files)` —
   a pre-curated file set representing what a senior developer would
   ship using vanilla Claude Code. At **M2** Group B writes the same
   feature's code + test (no spec, no scenarios, no capabilities).
4. Calls `captureSnapshot(group, milestone, cwd)` after M1 and M2 on
   both tmpdirs (4 snapshots total per case).
5. Renders the snapshots into markdown via `renderCaseReport(...)` and
   either writes the file (when `UPDATE_AB_REPORTS=1`) or asserts the
   on-disk copy matches.

## Metrics dimensions (8)

| Dimension | What it measures | Why it matters |
|---|---|---|
| `tieredArtifactCount` | Files with `Cladding · Tier {A,B,C,D}` banner on line 1 | Tier presence = governance scaffolding. Cladding ≫ vanilla. |
| `specCompleteness` | features × ACs × scenarios × capabilities × bindings | Traceability between intent and code. Vanilla has 0 of each. |
| `layerCompliance` | layers declared + forbidden-import rules | Architecture as code vs convention-only. |
| `crossDocConsistency` | 25 detectors run, counts errors/warns/infos | **Limitation**: spec-gated detectors silently pass on vanilla because they have nothing to evaluate (see §Limitations). |
| `documentationByTier` | line counts split tiered-vs-other docs | Structured vs free-form docs. |
| `codeStructure` | source files / test files / LoC | Vanilla front-loads code; cladding front-loads spec. |
| `tokenConsumption` | cumulative chars / estTokens (chars/4) | Vanilla pays fewer artifact tokens (trade-off cost of structure). |
| `testCoverage` | test files + test cases (regex-counted) | Coarse proxy — both groups can ship tests; structure differs. |

## Determinism

Both reports are **byte-identical across runs**:

- Snapshot capture is pure file IO (no clocks, no UUIDs).
- LLM mock returns canned responses.
- Vanilla file sets are pre-curated strings.

Re-run the tests without `UPDATE_AB_REPORTS=1` and the on-disk reports
must match the generated content. If the metrics shift legitimately
(e.g. you added a new dimension or changed cladding's onboarding seed),
run with `UPDATE_AB_REPORTS=1` to refresh the committed files, then
commit the diff.

```bash
# Refresh both reports
UPDATE_AB_REPORTS=1 npx vitest run tests/scenarios/ab/

# Verify reports match (default CI mode)
npx vitest run tests/scenarios/ab/
```

## Limitations

### 1. Vanilla is **simulated**, not live-run

We do not spawn a real Claude Code session for Group B. We curate the
file set a senior developer would likely produce. This is acknowledged
bias risk — countered by writing vanilla code at production quality
(proper directory split, executable handlers, real tests, sensible
README). Cladding's value should *not* depend on vanilla being
underwritten. The smart-vanilla file sets live at
[`tests/scenarios/ab/_vanilla-sim.ts`](../../tests/scenarios/ab/_vanilla-sim.ts)
— inspect them and judge for yourself.

**Future**: a live-run mode that captures real Claude Code transcripts
and replays them deterministically. Out of scope for v0.3.47.

### 2. Spec-gated detectors → "0 errors on vanilla" is **absence of signal**

Several detectors (`REFERENCE_INTEGRITY`, `MISSING_IMPLEMENTATION`,
`ARCHITECTURE_FROM_SPEC`, `CAPABILITIES_FEATURE_MAPPING`,
`AC_DRIFT`, `UNTESTED_AC`, etc.) need `spec.yaml` + sharded features
to evaluate against. Without those artifacts they have nothing to
compare and silently return zero findings — *not* because the vanilla
tree is clean, but because the consistency rules can't even run.

The Findings section in each case report calls this out explicitly.
A future cycle may add an `ABSENCE_OF_GOVERNANCE` detector that
flags trees missing the cladding scaffold; out of scope here.

### 3. `chars/4` is a heuristic, not a tokenizer

Token counts in the reports use the `chars/4` rule of thumb. This is
accurate enough for **relative comparison + regression detection** (the
purpose here) but should not be used for billing-class numbers. A swap
to `@anthropic-ai/tokenizer` is tracked in `docs/ssot-testing.md`
§Tokenizer migration path.

### 4. Only 2 cases × 2 milestones

`v0.3.47` ships 2 cases × 2 milestones = 8 snapshots. Future cycles may
expand to:
- **More cases**: ML pipeline, image-processing API, marketing site.
- **M3 milestone**: 3-feature cumulative state to measure drift-prevention over time.
- **Live-run**: actual Claude Code sessions instead of curated simulations.

## Reading the reports

Each `case-*.md` follows the same shape:

1. **Methodology summary** — what the case tests.
2. **Hypotheses tested** — 5 hypotheses about cladding's value proposition.
3. **M1 + M2 tables** — side-by-side metrics with Δ column.
4. **Detector outcomes** — error/warn/info counts per group.
5. **Findings** — narrative summary of the comparison.
6. **How to reproduce** — exact `npm test` command.

The **Findings** section is what most readers care about: a 6-bullet
narrative quantifying the structural delta between cladding-managed and
vanilla development.

## Related

- [`../ssot-model.md`](../ssot-model.md) — 4-tier SSoT governance model that cladding implements.
- [`../ssot-testing.md`](../ssot-testing.md) — Lifecycle testing methodology (the precursor to this directory).
- [`../../tests/scenarios/`](../../tests/scenarios/) — Lifecycle + A/B test infrastructure.
- [`./summary.md`](./summary.md) — Cross-case findings + verdict.
