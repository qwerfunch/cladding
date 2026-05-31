// Cladding · drift detector · PROJECT_CONTEXT_DRIFT
//
// The deferred detector from docs/ssot-model.md (Q-audit). `docs/project-context.md`
// is the Tier-B "why does this exist" narrative, but it has the weakest firing path:
// written once at onboarding, then orphaned — nothing escalates a project-context
// that was never filled in. Both A/B builds left it as the deterministic init
// fallback (the "_Refine by hand or re-run with LLM available._" stub) over 20+
// features, and the gate stayed GREEN.
//
// This detector flags a GROWN project whose project-context.md is still a verbatim
// init TEMPLATE — detected by the placeholder sentinels the two seed templates
// carry (a refined doc replaces them with real prose). Scale-gated: a small/early
// project may legitimately leave it stubbed. warn, not error: it rides the
// warn/strict dial — advisory locally, blocking under --strict.

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'PROJECT_CONTEXT_DRIFT';

/** Below this feature count a stubbed project-context is acceptable. */
export const DEFAULT_MIN_FEATURES_FOR_CONTEXT = 8;

// Placeholder sentinels emitted by the two unrefined project-context templates
// (intent-path deterministic fallback + greenfield no-context template). A refined
// doc — hand-authored or LLM-written — replaces these prompts with real prose, so
// their presence is a reliable "never filled in" signal.
const UNREFINED_MARKERS = [
  'Refine by hand or re-run with LLM available', // deterministic intent fallback
  'What gap or pain led to this project', // greenfield template §1 prompt
  'What does success look like', // greenfield template §3 prompt
];

function runProjectContextDrift(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

function resolveThreshold(): number {
  return DEFAULT_MIN_FEATURES_FOR_CONTEXT;
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  if (spec.features.length < resolveThreshold()) return [];
  const path = join(cwd, 'docs', 'project-context.md');
  if (!existsSync(path)) return []; // absence is ABSENCE_OF_GOVERNANCE's job

  let body: string;
  try {
    body = readFileSync(path, 'utf8');
  } catch {
    return [];
  }
  if (!UNREFINED_MARKERS.some((m) => body.includes(m))) return [];

  return [
    {
      detector: NAME,
      severity: 'warn',
      path: 'docs/project-context.md',
      message:
        `${spec.features.length} features but docs/project-context.md is still the unrefined init ` +
        'template (it still carries the placeholder prompts) — the Why/What/Purpose narrative was ' +
        'never filled in. Refine it with `clad refine` or by hand.',
    },
  ];
}

export const projectContextDrift: DriftDetector = {name: NAME, run: runProjectContextDrift};
