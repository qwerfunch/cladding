// Cladding · drift detector · withSpec — shared spec-load seam
//
// Before this helper, 19 detectors hand-rolled the same
// `try { loadSpec } catch { … }` boilerplate — and did so
// inconsistently: some returned `[]` (silent, reads as "checked, all
// clear" = a Vacuous-Green false pass), others returned a single
// `info` finding. This helper makes the load + failure policy a
// SINGLE decision applied uniformly:
//
//   - spec loads → run the detector body against it.
//   - spec fails to load → emit ONE `info`-severity finding naming the
//     detector + the reason. `info` is honest (visible in JSON / verbose
//     output) yet non-blocking — the authoritative "no governance" signal
//     is ABSENCE_OF_GOVERNANCE, so individual detectors stay quiet on the
//     gate while still reporting *why* they could not evaluate.
//
// This is also the one place to evolve missing-spec tolerance (e.g. a
// sharded `spec/features/` project whose master `spec.yaml` is absent):
// fix it in `spec/load.ts` + here, not across 19 call sites.
//
// LOAD-FAILURE POLICY (deliberate, v0.4.x) — `info` vs silent `[]`:
//
//   The 11 SPEC-vs-REALITY detectors route through withSpec and emit `info`
//   on load failure (missing-implementation, missing-tests, untested-ac,
//   status-drift, stale-specification, ac-drift, reference-integrity,
//   tech-stack-mismatch, unmapped-artifact, convention-drift, stale-tests).
//   They compare the spec to code/tests, so "couldn't load the spec" is
//   worth saying out loud.
//
//   The 6 WITHIN-SPEC-VALIDITY detectors deliberately do NOT use withSpec —
//   they return `[]` on load failure (id-collision, slug-conflict,
//   ac-duplicate-within-feature, ai-hints-forbidden-pattern,
//   architecture-from-spec, capabilities-feature-mapping). Their job is to
//   find inconsistencies *inside* a loaded spec (duplicate ids/slugs/ACs,
//   forbidden-pattern scans driven by ai_hints, capability/architecture
//   mappings); with no loadable spec there is genuinely nothing to check.
//   The load failure is NOT hidden: ABSENCE_OF_GOVERNANCE reports an absent
//   spec, and the 11 info-emitting detectors above report any load failure
//   (including an unparseable spec). Adding 6 more "spec.yaml not loaded"
//   lines would be pure noise, not extra honesty — so silence here is
//   intentional, not Vacuous Green. Each of the 6 carries a one-line pointer
//   back to this policy so the `return []` is not mistaken for an oversight.
//
// @see docs/ssot-model.md — Cross-document consistency rules.

import {loadSpec} from '../../spec/load.js';
import type {Spec} from '../../spec/types.js';
import type {DriftFinding} from '../types.js';

/**
 * Loads the spec for `cwd` and hands it to `evaluate`. On load failure
 * returns a single `info` finding attributed to `detector` instead of
 * silently passing.
 *
 * @param cwd - Project root.
 * @param detector - The calling detector's NAME (for finding attribution).
 * @param evaluate - Detector body; receives the resolved {@link Spec}.
 * @returns The detector's findings, or a single `info` finding on load failure.
 */
export function withSpec(
  cwd: string,
  detector: string,
  evaluate: (spec: Spec) => readonly DriftFinding[],
): readonly DriftFinding[] {
  let spec: Spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return [
      {
        detector,
        severity: 'info',
        message: `spec.yaml not loaded: ${(err as Error).message}`,
      },
    ];
  }
  return evaluate(spec);
}
