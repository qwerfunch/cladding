// Cladding · drift detector · HOLLOW_GOVERNANCE
//
// Closes the design-tier "two-layer Vacuous Green" the A/B evaluation exposed:
// `clad init` SEEDS spec/capabilities.yaml (`capabilities: []`) and
// spec/architecture.yaml (`layers: []`) as empty templates. Those empty seeds
// (1) satisfy ABSENCE_OF_GOVERNANCE's existence-only check, and (2) make
// CAPABILITIES_FEATURE_MAPPING / ARCHITECTURE_FROM_SPEC early-return on empty
// content — so a 23-feature project ships with an entirely empty design SSoT and
// the strict gate stays GREEN. (Verified: both A/B builds, 23 and 6 features,
// 0 blocking findings.)
//
// This detector adds the missing SCALE-AWARE, CONTENT-aware signal: once a
// project has grown past a feature threshold, a PRESENT-but-EMPTY design
// artifact is drift, not a legitimately-small project. It is the design-tier
// sibling of PLANNED_BACKLOG — but deliberately STATUS-BLIND: it counts ALL
// features, because PLANNED_BACKLOG counts only planned/in_progress and would
// no-op on the all-`done` builds the gap actually appeared in.
//
// DIVISION OF LABOUR with ABSENCE_OF_GOVERNANCE: ABSENCE owns EXISTENCE (file
// missing → warn); HOLLOW_GOVERNANCE owns PRESENT-but-EMPTY content. A missing
// file is NOT double-reported here — we flag only a file that exists yet carries
// no design content.
//
// warn, not error: a small/early project legitimately defers its design docs, so
// the signal rides the existing warn/strict dial — advisory locally, BLOCKING
// under --strict at push/CI. The feature threshold is a hardcoded constant (an
// ai_hints override can plug into resolveThreshold later, as with PLANNED_BACKLOG).

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'HOLLOW_GOVERNANCE';

/**
 * Below this feature count a project may legitimately have no architecture /
 * capabilities yet, so the detector stays silent. Generous enough that an early
 * prototype is never nagged; the A/B's 23-feature build trips it well clear.
 */
export const DEFAULT_MIN_FEATURES_FOR_DESIGN = 8;

function runHollowGovernance(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

/** Constant for now; the ai_hints override seam lands here when a project needs it. */
function resolveThreshold(): number {
  return DEFAULT_MIN_FEATURES_FOR_DESIGN;
}

/** True when spec/capabilities.yaml exists but declares zero capabilities. */
function capabilitiesPresentButEmpty(cwd: string): boolean {
  const path = join(cwd, 'spec/capabilities.yaml');
  if (!existsSync(path)) return false; // absence is ABSENCE_OF_GOVERNANCE's job
  try {
    const obj = yaml.parse(readFileSync(path, 'utf8')) as {capabilities?: unknown} | null;
    if (!obj || typeof obj !== 'object') return false; // malformed → not our concern
    const caps = obj.capabilities;
    return !Array.isArray(caps) || caps.length === 0;
  } catch {
    return false;
  }
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const featureCount = spec.features.length;
  if (featureCount < resolveThreshold()) return [];

  const findings: DriftFinding[] = [];

  if (capabilitiesPresentButEmpty(cwd)) {
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: 'spec/capabilities.yaml',
      message:
        `${featureCount} features but spec/capabilities.yaml declares no capabilities ` +
        '(capabilities: []) — the design SSoT is an empty seed. Populate it (capability ↔ feature ' +
        'links) or run `clad init --scan`.',
    });
  }

  // architecture is loaded into spec.architecture only when present (inline or
  // spec/architecture.yaml); an absent architecture is undefined → ABSENCE owns it.
  if (spec.architecture && (spec.architecture.layers ?? []).length === 0) {
    findings.push({
      detector: NAME,
      severity: 'warn',
      path: 'spec/architecture.yaml',
      message:
        `${featureCount} features but spec/architecture.yaml declares no layers ` +
        '(layers: []) — the architecture SSoT is an empty seed. Populate it or run `clad init --scan`.',
    });
  }

  return findings;
}

export const hollowGovernance: DriftDetector = {
  name: NAME,
  run: runHollowGovernance,
};
