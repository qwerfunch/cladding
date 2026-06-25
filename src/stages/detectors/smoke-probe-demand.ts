// Cladding · drift detector · SMOKE_PROBE_DEMAND (F-c')
//
// Closes the "host just doesn't author a smoke ⇒ silent green" hole. The
// host PROPOSES the smoke method, but it does NOT get to SKIP smoke: a project
// that ships a runnable deliverable AND has done features but declares no
// functional smoke probe (`project.smoke`) is a demand miss, not a pass — an
// exit-only deliverable is LIVENESS (proves it runs), never AC-verification.
//
// SOLE OWNER of the smoke demand (the skip-policy stage_2.4 arm is retired in
// F-c'): the demand lives here at the pure stage_1.3 detector layer, so it fires
// on every tier that runs drift, not only under --strict-gated skip-policy.
//
// Presence-only + demand-gated (v1): no demand when nothing is done, or when the
// project has no runnable deliverable (a library/static project ⇒ N/A, owned by
// the smoke stage). Per-feature/per-module binding is deferred (F-c full).

import type {Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'SMOKE_PROBE_DEMAND';

function detect(spec: Spec): readonly DriftFinding[] {
  const done = (spec.features ?? []).filter((f) => f.status === 'done');
  if (done.length === 0) return []; // nothing shipped — no demand yet
  const hasRunnableDeliverable = Boolean(spec.project?.deliverable);
  if (!hasRunnableDeliverable) return []; // no runnable entry (library/static) ⇒ N/A, not a demand
  const hasProbe = (spec.project?.smoke ?? []).length > 0;
  if (hasProbe) return []; // demand satisfied — a functional probe is declared
  return [
    {
      detector: NAME,
      severity: 'warn',
      path: 'spec.yaml',
      message:
        `${done.length} feature(s) are done and the project ships a runnable deliverable, but no functional ` +
        'smoke probe is declared (project.smoke) — an exit-only deliverable is liveness, not AC-verification. ' +
        'Declare a smoke probe with an expect.token so the gate re-executes the shipped entry against its AC result.',
    },
  ];
}

function runSmokeProbeDemand(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec));
}

export const smokeProbeDemand: DriftDetector = {
  name: NAME,
  run: runSmokeProbeDemand,
};
