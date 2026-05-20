// Cladding · drift detector · ID_COLLISION (v0.3.9, F-084)
//
// Catches the case where two features in the loaded spec carry the
// same `id`. With the new hash-id model the collision probability is
// < 1/16M (the hash input bundles slug + user + hostname + timestamp
// + hrtime), but the detector still checks because a 1/16M event is
// not 0 and the audit trail breaks the moment two features share an
// id. Also catches the legacy case of a duplicate F-NNN that a human
// might have copy-pasted by mistake.

import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'ID_COLLISION';

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    return [];
  }
  const seen = new Map<string, number>();
  for (const feature of spec.features) {
    seen.set(feature.id, (seen.get(feature.id) ?? 0) + 1);
  }
  const findings: DriftFinding[] = [];
  for (const [id, count] of seen) {
    if (count > 1) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `feature id '${id}' appears ${count} times across spec/features/ — ` +
          'every feature must have a unique id; resolve the duplicate',
      });
    }
  }
  return findings;
}

export const idCollision: DriftDetector = {name: NAME, run};
