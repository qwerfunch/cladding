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

import {existsSync, readFileSync, readdirSync} from 'node:fs';

import {computeInventory} from '../../spec/inventory.js';
import {join} from 'node:path';
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

  const actual = computeInventory(cwd);

  const declared = spec.inventory;
  // No inventory block declared. Previously this returned [] — but that let a
  // hollow spec (shards on disk, no recorded inventory) slip through entirely,
  // the exact loophole this detector exists to close. So: if the project has any
  // shards on disk, warn (run `clad sync` to record the block); a genuinely empty
  // project (0 shards) legitimately needs no inventory and stays silent.
  if (!declared) {
    const present = DIMENSIONS.filter(([key]) => (actual[key] ?? 0) > 0);
    if (present.length === 0) return indexStaleness(cwd);
    const summary = present.map(([key, label]) => `${actual[key] ?? 0} ${label}`).join(', ');
    return [
      ...indexStaleness(cwd),
      {
        detector: NAME,
        severity: 'warn',
        path: 'spec.yaml',
        message:
          `spec.yaml has no inventory: block, but the project has ${summary} on disk — ` +
          'run `clad sync` to record the inventory so anyone reading spec.yaml sees its real scale.',
      },
    ];
  }


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
  findings.push(...indexStaleness(cwd));
  return findings;
}

/**
 * F-37b4a8 — the committed generated index must agree with the shards. A
 * stale index is worse than none: agents trust it for 1-file lookup, so a
 * missing/extra id silently misleads them. Same cure as count drift.
 */
function indexStaleness(cwd: string): readonly DriftFinding[] {
  const indexPath = join(cwd, 'spec', 'index.yaml');
  const featuresDir = join(cwd, 'spec', 'features');
  if (!existsSync(indexPath) || !existsSync(featuresDir)) return [];
  const inIndex = new Set<string>();
  try {
    for (const line of readFileSync(indexPath, 'utf8').split('\n')) {
      const m = line.match(/^  (F-[\w-]+):/);
      if (m) inIndex.add(m[1]);
    }
  } catch {
    return [];
  }
  const onDisk = new Set<string>();
  try {
    for (const file of readdirSync(featuresDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const m = readFileSync(join(featuresDir, file), 'utf8').match(/^id:\s*['\"]?(F-[\w-]+)['\"]?/m);
      if (m) onDisk.add(m[1]);
    }
  } catch {
    return [];
  }
  const missing = [...onDisk].filter((id) => !inIndex.has(id)).sort();
  const extra = [...inIndex].filter((id) => !onDisk.has(id)).sort();
  if (missing.length === 0 && extra.length === 0) return [];
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`missing from index: ${missing.join(', ')}`);
  if (extra.length > 0) parts.push(`in index but not on disk: ${extra.join(', ')}`);
  return [
    {
      detector: NAME,
      severity: 'error',
      path: 'spec/index.yaml',
      message:
        `spec/index.yaml disagrees with spec/features/ (${parts.join('; ')})` +
        ' — run `clad sync` to regenerate (a stale index silently misleads agents that trust it for lookup).',
    },
  ];
}

export const inventoryDrift: DriftDetector = {name: NAME, run};
