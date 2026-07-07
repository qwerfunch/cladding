// Cladding · drift-detector shared util · the spec-first window
//
// The spec-first window is the documented intermediate state of the feature
// cycle: a feature whose shard is authored (status `planned`) or being
// implemented (status `in_progress`) legitimately declares modules that do
// not exist on disk yet — the cycle prescribes authoring the spec entry
// BEFORE the code. Three spec-vs-code detectors consult this exact window to
// graduate their severity (a normal `info` inside it, a blocking
// `error`/`warn` outside it):
//   - MISSING_IMPLEMENTATION (F-e8912be3) — declared-but-absent module
//   - STATUS_DRIFT           (F-c3747d7d) — in_progress + all modules missing
//   - STALE_SPECIFICATION    (F-c3747d7d) — planned/in_progress + all missing
// Defining the predicate ONCE here keeps the window from drifting between
// those detectors (the whole point of F-c3747d7d).
//
// This is a pure helper, NOT a registered detector — it exports no
// `DriftDetector`, is absent from `allDetectors`, and is excluded from the
// detector file count (harness-integrity.ts `countDetectorFiles` /
// build-plugin.mjs Phase D), exactly like the sibling `with-spec.ts` helper.

import type {FeatureStatus} from '../../spec/types.js';

/**
 * Whether a feature status sits inside the spec-first window.
 *
 * `planned` (shard authored) and `in_progress` (implementing) are the two
 * window states where declared-but-absent modules are the documented normal.
 * Everything else — `done`, `archived`, `blocked`, any future status — is
 * shipped-or-final and keeps the original blocking severity.
 *
 * @param status - The feature's lifecycle status.
 * @returns `true` when the feature is `planned` or `in_progress`.
 */
export function isSpecFirstWindow(status: FeatureStatus): boolean {
  return status === 'planned' || status === 'in_progress';
}
