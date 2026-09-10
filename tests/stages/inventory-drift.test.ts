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
import {renderFeatureIndexYaml} from '../../src/spec/inventory.js';

const BASE = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n';

/** Test-only materialization of the pure renderer. */
function writeFeatureIndexProjection(dir: string): boolean {
  const body = renderFeatureIndexYaml(dir);
  if (body === null) return false;
  writeFileSync(join(dir, 'spec', 'index.yaml'), body);
  return true;
}

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

  test('[covers:F-eb732f/AC-003] errors when declared inventory.features < actual shard count (the hollow-spec desync)', () => {
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

// ─── F-37b4a8 — stale committed index is drift ───

describe('index staleness (F-37b4a8)', () => {
  test('[covers:F-37b4a8/AC-f1a3f5] flags a committed index whose id set disagrees with shards, names both directions, cures with clad sync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-invdrift-idx-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec', 'features', 'real-aaaa11.yaml'), 'id: F-aaaa11\nslug: real\ntitle: real\nstatus: done\nmodules: []\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
      writeFileSync(
        join(dir, 'spec', 'index.yaml'),
        'features:\n  F-gone99: {slug: ghost, status: done, modules: 0}\n',
      );
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      const findings = inventoryDrift.run({cwd: dir});
      const idx = findings.find((f) => f.path === 'spec/index.yaml');
      expect(idx?.severity).toBe('error');
      expect(idx?.message).toContain('F-aaaa11');
      expect(idx?.message).toContain('F-gone99');
      expect(idx?.message).toContain('clad sync');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('[covers:F-37b4a8/AC-f1a3f5] a regenerated (fresh) index produces no index finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-invdrift-fresh-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec', 'features', 'real-aaaa11.yaml'), 'id: F-aaaa11\nslug: real\ntitle: real\nstatus: done\nmodules: []\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
      writeFeatureIndexProjection(dir);
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      const findings = inventoryDrift.run({cwd: dir});
      expect(findings.find((f) => f.path === 'spec/index.yaml')).toBeUndefined();
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('[covers:F-37b4a8/AC-f1a3f5] flags a committed index whose row status disagrees with the shard, cured by clad sync', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-invdrift-status-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      // Shard says done; index row for the SAME id still says in_progress.
      writeFileSync(join(dir, 'spec', 'features', 'real-aaaa11.yaml'), 'id: F-aaaa11\nslug: real\ntitle: real\nstatus: done\nmodules: []\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
      writeFileSync(
        join(dir, 'spec', 'index.yaml'),
        'features:\n  F-aaaa11: {slug: real, status: in_progress, modules: 0}\n',
      );
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      const findings = inventoryDrift.run({cwd: dir});
      const idx = findings.find((f) => f.path === 'spec/index.yaml' && f.message.includes('status disagrees'));
      expect(idx?.severity).toBe('error');
      expect(idx?.message).toContain('F-aaaa11');
      expect(idx?.message).toContain('in_progress');
      expect(idx?.message).toContain('done');
      expect(idx?.message).toContain('clad sync');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('a status-less shard matches its index planned row, no false status finding', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-invdrift-noprefix-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      // No status field on the shard → writeFeatureIndex defaults the row to 'planned';
      // the detector must default the shard read to 'planned' too, so they MATCH.
      writeFileSync(join(dir, 'spec', 'features', 'real-aaaa11.yaml'), 'id: F-aaaa11\nslug: real\ntitle: real\nmodules: []\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
      writeFileSync(
        join(dir, 'spec', 'index.yaml'),
        'features:\n  F-aaaa11: {slug: real, status: planned, modules: 0}\n',
      );
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      const findings = inventoryDrift.run({cwd: dir});
      expect(findings.find((f) => f.path === 'spec/index.yaml')).toBeUndefined();
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
