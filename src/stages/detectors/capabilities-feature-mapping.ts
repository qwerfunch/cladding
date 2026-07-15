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
// @see spec/features/ssot-governance-d12edf.yaml — this feature.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'CAPABILITIES_FEATURE_MAPPING';

/** Shared maturity boundary for explicitly marked onboarding design seeds. */
export const DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS = 8;

interface CapabilityEntry {
  readonly id: string;
  readonly title?: string;
  readonly features?: readonly string[];
}

interface CapabilitiesFile {
  readonly schema?: string;
  readonly source?: string;
  readonly capabilities?: readonly CapabilityEntry[];
}

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  const capabilitiesPath = join(cwd, 'spec/capabilities.yaml');
  if (!existsSync(capabilitiesPath)) return [];

  let parsed: CapabilitiesFile;
  try {
    const raw = readFileSync(capabilitiesPath, 'utf8');
    const obj = yaml.parse(raw);
    if (!obj || typeof obj !== 'object') return [];
    parsed = obj as CapabilitiesFile;
  } catch {
    return [];
  }

  const capabilities = parsed.capabilities ?? [];
  if (capabilities.length === 0) return [];

  // Build the set of valid feature ids from spec.yaml. Defensive against
  // a missing/invalid spec — the SSoT spec detectors already flag that
  // separately; CAPABILITIES_FEATURE_MAPPING just exits silently when it
  // cannot load.
  let featureIds: Set<string>;
  let onboardingSeeded = false;
  try {
    const spec = loadSpec(cwd);
    featureIds = new Set(spec.features.map((f) => f.id));
    onboardingSeeded = spec.project.onboarding_seeded === true;
  } catch {
    // Load-failure policy (see detectors/with-spec.ts): within-spec-validity
    // detector — no spec means no capability↔feature links to validate;
    // ABSENCE_OF_GOVERNANCE + the info-emitting detectors surface the failure.
    return [];
  }

  const findings: DriftFinding[] = [];
  const featuresClaimedByCapabilities = new Set<string>();
  const onboardingGrace =
    onboardingSeeded && featureIds.size < DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS;

  for (const cap of capabilities) {
    if (typeof cap !== 'object' || cap === null) continue;
    const capId = String(cap.id ?? '(unnamed)');
    const features = Array.isArray(cap.features) ? cap.features : [];

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
      const fid = String(featureId);
      if (!featureIds.has(fid)) {
        findings.push({
          detector: NAME,
          severity: 'error',
          path: 'spec/capabilities.yaml',
          message:
            `capability "${capId}" references feature ${fid} which does not exist in spec.yaml — ` +
            `either add the feature or remove it from this capability's features[]`,
        });
      } else {
        featuresClaimedByCapabilities.add(fid);
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
