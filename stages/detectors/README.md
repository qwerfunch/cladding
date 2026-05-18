---
title: Drift detector inventory & status policy
audience: contributors adding or auditing detectors
applies_to: stages/detectors/*.ts
ironclad_spec_ref: https://github.com/qwerfunch/ironclad/blob/main/detectors.schema.json
---

# Drift detectors — inventory

19 detectors are wired into `stages/drift.ts` via `stages/detectors/index.ts`. Each one is a pure function `(opts) => readonly DriftFinding[]`; the stage passes when no finding has `severity === 'error'`.

## Catalog

| # | name | axis | source | default severity | status policy |
|---|---|---|---|---|---|
| 1 | `UNMAPPED_ARTIFACT` | spec ↔ code | `unmapped-artifact.ts` | warn | blind |
| 2 | `MISSING_IMPLEMENTATION` | spec ↔ code | `missing-implementation.ts` | error | blind |
| 3 | `AC_DRIFT` | spec ↔ code | `ac-drift.ts` | error | blind |
| 4 | `TECH_STACK_MISMATCH` | spec ↔ code | `tech-stack-mismatch.ts` | warn | blind |
| 5 | `ARCHITECTURE_VIOLATION` | spec ↔ code | `architecture-violation.ts` | error | blind |
| 6 | `CONVENTION_DRIFT` | spec ↔ code | `convention-drift.ts` | warn | blind |
| 7 | `MISSING_TESTS` | code ↔ test | `missing-tests.ts` | warn | **aware** |
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

`axis` and `default severity` mirror the [Ironclad spec detectors.schema.json](https://github.com/qwerfunch/ironclad/blob/main/detectors.schema.json) catalog. The `status policy` column is cladding-specific (see below).

## Status policy

Two detectors check whether each acceptance criterion of a feature has surfacing test evidence on disk. For a feature that is still being authored (`status: planned` or `status: in_progress`) the test files referenced by `acceptance_criteria[].test_refs` deliberately do not exist yet — flagging them as errors would drown the real signal in progress-noise.

So `UNTESTED_AC` and `MISSING_TESTS` are **status-aware**: they only inspect features where `status === 'done'`. The other 17 detectors are **status-blind** — they check every feature regardless of lifecycle state, because their findings (a hard-coded secret in code, a broken cross-reference, a stale piece of evidence, an architecture-layer violation) are problems even when the surrounding feature is mid-flight.

### When you add a new detector

Default to **status-blind**. Status-awareness is an exception, justified only when the detector's invariant is "test evidence is in place" — which by definition is a `done`-state question. If you're tempted to make a new detector status-aware for any other reason, open an issue first; that is a policy change worth discussing.

### Upstream RFC candidate

The current `detectors.schema.json` does not encode `status_policy` as a per-detector field. Promoting this column to a normative spec field is a candidate Ironclad RFC for a future minor bump; cladding's status-aware behavior is conformant in the meantime because the spec doesn't forbid it.

## Adding a detector

1. Create `stages/detectors/<name-kebab>.ts` exporting a `DriftDetector` (see `stages/types.ts` for the contract).
2. Register it in `stages/detectors/index.ts` under `allDetectors`.
3. Add an entry to this README's catalog table.
4. Add a fixture under `conformance/` (a pass-case and a fail-case at minimum).
5. Update the corresponding row in `CHANGELOG.md` under `### Added`.
6. Run the four-check loop from `CONTRIBUTING.md` before pushing.
