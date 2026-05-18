// Cladding · scripts/shard-spec.ts — convert master spec.yaml to sharded layout
//
// One-shot migration helper that splits cladding's own spec.yaml into
// spec/features/F-NNN.yaml, spec/scenarios/S-NNN.yaml, and
// spec/architecture.yaml. The master spec.yaml shrinks to just
// `schema` and `project`. `loadSpec()` auto-detects the sharded layout
// (see spec/load.ts), so all downstream behaviour is byte-identical
// after this script runs.
//
// Usage (one-shot):  npx tsx scripts/shard-spec.ts
//
// Idempotent: re-running with an already-sharded master spec writes
// the same files. Safe to commit the script for future projects that
// outgrow the inline layout.

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

import {stringify} from 'yaml';

import {parseSpec} from '../spec/parse.js';
import type {Spec} from '../spec/types.js';

const cwd = process.cwd();
const masterPath = join(cwd, 'spec.yaml');
const spec = parseSpec(masterPath) as Spec;

const featuresDir = join(cwd, 'spec', 'features');
mkdirSync(featuresDir, {recursive: true});
for (const feature of spec.features) {
  writeFileSync(join(featuresDir, `${feature.id}.yaml`), stringify(feature));
}
console.log(`✓ wrote ${spec.features.length} feature(s) to spec/features/`);

if (spec.scenarios && spec.scenarios.length > 0) {
  const scenariosDir = join(cwd, 'spec', 'scenarios');
  mkdirSync(scenariosDir, {recursive: true});
  for (const scenario of spec.scenarios) {
    writeFileSync(join(scenariosDir, `${scenario.id}.yaml`), stringify(scenario));
  }
  console.log(`✓ wrote ${spec.scenarios.length} scenario(s) to spec/scenarios/`);
}

if (spec.architecture) {
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), stringify(spec.architecture));
  console.log('✓ wrote spec/architecture.yaml');
}

const masterHeader = [
  '# Cladding SSoT — sharded layout',
  '#',
  '# Features live in spec/features/*.yaml — one file per feature.',
  '# Scenarios live in spec/scenarios/*.yaml.',
  '# Architecture lives in spec/architecture.yaml.',
  '#',
  '# `spec/load.ts` auto-detects this layout and merges the children',
  '# back into a single Spec object on every load.',
  '',
].join('\n');
const master = {schema: spec.schema, project: spec.project};
writeFileSync(masterPath, masterHeader + stringify(master));
console.log('✓ rewrote spec.yaml (master, metadata only)');
