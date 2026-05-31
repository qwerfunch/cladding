// Cladding · drift detector · INVENTORY_DRIFT (v0.4.x)
//
// spec.yaml's `inventory:` block (features / scenarios / capabilities /
// test_files counts) is the one-file summary AI agents grep to see a project's
// scale. It is auto-maintained by `clad sync` — but if a shard is created or
// deleted without a sync (e.g. a host LLM calls clad_create_feature 40× and
// never syncs), the declared counts silently desync from reality. The A/B run
// that motivated this detector showed exactly that: 40 feature shards on disk
// while `inventory.features` still read 0 — a hollow spec the gate let pass.
//
// This is the missing guard: a within-spec-validity check that errors when the
// declared inventory disagrees with the real shard/test count. The cure is
// always `clad sync` (and the create tools now auto-sync, so a fresh project
// should never trip this — it catches hand-edits and stale checkouts).

import {computeInventory} from '../../spec/inventory.js';
import {loadSpec} from '../../spec/load.js';
import type {CommandStageOptions, DriftDetector, DriftFinding} from '../types.js';

const NAME = 'INVENTORY_DRIFT';

/** The four counted dimensions + a human label for the message. */
const DIMENSIONS: ReadonlyArray<readonly ['features' | 'scenarios' | 'capabilities' | 'test_files', string]> = [
  ['features', 'feature shard(s)'],
  ['scenarios', 'scenario shard(s)'],
  ['capabilities', 'capabilit(ies)'],
  ['test_files', 'test file(s)'],
];

function run(opts: CommandStageOptions): readonly DriftFinding[] {
  const {cwd = '.'} = opts;
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch {
    // Load-failure policy (see detectors/with-spec.ts): within-spec-validity
    // detector — nothing to reconcile without a loaded spec; ABSENCE_OF_GOVERNANCE
    // + the info-emitting detectors already surface the failure.
    return [];
  }

  const declared = spec.inventory;
  // No inventory block declared (a hand-authored or pre-v0.3.56 spec) → nothing
  // to drift-check; clad sync writes the block on its next run.
  if (!declared) return [];

  const actual = computeInventory(cwd);
  const findings: DriftFinding[] = [];
  for (const [key, label] of DIMENSIONS) {
    const d = declared[key] ?? 0;
    const a = actual[key] ?? 0;
    if (d !== a) {
      findings.push({
        detector: NAME,
        severity: 'error',
        path: 'spec.yaml',
        message:
          `spec.yaml inventory.${key} declares ${d} but the project has ${a} ${label} on disk` +
          " — run `clad sync` (a stale inventory hides created/deleted shards from anyone reading spec.yaml).",
      });
    }
  }
  return findings;
}

export const inventoryDrift: DriftDetector = {name: NAME, run};
