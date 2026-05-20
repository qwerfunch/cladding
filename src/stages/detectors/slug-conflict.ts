// Cladding · drift detector · SLUG_CONFLICT (v0.3.9, F-084)
//
// Catches the case where two features in the loaded spec carry the
// same `slug`. The slug is the multi-developer-safe filename anchor
// (`spec/features/<slug>.yaml`); two distinct features with the same
// slug means two branches independently chose the same name and the
// merge silently overwrote one of them.
//
// File-system layout makes this *near* impossible (git would refuse
// to merge two writes to the same `spec/features/<slug>.yaml`), but
// the detector catches:
//   - hand-edits that introduce a duplicate `slug` field inside an
//     existing yaml file
//   - sharded layouts where two files with different filenames
//     happen to declare the same slug field

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'SLUG_CONFLICT';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    return [];
  }
  const seenSlugs = new Map<string, string>();
  const findings: DriftFinding[] = [];
  for (const feature of spec.features) {
    const slug = (feature as {slug?: string}).slug;
    if (!slug) continue;
    const prior = seenSlugs.get(slug);
    if (prior) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `slug '${slug}' is used by both ${prior} and ${feature.id} — ` +
          'two features cannot share a slug; pick a different slug for one of them',
      });
    } else {
      seenSlugs.set(slug, feature.id);
    }
  }
  return findings;
}

export const slugConflict: DriftDetector = {name: NAME, run};
