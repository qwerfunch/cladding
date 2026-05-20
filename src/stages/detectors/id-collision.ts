// Cladding · drift detector · ID_COLLISION (v0.3.9 + v0.3.12)
//
// Catches the case where two features OR two scenarios in the loaded
// spec carry the same `id`. With the new hash-id model the collision
// probability is < 1/16M (the hash input bundles slug + user +
// hostname + timestamp + hrtime), but the detector still checks
// because a 1/16M event is not 0 and the audit trail breaks the
// moment two items share an id. Also catches the legacy case of a
// duplicate F-NNN / S-NNN that a human might have copy-pasted.
//
// Feature ids (F-*) and scenario ids (S-*) live in separate prefixes
// so they can never collide with each other; the detector checks
// uniqueness within each namespace.

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
  const findings: DriftFinding[] = [];
  checkIds(
    spec.features.map((f) => f.id),
    'feature',
    'spec/features/',
    findings,
  );
  checkIds(
    (spec.scenarios ?? []).map((s) => s.id),
    'scenario',
    'spec/scenarios/',
    findings,
  );
  return findings;
}

function checkIds(
  ids: readonly string[],
  kind: string,
  path: string,
  findings: DriftFinding[],
): void {
  const seen = new Map<string, number>();
  for (const id of ids) {
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) {
    if (count > 1) {
      findings.push({
        detector: NAME,
        severity: 'error',
        message:
          `${kind} id '${id}' appears ${count} times across ${path} — ` +
          `every ${kind} must have a unique id; resolve the duplicate`,
      });
    }
  }
}

export const idCollision: DriftDetector = {name: NAME, run};
