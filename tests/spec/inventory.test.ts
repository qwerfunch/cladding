// Cladding · spec · inventory tests (F-5b9f9f, v0.3.56)

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  computeInventory,
  upsertInventoryBlock,
  writeFeatureIndex,
  writeInventoryToSpecYaml,
} from '../../src/spec/inventory.js';
import {loadSpec} from '../../src/spec/load.js';
import {validateSpec} from '../../src/spec/validate.js';

describe('computeInventory', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-inventory-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('empty tree → all zeroes', () => {
    const inv = computeInventory(dir);
    expect(inv.features).toBe(0);
    expect(inv.scenarios).toBe(0);
    expect(inv.capabilities).toBe(0);
    expect(inv.test_files).toBe(0);
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
    // Old values gone (only one features count present).
    const featureLines = out.split('\n').filter((l) => l.trim().startsWith('features:'));
    expect(featureLines.length).toBe(2); // top-level `features: []` + `  features: 5`
  });

  /** No lone `\n` survives — every newline is part of a `\r\n` pair. */
  const isAllCrlf = (s: string): boolean => s.includes('\r\n') && !s.replace(/\r\n/g, '').includes('\n');

  test('CRLF body (no block) → CRLF output, no mixed endings', () => {
    const body = 'schema: "0.1"\r\nproject:\r\n  name: x\r\nfeatures: []\r\n';
    const out = upsertInventoryBlock(body, inv);
    expect(out).toContain('  features: 5');
    expect(out).toContain('name: x'); // original preserved
    expect(isAllCrlf(out)).toBe(true);
  });

  test('CRLF body (existing block) → CRLF output, updated values, no lone \\n', () => {
    const body = [
      'schema: "0.1"',
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
    ].join('\r\n');
    const out = upsertInventoryBlock(body, inv);
    expect(out).toContain('  features: 5');
    expect(isAllCrlf(out)).toBe(true); // no mixed endings — the git-autocrlf Windows bug
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

// ─── F-6e49fd24 — inventory churn diet: stop emitting last_synced ───

describe('inventory churn diet (F-6e49fd24)', () => {
  /** Extracts the indented lines under the `inventory:` key of a spec body. */
  const inventoryFields = (body: string): string[] => {
    const lines = body.split('\n');
    const start = lines.findIndex((l) => l === 'inventory:');
    if (start < 0) return [];
    const fields: string[] = [];
    for (let i = start + 1; i < lines.length && lines[i].startsWith('  '); i++) {
      fields.push(lines[i]);
    }
    return fields;
  };

  // AC-f2004981 — the block emits ONLY the four count fields, never last_synced.
  // Even when a caller hands a stray last_synced, the writer must drop it.
  test('AC-f2004981 · upserted inventory block emits only count fields, never last_synced', () => {
    const body = 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n';
    const out = upsertInventoryBlock(body, {
      features: 5,
      scenarios: 2,
      capabilities: 3,
      test_files: 12,
      last_synced: '2026-05-21', // a legacy caller hands one — it must be ignored
    });
    // Exactly the four count fields, in order — nothing else (no last_synced).
    expect(inventoryFields(out)).toEqual([
      '  features: 5',
      '  scenarios: 2',
      '  capabilities: 3',
      '  test_files: 12',
    ]);
    expect(out).not.toMatch(/last_synced/);
  });

  // AC-f2004981 — re-running sync with unchanged counts must leave spec.yaml
  // byte-for-byte identical (the whole point: no date stamp to conflict on).
  test('AC-f2004981 · re-syncing unchanged counts leaves spec.yaml byte-identical', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-churn-'));
    try {
      writeFileSync(
        join(dir, 'spec.yaml'),
        'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n',
      );
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec', 'features', 'a-abc123.yaml'), 'id: F-abc123\n');

      // First sync — appends the block from real disk counts.
      writeInventoryToSpecYaml(dir, computeInventory(dir));
      const first = readFileSync(join(dir, 'spec.yaml'), 'utf8');

      // Second sync — counts unchanged.
      writeInventoryToSpecYaml(dir, computeInventory(dir));
      const second = readFileSync(join(dir, 'spec.yaml'), 'utf8');

      expect(second).toBe(first); // byte-identical: no churn
      expect(first).not.toMatch(/last_synced/);
      expect(first).toContain('  features: 1'); // real count emitted
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  // AC-d9915fe5 — a legacy last_synced line inside the block is dropped on the
  // next upsert, while ALL surrounding hand-authored content (before AND after
  // the block) is preserved.
  test('AC-d9915fe5 · a legacy last_synced line is dropped on next upsert, all other content preserved', () => {
    const body = [
      'schema: "0.1"',
      'project:',
      '  name: my-app',
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
      '# a hand-authored trailer that must survive the rewrite',
      'notes: keep-me',
      '',
    ].join('\n');
    const out = upsertInventoryBlock(body, {
      features: 7,
      scenarios: 2,
      capabilities: 3,
      test_files: 12,
    });

    // The legacy date line is gone.
    expect(out).not.toMatch(/last_synced/);
    // Every hand-authored line — before AND after the block — survives.
    for (const marker of [
      'schema: "0.1"',
      '  name: my-app',
      '  language: typescript',
      'features: []',
      '# a hand-authored trailer that must survive the rewrite',
      'notes: keep-me',
    ]) {
      expect(out).toContain(marker);
    }
    // New counts written; block still emits count fields only.
    expect(inventoryFields(out)).toEqual([
      '  features: 7',
      '  scenarios: 2',
      '  capabilities: 3',
      '  test_files: 12',
    ]);
  });

  // AC-de828ae2 — the schema keeps last_synced optional, so spec.yaml files
  // written by older cladding versions still parse AND validate. Exercised via
  // the real validation path (validateSpec + loadSpec), not just the TS type.
  test('AC-de828ae2 · a spec.yaml carrying legacy last_synced still parses and validates', () => {
    // Direct schema path — an inventory object carrying last_synced is valid.
    const result = validateSpec({
      schema: '0.1',
      project: {name: 'legacy-app', language: 'typescript'},
      features: [],
      inventory: {features: 0, scenarios: 0, capabilities: 0, test_files: 0, last_synced: '2026-05-20'},
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);

    // Full file path — loadSpec parses + validates a real spec.yaml on disk and
    // preserves the legacy field rather than rejecting it.
    const dir = mkdtempSync(join(tmpdir(), 'clad-legacy-'));
    try {
      writeFileSync(
        join(dir, 'spec.yaml'),
        [
          'schema: "0.1"',
          'project:',
          '  name: legacy-app',
          '  language: typescript',
          'features: []',
          '',
          '# Auto-maintained by `clad sync` (F-5b9f9f). Do not edit by hand.',
          'inventory:',
          '  features: 0',
          '  scenarios: 0',
          '  capabilities: 0',
          '  test_files: 0',
          '  last_synced: "2026-05-20"',
          '',
        ].join('\n'),
      );
      const spec = loadSpec(dir); // throws if validation rejects last_synced
      expect(spec.inventory?.last_synced).toBe('2026-05-20');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── F-37b4a8 — generated feature index ───

describe('writeFeatureIndex (F-37b4a8)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-index-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  const shard = (id: string, slug: string, status: string, modules: number): string =>
    `id: ${id}\nslug: ${slug}\nstatus: ${status}\nmodules:\n${Array.from({length: modules}, (_, i) => `  - src/m${i}.ts`).join('\n')}\n`;

  test('emits an id-sorted, Tier-C-bannered, one-line-per-feature index', () => {
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'b-zz9999.yaml'), shard('F-zz9999', 'b-feat', 'done', 2));
    writeFileSync(join(dir, 'spec', 'features', 'a-aa1111.yaml'), shard('F-aa1111', 'a-feat', 'in_progress', 1));

    expect(writeFeatureIndex(dir)).toBe(true);
    const body = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    expect(body.startsWith('# Cladding · Tier C')).toBe(true);
    const lines = body.split('\n').filter((l) => l.startsWith('  F-'));
    expect(lines).toEqual([
      '  F-aa1111: {slug: a-feat, status: in_progress, modules: 1}',
      '  F-zz9999: {slug: b-feat, status: done, modules: 2}',
    ]);
  });

  test('regeneration is idempotent (byte-identical on unchanged shards)', () => {
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'a-aa1111.yaml'), shard('F-aa1111', 'a-feat', 'done', 0));
    writeFeatureIndex(dir);
    const first = readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8');
    writeFeatureIndex(dir);
    expect(readFileSync(join(dir, 'spec', 'index.yaml'), 'utf8')).toBe(first);
  });

  test('unsharded project (no spec/features/) gets no index file', () => {
    mkdirSync(join(dir, 'spec'), {recursive: true});
    expect(writeFeatureIndex(dir)).toBe(false);
    expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(false);
  });
});
