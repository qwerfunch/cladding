// Cladding · drift detector · MISSING_IMPLEMENTATION
//
// First Ironclad-native detector (T4). Detector #2 from the catalog
// (axis: spec_vs_code, severity: error).
//
// Compares `features[].modules` from spec.yaml against the actual file
// system. A module declared in the spec but absent from disk is a
// concrete, unambiguous drift — the feature has been *promised* but
// not implemented (or was renamed without spec update).
//
// Status-aware since F-e8912be3: for `planned` / `in_progress` features
// the absence is the *normal* spec-first window (the shard is authored
// before the code), so it is reported as `info`, not a blocking `error`.
// Only `done` / `archived` (and any other) status keeps the `error` grade.
//
// Pure Ironclad-native: no OSS dependency, no toolchain delegation —
// just spec ↔ filesystem comparison. This is the kind of detector that
// makes cladding distinct from "just a polyglot CI wrapper".

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {FeatureStatus, Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'MISSING_IMPLEMENTATION';

/**
 * Verifies every module path declared in spec.yaml exists on disk.
 *
 * Per-feature, per-module, *status-aware*: a missing module is an `error`
 * for `done` / `archived` features (shipped-code drift) but only `info`
 * for `planned` / `in_progress` ones — those sit inside the documented
 * spec-first window where the shard is authored before the code exists.
 * When spec.yaml itself cannot be loaded, emits a single `info` finding
 * — the detector is *opt-in* on spec presence, not a failure on
 * spec-less projects.
 *
 * @see iron-law.md stage_1.3 — detector contract.
 * @see ironclad-design/08-drift-detectors.md — MISSING_IMPLEMENTATION (#2).
 */
function runMissingImplementation(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    for (const modulePath of feature.modules ?? []) {
      const absolute = join(cwd, modulePath);
      if (existsSync(absolute)) continue;
      findings.push(missingModuleFinding(feature.id, modulePath, feature.status));
    }
  }
  return findings;
}

// The spec-first window: while a feature is `planned` (shard authored) or
// `in_progress` (implementing), its declared-but-absent modules are the
// documented intermediate state — the cycle prescribes authoring the spec
// entry before the code. Everything else (`done`, `archived`, `blocked`,
// any future status) is treated as shipped-or-final and keeps the `error`.
function isSpecFirstWindow(status: FeatureStatus): boolean {
  return status === 'planned' || status === 'in_progress';
}

/**
 * Builds the finding for a declared module that is missing on disk.
 *
 * Inside the spec-first window → `info` whose message states the absence
 * is normal, so the Stop hook and pre-commit gate no longer fight the
 * documented "author the spec entry, then implement" cycle. Otherwise →
 * `error` with the original message: `done` stays a shipped-code invariant
 * (also guarded by STATUS_DRIFT) and `archived` keeps its only guard.
 */
function missingModuleFinding(
  featureId: string,
  modulePath: string,
  status: FeatureStatus,
): DriftFinding {
  if (isSpecFirstWindow(status)) {
    return {
      detector: NAME,
      severity: 'info',
      path: modulePath,
      message:
        `feature ${featureId}'s module '${modulePath}' is not built yet` +
        ' — the normal state between authoring the spec entry and implementing it',
    };
  }
  return {
    detector: NAME,
    severity: 'error',
    path: modulePath,
    message:
      `feature ${featureId} declares module '${modulePath}'` +
      ' but the file does not exist',
  };
}

export const missingImplementation: DriftDetector = {
  name: NAME,
  run: runMissingImplementation,
};
