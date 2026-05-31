// Cladding · unit tests for stages/detectors/inventory-drift.ts
//
// INVENTORY_DRIFT errors when spec.yaml's declared `inventory:` counts disagree
// with the real shard/test count on disk — the guard that catches a host LLM
// creating shards without running `clad sync` (the A/B run that motivated it).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {inventoryDrift} from '../../src/stages/detectors/inventory-drift.js';

const BASE = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n';

/** spec.yaml body with (or without) a declared inventory.features count. */
function specYaml(declaredFeatures: number | null): string {
  if (declaredFeatures === null) return BASE;
  return (
    BASE +
    `inventory:\n  features: ${declaredFeatures}\n  scenarios: 0\n  capabilities: 0\n  test_files: 0\n`
  );
}

describe('INVENTORY_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-inv-drift-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  function addShard(id: string, slug: string): void {
    writeFileSync(
      join(dir, 'spec', 'features', `${slug}-${id.slice(2)}.yaml`),
      `id: ${id}\nslug: ${slug}\ntitle: "x"\nstatus: planned\nmodules: []\nacceptance_criteria: []\n`,
    );
  }

  test('errors when declared inventory.features < actual shard count (the hollow-spec desync)', () => {
    writeFileSync(join(dir, 'spec.yaml'), specYaml(0)); // declares 0
    addShard('F-aaa111', 'one');
    addShard('F-bbb222', 'two'); // 2 shards on disk, inventory says 0
    const findings = inventoryDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].detector).toBe('INVENTORY_DRIFT');
    expect(findings[0].message).toContain('inventory.features declares 0');
    expect(findings[0].message).toContain('2 feature');
    expect(findings[0].message).toContain('clad sync');
  });

  test('clean when the declared inventory matches the real shard count', () => {
    writeFileSync(join(dir, 'spec.yaml'), specYaml(1));
    addShard('F-ccc333', 'one'); // 1 shard, inventory says 1
    expect(inventoryDrift.run({cwd: dir})).toEqual([]);
  });

  test('warns when no inventory block is declared but shards exist (closes the absent-block loophole)', () => {
    // The previous behaviour returned [] here — which let a hollow spec (shards on
    // disk, no recorded inventory) slip through entirely. It must now nudge `clad sync`.
    writeFileSync(join(dir, 'spec.yaml'), specYaml(null));
    addShard('F-ddd444', 'one');
    const findings = inventoryDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('no inventory: block');
    expect(findings[0].message).toContain('1 feature');
    expect(findings[0].message).toContain('clad sync');
  });

  test('skips silently when no inventory block AND no shards (a genuinely empty/fresh project)', () => {
    writeFileSync(join(dir, 'spec.yaml'), specYaml(null));
    // no shards added
    expect(inventoryDrift.run({cwd: dir})).toEqual([]);
  });

  test('skips silently when there is no loadable spec (within-spec-validity policy)', () => {
    // no spec.yaml written
    expect(inventoryDrift.run({cwd: dir})).toEqual([]);
  });
});
