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
