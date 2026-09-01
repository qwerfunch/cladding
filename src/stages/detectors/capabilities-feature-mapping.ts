// Cladding · drift detector · CAPABILITIES_FEATURE_MAPPING (v0.3.45, F-d12edf)
//
// Validates the consumer link between `spec/capabilities.yaml` (Tier B
// design SSoT) and `spec.yaml` features (Tier A spec SSoT). v0.3.38
// introduced `spec/capabilities.yaml` with the promise that downstream
// detectors would consume the list — until v0.3.45 the artifact was
// orphan (no detector read it). This detector closes that gap.
//
// What it enforces, drawn from `spec/capabilities.yaml`:
//
//   1. **Dangling feature id (error)** — every `capabilities[].features[]`
//      entry must resolve to a feature id present in spec.yaml. A
//      capability that names `F-doesnotexist` indicates either a
//      typo or a feature that was deleted without updating the
//      capability registry.
//
//   2. **Orphan capability (graduated)** — a capability whose `features[]`
//      is empty (or missing) is not yet bound to any feature. Intent-aware
//      onboarding deliberately emits future capability seeds before features
//      land. An explicit onboarding marker scopes information-level grace to
//      those seeds; every unmarked project retains the warning at any size.
//
//   3. **Unmapped feature (info)** — a feature in spec.yaml that no
//      capability claims via its `features[]`. Acceptable for
//      internal-only features (infrastructure, tooling); the info
//      level signals "consider whether this should be user-facing
//      and merit a capability entry."
//
// The detector is intentionally a **soft validator**: if
// `spec/capabilities.yaml` is missing or empty, every check skips
// silently. Cladding-adopting projects opt in by writing the file.
//
// @see docs/ssot-model.md — Tier B entry condition: every Tier B
//      artifact must have a clear consumer. This detector IS the
//      consumer for capabilities.yaml.
// @see spec/features/ssot-governance-d12edf.yaml AC-003 — this feature.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import {loadSpec} from '../../spec/load.js';
import type {Capability} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'CAPABILITIES_FEATURE_MAPPING';

/** Shared maturity boundary for explicitly marked onboarding design seeds. */
export const DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS = 8;

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const capabilitiesPath = join(cwd, 'spec/capabilities.yaml');
  if (!existsSync(capabilitiesPath)) return [];

  // The loader is the sole semantic source for both schemas. In particular,
  // a schema 0.2 catalog reaches this detector only through the compiler's
  // reverse-derived compatibility projection.
  let capabilities: readonly Capability[];
  let featureIds: Set<string>;
  let onboardingSeeded = false;
  try {
    const spec = loadSpec(cwd);
    capabilities = spec.capabilities ?? [];
    featureIds = new Set(spec.features.map((feature) => feature.id));
    onboardingSeeded = spec.project.onboarding_seeded === true;
  } catch {
    return [];
  }
  if (capabilities.length === 0) return [];

  const findings: DriftFinding[] = [];
  const featuresClaimedByCapabilities = new Set<string>();
  const onboardingGrace =
    onboardingSeeded && featureIds.size < DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS;

  for (const cap of capabilities) {
    const capId = cap.id;
    const features = cap.features ?? [];

    if (features.length === 0) {
      findings.push({
        detector: NAME,
        severity: onboardingGrace ? 'info' : 'warn',
        path: 'spec/capabilities.yaml',
        message: onboardingGrace
          ? `capability "${capId}" has no features mapped yet — retained as future onboarding intent; ` +
            `bind it when a matching feature lands`
          : `capability "${capId}" has no features mapped — bind at least one feature via the features[] field, ` +
            `or remove the capability if it's no longer relevant`,
      });
      continue;
    }

    for (const featureId of features) {
      if (!featureIds.has(featureId)) {
        findings.push({
          detector: NAME,
          severity: 'error',
          path: 'spec/capabilities.yaml',
          message:
            `capability "${capId}" references feature ${featureId} which does not exist in spec.yaml — ` +
            `either add the feature or remove it from this capability's features[]`,
        });
      } else {
        featuresClaimedByCapabilities.add(featureId);
      }
    }
  }

  // Info-level: features that no capability claims. Helps maintainers
  // notice when a feature is implementation-only (internal) vs
  // user-facing (should be in a capability).
  for (const featureId of featureIds) {
    if (!featuresClaimedByCapabilities.has(featureId)) {
      findings.push({
        detector: NAME,
        severity: 'info',
        path: 'spec.yaml',
        message:
          `feature ${featureId} is not claimed by any capability — if it's user-facing, ` +
          `consider adding it to a capability's features[] in spec/capabilities.yaml`,
      });
    }
  }

  return findings;
}

export const capabilitiesFeatureMapping: DriftDetector = {name: NAME, run};
