// Cladding · spec · inventory tests (F-5b9f9f, v0.3.56)

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  computeInventory,
  upsertInventoryBlock,
  writeInventoryToSpecYaml,
} from '../../src/spec/inventory.js';

describe('computeInventory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-inventory-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('empty tree → all zeroes + last_synced date', () => {
    const inv = computeInventory(dir);
    expect(inv.features).toBe(0);
    expect(inv.scenarios).toBe(0);
    expect(inv.capabilities).toBe(0);
    expect(inv.test_files).toBe(0);
    expect(inv.last_synced).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('counts feature + scenario shards under spec/', () => {
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'a-abc123.yaml'), 'id: F-abc123\n');
    writeFileSync(join(dir, 'spec', 'features', 'b-def456.yaml'), 'id: F-def456\n');
    writeFileSync(join(dir, 'spec', 'scenarios', 's-xyz789.yaml'), 'id: S-xyz789\n');
    writeFileSync(join(dir, 'spec', 'scenarios', 'README.md'), '# index');
    const inv = computeInventory(dir);
    expect(inv.features).toBe(2);
    expect(inv.scenarios).toBe(1); // README.md excluded
  });

  test('counts capabilities entries in spec/capabilities.yaml', () => {
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'capabilities.yaml'),
      'schema: "0.1"\ncapabilities:\n  - id: a\n    title: A\n  - id: b\n    title: B\n  - id: c\n    title: C\n',
    );
    const inv = computeInventory(dir);
    expect(inv.capabilities).toBe(3);
  });

  test('counts *.test.ts(x) under tests/ recursively', () => {
    mkdirSync(join(dir, 'tests', 'nested'), {recursive: true});
    writeFileSync(join(dir, 'tests', 'a.test.ts'), '');
    writeFileSync(join(dir, 'tests', 'nested', 'b.test.tsx'), '');
    writeFileSync(join(dir, 'tests', 'nested', 'helpers.ts'), ''); // not a test
    const inv = computeInventory(dir);
    expect(inv.test_files).toBe(2);
  });
});

describe('upsertInventoryBlock', () => {
  const inv = {
    features: 5,
    scenarios: 2,
    capabilities: 3,
    test_files: 12,
    last_synced: '2026-05-21',
  };

  test('appends block when none exists', () => {
    const body = 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n';
    const out = upsertInventoryBlock(body, inv);
    expect(out).toContain('inventory:');
    expect(out).toContain('  features: 5');
    expect(out).toContain('  last_synced: "2026-05-21"');
    // Original content preserved.
    expect(out).toContain('name: x');
  });

  test('replaces existing block in place', () => {
    const body = [
      'schema: "0.1"',
      'project:',
      '  name: x',
      '  language: typescript',
      'features: []',
      '',
      '# Auto-maintained by `clad sync` (F-5b9f9f). Do not edit by hand.',
      'inventory:',
      '  features: 1',
      '  scenarios: 0',
      '  capabilities: 0',
      '  test_files: 0',
      '  last_synced: "2026-05-20"',
      '',
    ].join('\n');
    const out = upsertInventoryBlock(body, inv);
    // New values present.
    expect(out).toContain('  features: 5');
    expect(out).toContain('  last_synced: "2026-05-21"');
    // Old values gone (only one features count present).
    const featureLines = out.split('\n').filter((l) => l.trim().startsWith('features:'));
    expect(featureLines.length).toBe(2); // top-level `features: []` + `  features: 5`
  });

  test('writeInventoryToSpecYaml round-trip', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-inv-write-'));
    try {
      writeFileSync(
        join(dir, 'spec.yaml'),
        'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n',
      );
      writeInventoryToSpecYaml(dir, inv);
      const body = readFileSync(join(dir, 'spec.yaml'), 'utf8');
      expect(body).toContain('inventory:');
      expect(body).toContain('  features: 5');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('no spec.yaml → noop', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-inv-noop-'));
    try {
      writeInventoryToSpecYaml(dir, inv);
      // No error; just no file.
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
