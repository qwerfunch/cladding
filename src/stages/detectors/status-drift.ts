// Cladding · drift detector · STATUS_DRIFT
//
// Detector #14 from the catalog (axis: spec_vs_test, severity: error).
// Cross-checks `features[].status` against the filesystem:
//   - status='done' but declares NEITHER modules NOR acceptance_criteria →
//     error (hollow completion — nothing exists to verify, so every other
//     verification detector skips it via empty-array iteration and the gate
//     passes GREEN on a pure assertion; a done feature must bind to >=1 module
//     OR declare >=1 acceptance criterion)
//   - status='done' but at least one declared module is missing → error
//     (the feature is marked complete yet its implementation is absent)
//   - status='in_progress' but every declared module is missing → info
//     (the spec-first window — authoring the shard before the code is the
//     documented normal state, F-c3747d7d; demoted from warn to match
//     MISSING_IMPLEMENTATION so the Stop hook / --strict stop blocking it)
//
// Note: we deliberately do NOT consult git log in this brick — the goal
// is a cheap signal, not a deep audit. The richer git-based version
// can land as STATUS_DRIFT_DEEP later, or be folded in once T8 brings
// the events.log subsystem online.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {isSpecFirstWindow} from './spec-first-window.js';
import {withSpec} from './with-spec.js';

const NAME = 'STATUS_DRIFT';

function runStatusDrift(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    const modules = feature.modules ?? [];
    const acs = feature.acceptance_criteria ?? [];
    // Hollow completion: 'done' but declares nothing to verify. Without this,
    // MISSING_IMPLEMENTATION / MISSING_TESTS / UNTESTED_AC / AC_DRIFT all iterate
    // empty arrays and produce zero findings, so the feature passes the gate on
    // assertion alone. Require >=1 module OR >=1 AC. (design/doc-only features
    // still declare a doc module path or an AC, so this does not false-fail them.)
    if (feature.status === 'done' && modules.length === 0 && acs.length === 0) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `feature ${feature.id} status='done' but declares no modules and no` +
          ' acceptance_criteria — nothing to verify (hollow completion)',
      });
      continue;
    }
    if (modules.length === 0) continue;
    const missing = modules.filter((m) => !existsSync(join(cwd, m)));
    if (missing.length === 0) continue;
    if (feature.status === 'done') {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `feature ${feature.id} status='done' but ${missing.length}/${modules.length}` +
          ` module(s) missing: ${missing.join(', ')}`,
      });
    } else if (feature.status === 'in_progress' && missing.length === modules.length) {
      // Spec-first window (F-c3747d7d): an in_progress feature whose declared
      // modules are ALL still absent is the documented author-then-implement
      // state, not a stale start. `isSpecFirstWindow` (in_progress ∈ window)
      // gates the grade to `info`, matching MISSING_IMPLEMENTATION, so the Stop
      // hook and --strict gate stop fighting the normal cycle. The `done`
      // branches above stay `error` — done is never spec-first (a shipped-code
      // invariant, also double-guarded by MISSING_IMPLEMENTATION).
      findings.push({
        detector: NAME,
        severity: isSpecFirstWindow(feature.status) ? 'info' : 'warn',
        message:
          `feature ${feature.id} is in progress and none of its declared modules are` +
          ' built yet — the normal state while implementing',
      });
    }
  }
  return findings;
}

export const statusDrift: DriftDetector = {
  name: NAME,
  run: runStatusDrift,
};
