// Cladding · drift detector · PLANNED_BACKLOG
//
// Enforces the per-feature cadence (docs/feature-cycle.md): work ONE feature
// end-to-end before authoring the next. It counts features whose status is
// 'planned' or 'in_progress' that have NO code on disk — none of their declared
// `modules` exist, OR they declare no modules at all (a pure-AC shard). When
// that count exceeds a threshold the spec has raced ahead of the code
// (big-design-up-front / batch authoring), which breaks the spec↔code↔test
// lockstep cladding keeps, and the detector emits ONE `warn`.
//
// WHY "no code on disk" and not "declared-but-missing module": while a feature
// is planned / in_progress a declared-but-absent module is only `info` via
// MISSING_IMPLEMENTATION (F-e8912be3 — the spec-first window is normal, not
// drift; the hard `error` returns once the feature is `done`). So a lone
// in-window feature does not block, and an AC-only shard with NO modules yet
// leaves MISSING_IMPLEMENTATION nothing to check while STATUS_DRIFT's hollow
// guard is done-only — 40 specced-but-codeless features would pass GREEN.
// Counting "planned/in_progress with zero existing modules" is the signal that
// closes exactly that gap (and subsumes the all-modules-missing case too).
//
// WHY warn, not error: a deliberate, short design-spike (a few AC-only shards
// sketched just before the code) is legitimate planning, so it must not
// hard-break a conversational session. `warn` nudges locally yet BLOCKS under
// `--strict` (push / CI / the `--with-hook` pre-commit gate) — the right
// asymmetric pressure. It rides the existing warn/strict dial in `drift.ts`; no
// new mechanism. This is a cheap signal by design: it cannot see git history,
// so "40 planned over a month" reads the same as "40 at once" — both are "the
// spec raced ahead of the code", which is the invariant we want to hold.

import {existsSync} from 'node:fs';
import {join} from 'node:path';

import type {Feature, Spec} from '../../spec/types.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';
import {withSpec} from './with-spec.js';

const NAME = 'PLANNED_BACKLOG';

/**
 * Max number of code-less planned/in_progress features tolerated before the
 * batch-ahead anti-pattern is flagged. Generous enough to allow a small
 * design-spike; a backlog authored in bulk (the A/B run produced 42 at once)
 * trips it well clear of the line.
 */
export const DEFAULT_MAX_PLANNED_AHEAD = 5;

/** How many stalled ids to name inline before truncating with an ellipsis. */
const MAX_NAMED = 8;

function runPlannedBacklog(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  return withSpec(cwd, NAME, (spec) => detect(spec, cwd));
}

/** A feature "has code" iff it declares at least one module that exists on disk. */
function hasCodeOnDisk(feature: Feature, cwd: string): boolean {
  return (feature.modules ?? []).some((m) => existsSync(join(cwd, m)));
}

function detect(spec: Spec, cwd: string): readonly DriftFinding[] {
  const stalled: string[] = [];
  for (const feature of spec.features) {
    if (feature.status !== 'planned' && feature.status !== 'in_progress') continue;
    if (!hasCodeOnDisk(feature, cwd)) stalled.push(feature.id);
  }
  const threshold = DEFAULT_MAX_PLANNED_AHEAD;
  if (stalled.length <= threshold) return [];
  const named = stalled.slice(0, MAX_NAMED).join(', ');
  const tail = stalled.length > MAX_NAMED ? ', …' : '';
  return [
    {
      detector: NAME,
      severity: 'warn',
      message:
        `${stalled.length} planned/in_progress features have NO code on disk ` +
        `(> ${threshold} tolerated) — the spec has raced ahead of the code. ` +
        'Work one feature end-to-end before authoring the next ' +
        `(docs/feature-cycle.md). Stalled: ${named}${tail}`,
    },
  ];
}

export const plannedBacklog: DriftDetector = {
  name: NAME,
  run: runPlannedBacklog,
};
