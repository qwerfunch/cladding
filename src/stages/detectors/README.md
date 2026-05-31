---
title: Drift detector inventory & status policy
audience: contributors adding or auditing detectors
applies_to: stages/detectors/*.ts
ironclad_spec_ref: https://github.com/qwerfunch/ironclad/blob/main/detectors.schema.json
---

# Drift detectors — inventory

30 detectors are wired into `stages/drift.ts` via `stages/detectors/index.ts`: the upstream Ironclad 19 plus cladding extensions (`FIXTURE_REFERENCE_INVALID` onward). The live count is the filesystem itself — `scripts/build-plugin.mjs` Phase D recounts `stages/detectors/*.ts` and rewrites `plugin.json` on every build, so this prose number and the table below are kept honest by `tests/self-consistency.test.ts` (and `tests/scripts/build-plugin-detector-count.test.ts`). Each detector is a pure function `(opts) => readonly DriftFinding[]`; the stage passes when no finding has `severity === 'error'`.

## Catalog

| # | name | axis | source | default severity | status policy |
|---|---|---|---|---|---|
| 1 | `UNMAPPED_ARTIFACT` | spec ↔ code | `unmapped-artifact.ts` | warn | blind |
| 2 | `MISSING_IMPLEMENTATION` | spec ↔ code | `missing-implementation.ts` | error | blind |
| 3 | `AC_DRIFT` | spec ↔ code | `ac-drift.ts` | error | blind |
| 4 | `TECH_STACK_MISMATCH` | spec ↔ code | `tech-stack-mismatch.ts` | warn | blind |
| 5 | `ARCHITECTURE_VIOLATION` | spec ↔ code | `architecture-violation.ts` | error | blind |
| 6 | `CONVENTION_DRIFT` | spec ↔ code | `convention-drift.ts` | warn | blind |
| 7 | `MISSING_TESTS` | code ↔ test | `missing-tests.ts` | error *(promoted from warn in v0.2.18)* | **aware** |
| 8 | `STALE_TESTS` | code ↔ test | `stale-tests.ts` | warn | blind |
| 9 | `COVERAGE_DROP` | code ↔ test | `coverage-drop.ts` | warn | blind |
| 10 | `EVIDENCE_MISMATCH` | code ↔ test | `evidence-mismatch.ts` | error | blind |
| 11 | `HARDCODED_SECRET` | code ↔ test | `hardcoded-secret.ts` | error | blind |
| 12 | `PERFORMANCE_DRIFT` | code ↔ test | `performance-drift.ts` | warn | blind |
| 13 | `UNTESTED_AC` | spec ↔ test | `untested-ac.ts` | error | **aware** |
| 14 | `STATUS_DRIFT` | spec ↔ test | `status-drift.ts` | error | blind |
| 15 | `STALE_EVIDENCE` | spec ↔ test | `stale-evidence.ts` | warn | blind |
| 16 | `STALE_SPECIFICATION` | spec ↔ test | `stale-specification.ts` | warn | blind |
| 17 | `HARNESS_INTEGRITY` | environment | `harness-integrity.ts` | error | blind |
| 18 | `REFERENCE_INTEGRITY` | environment | `reference-integrity.ts` | error | blind |
| 19 | `META_INTEGRITY` | environment | `meta-integrity.ts` | error | blind |
| 20 | `FIXTURE_REFERENCE_INVALID` *(cladding extension, v0.2.4)* | spec ↔ fixture | `fixture-reference.ts` | warn | blind |
| 21 | `ABSENCE_OF_GOVERNANCE` *(cladding extension, v0.3.49)* | scaffold | `absence-of-governance.ts` | graduated (error / warn / info) | blind |
| 22 | `ID_COLLISION` *(cladding extension)* | within-spec | `id-collision.ts` | error | blind |
| 23 | `SLUG_CONFLICT` *(cladding extension)* | within-spec | `slug-conflict.ts` | error | blind |
| 24 | `AC_DUPLICATE_WITHIN_FEATURE` *(cladding extension)* | within-spec | `ac-duplicate-within-feature.ts` | error | blind |
| 25 | `ARCHITECTURE_FROM_SPEC` *(cladding extension, v0.3.13)* | spec ↔ code | `architecture-from-spec.ts` | graduated (error / warn) | blind |
| 26 | `CAPABILITIES_FEATURE_MAPPING` *(cladding extension)* | spec ↔ spec | `capabilities-feature-mapping.ts` | graduated (error / warn / info) | blind |
| 27 | `AI_HINTS_FORBIDDEN_PATTERN` *(cladding extension, v0.3.57)* | spec ↔ code | `ai-hints-forbidden-pattern.ts` | error | blind |
| 28 | `INVENTORY_DRIFT` *(cladding extension, v0.4.x)* | spec ↔ spec | `inventory-drift.ts` | error | blind |
| 29 | `PLANNED_BACKLOG` *(cladding extension, v0.4.x)* | spec ↔ code | `planned-backlog.ts` | warn | **aware** *(planned-state)* |
| 30 | `HOLLOW_GOVERNANCE` *(cladding extension, v0.4.x)* | spec ↔ spec | `hollow-governance.ts` | warn | blind *(scale-gated)* |

`axis` and `default severity` for rows 1–19 mirror the [Ironclad spec detectors.schema.json](https://github.com/qwerfunch/ironclad/blob/main/detectors.schema.json) catalog. Row 20 (`FIXTURE_REFERENCE_INVALID`) is a cladding-specific extension that promotes the `fixture:NAME` evidence-label convention from a free-form string into a validated anchor. It checks every `acceptance_criteria[].evidence_refs[fixture:X]` (and, for backward compatibility, `test_refs[fixture:X]`) citation against `conformance/fixtures.yaml`; an unregistered name emits a `warn` finding. User projects without a `conformance/fixtures.yaml` opt out (no findings). The `status policy` column is cladding-specific (see below).

## Status policy

Two detectors check whether each acceptance criterion of a feature has surfacing test evidence on disk. For a feature that is still being authored (`status: planned` or `status: in_progress`) the test files referenced by `acceptance_criteria[].test_refs` deliberately do not exist yet — flagging them as errors would drown the real signal in progress-noise.

So `UNTESTED_AC` and `MISSING_TESTS` are **status-aware** in the `done`-direction: they only inspect features where `status === 'done'`. `PLANNED_BACKLOG` is status-aware in the *opposite* direction — it inspects only `planned`/`in_progress` features, because its whole job is to flag features that are specced but not yet built (the per-feature cadence). Every other detector is **status-blind** — it checks every feature regardless of lifecycle state, because its findings (a hard-coded secret in code, a broken cross-reference, a stale piece of evidence, an architecture-layer violation) are problems even when the surrounding feature is mid-flight.

### When you add a new detector

Default to **status-blind**. Status-awareness is an exception, justified only when the detector's invariant is itself a lifecycle question — "test evidence is in place" (a `done`-state question, `UNTESTED_AC`/`MISSING_TESTS`) or "the spec hasn't raced ahead of the code" (a `planned`/`in_progress` question, `PLANNED_BACKLOG`). If you're tempted to make a new detector status-aware for any other reason, open an issue first; that is a policy change worth discussing.

### Upstream RFC candidate

The current `detectors.schema.json` does not encode `status_policy` as a per-detector field. Promoting this column to a normative spec field is a candidate Ironclad RFC for a future minor bump; cladding's status-aware behavior is conformant in the meantime because the spec doesn't forbid it.

## Severity reality vs the "19 detectors" headline

A 2026-05-19 inject experiment (`cladding-abc/08-drift-inject/`) measured cladding's detector set on a controlled-inject baseline. The full report is `REPORT-DRIFT-INJECT-2026-05-19.md` in that folder. Key finding: the **headline "19 detectors" is technically true but oversells the bare metal**. A more honest framing:

### 3 always-error detectors (the load-bearing core)

These fire at `error` severity, on every feature regardless of status, against direct spec/disk/code evidence:

| detector | what trips it |
|---|---|
| `UNMAPPED_ARTIFACT` | source file in scan path with no `features[].modules` entry claiming it |
| `MISSING_IMPLEMENTATION` | spec declares a module path; file absent on disk |
| `STATUS_DRIFT` | feature `status: done` while a declared module is missing |

In the inject experiment, these three fired confidently and were the only error-severity catches without preconditions.

### 16 conditional detectors

Each one is real, but each has a condition that softens its day-1 utility:

| condition class | detectors |
|---|---|
| **status-aware** (only run on `status: done`) | `MISSING_TESTS` (error since v0.2.18), `UNTESTED_AC` (error) |
| **config-dependent** (needs external config / binary) | `HARDCODED_SECRET` (needs `.secretlintrc` + secretlint), `COVERAGE_DROP` (needs coverage report), `PERFORMANCE_DRIFT` (needs perf baseline) |
| **code-anchor-dependent** (needs a `// AC-NNN: <hash>` comment in source — no anchor → no catch) | `AC_DRIFT` |
| **warn-severity** (does not fail the gate alone) | `MISSING_TESTS`, `STALE_TESTS`, `COVERAGE_DROP`, `STALE_EVIDENCE`, `STALE_SPECIFICATION`, `TECH_STACK_MISMATCH`, `CONVENTION_DRIFT`, `PERFORMANCE_DRIFT`, `UNMAPPED_ARTIFACT` *(default; promoted to error by `--strict`)* |
| **scoped-scan** (narrow glob — drift outside the scan paths is invisible) | `UNMAPPED_ARTIFACT` scans `stages/**` and `spec/**` only |
| **environment** (needs project structure cladding expects) | `HARNESS_INTEGRITY`, `REFERENCE_INTEGRITY`, `META_INTEGRITY` |

### Opt-in strict mode

`clad check --strict` promotes every warn-severity drift finding to error for that single invocation. This is the right knob for CI / pre-publish gates where any divergence should block. The default remains non-strict so warns don't drown signal during active development.

### Reading guide for the catalog table

When the table above lists `default severity: warn`, that's the *current* default. Several of those are candidates for future promotion to `error` once the prerequisites land (e.g., `MISSING_TESTS` promotes to error once enough AC entries carry evidence of either kind — see the evidence taxonomy below).

## AC evidence taxonomy — `test_refs` vs `evidence_refs`

v0.2.3 (F-052) split the single `test_refs` field into two complementary fields. The motivation was honesty: cladding's own spec was burying npm-script names, conformance fixtures, and doc paths inside `test_refs`, which then made `UNTESTED_AC` skip them via a `self-dogfood:` / `fixture:` prefix dance. The split makes each AC declare what kind of evidence actually exists.

| field | what belongs here | examples |
|---|---|---|
| `test_refs` | executable code-test files | `tests/foo.test.ts`, `__tests__/bar.test.ts` |
| `evidence_refs` | non-test verification artifacts | `script:stage:type` / `self-dogfood:stage:type` (npm scripts), `fixture:missing-tests` (conformance fixtures), `docs/measurement/2026-05-19-drift-inject.md` (curated reports) |

`MISSING_TESTS` is satisfied by *either* field carrying at least one entry. `UNTESTED_AC` only inspects `test_refs` (since it resolves paths on disk); evidence_refs entries are deliberately out of its scope because their truth is established by running a command or by curated artifact review, not by file existence.

A `status: done` AC with both fields empty trips `MISSING_TESTS error` (v0.2.18 promoted from warn; previously only `--strict` escalated this). The author's job is to declare at least one form of evidence; the detector's job is to never let a `done` AC ship with neither — and the gate is now hard, not advisory.

### `fixture:` is a validated anchor, not a free-form label (v0.2.4, F-053)

The `fixture:NAME` citation form is validated by detector #20 (`FIXTURE_REFERENCE_INVALID`). Every name on the right of the colon must appear in `conformance/fixtures.yaml` — otherwise the detector emits a `warn` finding identifying the AC and the unknown name. The registry distinguishes two kinds:

| kind | meaning | example |
|---|---|---|
| `runnable` | implemented in `conformance/runner.ts`; setup + run execute on every `npm run conformance` | `stage_1.3.pass` |
| `documentary` | label-only placeholder; the AC's verification lives in source or in a paired AC's `test_refs` | `F-006_AC-008` |

`documentary` is a real registry entry, not a wildcard. It exists so that ACs whose code is implemented but whose verification doesn't yet have a dedicated runnable fixture can declare evidence honestly, and so reviewers can grep `conformance/fixtures.yaml` to see the full inventory. Future cycles promote documentary entries to runnable by writing matching setup/run code.

## Adding a detector

1. Create `stages/detectors/<name-kebab>.ts` exporting a `DriftDetector` (see `stages/types.ts` for the contract).
2. Register it in `stages/detectors/index.ts` under `allDetectors`.
3. Add an entry to this README's catalog table.
4. Add a fixture under `conformance/` (a pass-case and a fail-case at minimum).
5. Update the corresponding row in `CHANGELOG.md` under `### Added`.
6. Run the four-check loop from `CONTRIBUTING.md` before pushing.
