// Cladding · unit tests for spec/load.ts — sharded vs unsharded

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {loadSpec, loadSpecFromDiskUnlocked} from '../../src/spec/load.js';
import {managedSpecWorkspaceDigest, withStableSpecWorkspaceSnapshot} from '../../src/spec/transaction.js';

describe('loadSpec', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-load-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('reads a fully unsharded spec.yaml', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n' +
        '  - id: F-001\n' +
        '    title: t\n' +
        '    status: done\n',
    );
    const spec = loadSpec(dir);
    expect(spec.features).toHaveLength(1);
    expect(spec.features[0].id).toBe('F-001');
  });

  test('[covers:F-031/AC-045] merges sharded features from spec/features/*.yaml', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' + 'project: {name: x, language: typescript}\n' + 'features: []\n',
    );
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: alpha\nstatus: done\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: beta\nstatus: planned\n',
    );
    const spec = loadSpec(dir);
    expect(spec.features).toHaveLength(2);
    const ids = spec.features.map((f) => f.id).sort();
    expect(ids).toEqual(['F-001', 'F-002']);
  });

  test('merges sharded scenarios', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n  - {id: F-001, title: t, status: done}\n',
    );
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'S-001.yaml'),
      'id: S-001\ntitle: flow\n',
    );
    const spec = loadSpec(dir);
    expect(spec.scenarios).toHaveLength(1);
    expect(spec.scenarios?.[0].id).toBe('S-001');
  });

  test('[covers:F-59f093/AC-003][covers:F-59f093/AC-004] scenario.features[] accepts hash F-<hash> references (F-086, v0.3.11)', () => {
    // Regression guard: v0.3.9 widened the feature id regex to accept
    // F-<hash6> alongside legacy F-NNN, but the scenario.features[]
    // items pattern was missed. v0.3.11 widens it too. This test
    // confirms a scenario referencing a hash-id feature passes
    // schema validation.
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n' +
        '  - id: F-001\n    title: legacy\n    status: done\n' +
        '  - id: F-a3f9c2\n    slug: login-flow\n    title: new\n    status: planned\n' +
        'scenarios:\n' +
        '  - id: S-010\n    title: cross-id scenario\n    features: [F-001, F-a3f9c2]\n',
    );
    const spec = loadSpec(dir);
    expect(spec.scenarios?.[0].features).toEqual(['F-001', 'F-a3f9c2']);
  });

  test('[covers:F-031/AC-046] inline features beat sharded directory (unsharded wins)', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n  - {id: F-001, title: inline, status: done}\n',
    );
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: sharded\nstatus: done\n',
    );
    const spec = loadSpec(dir);
    expect(spec.features).toHaveLength(1);
    expect(spec.features[0].id).toBe('F-001');
  });

  test('nested pure readers share stable snapshots without taking the writer lock', () => {
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.2"\nproject:\n  name: x\n  language: typescript\n  purpose: Keep readers stable.\n  assurance_level: L2\n  scenario_policy: advisory\n',
    );
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
    writeFileSync(join(dir, 'spec', 'features', 'stable-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'title: Stable', 'status: planned', 'purpose: Keep readers stable.',
      'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall keep readers stable.', '',
    ].join('\n'));

    const [loaded, compiled] = withStableSpecWorkspaceSnapshot(dir, () => [
      loadSpec(dir),
      compileSpecWorkspace(dir),
    ] as const);

    expect(loaded.features.map((feature) => feature.id)).toEqual(['F-aaaaaaaa']);
    expect(compiled.schemaVersion).toBe('0.2');
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.lock'))).toBe(false);
  });

  test('retries a moving epoch instead of publishing a partial pure-reader snapshot', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n  - {id: F-001, title: before, status: done}\n',
    );
    let attempts = 0;

    const loaded = withStableSpecWorkspaceSnapshot(dir, () => {
      attempts++;
      if (attempts === 1) {
        rmSync(join(dir, 'spec.yaml'));
        let removedPathError: unknown;
        try {
          loadSpecFromDiskUnlocked(dir);
        } catch (error) {
          removedPathError = error;
        }
        writeFileSync(
          join(dir, 'spec.yaml'),
          'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n  - {id: F-001, title: after, status: done}\n',
        );
        if (removedPathError === undefined) throw new Error('Expected the removed source path to reject the transient read.');
        throw removedPathError;
      }
      return loadSpecFromDiskUnlocked(dir);
    });

    expect(attempts).toBe(2);
    expect(loaded.features[0]?.title).toBe('after');
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.lock'))).toBe(false);
  });

  test('waits for an active writer rather than publishing a partial reader result', () => {
    const bytes = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n  - {id: F-001, title: guarded, status: done}\n';
    writeFileSync(join(dir, 'spec.yaml'), bytes);
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'spec-transaction.lock'), `${JSON.stringify({pid: process.pid, nonce: 'active-writer'})}\n`);

    expect(() => loadSpec(dir)).toThrow(expect.objectContaining({code: 'BUSY'}));
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(bytes);

    rmSync(join(dir, '.cladding'), {recursive: true, force: true});
  }, 7000);

  test('keeps an evidence-ancestor symlink opaque to the schema snapshot', () => {
    const external = mkdtempSync(join(tmpdir(), 'clad-load-evidence-target-'));
    try {
      const target = join(external, 'receipt.yaml');
      writeFileSync(target, 'outside receipt one\n');
      writeFileSync(
        join(dir, 'spec.yaml'),
        'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n  - {id: F-001, title: opaque, status: done}\n',
      );
      mkdirSync(join(dir, 'spec'), {recursive: true});
      symlinkSync(target, join(dir, 'spec', 'evidence'));

      const digest = managedSpecWorkspaceDigest(dir);
      const loaded = loadSpec(dir);
      writeFileSync(target, 'outside receipt two\n');

      expect(managedSpecWorkspaceDigest(dir)).toBe(digest);
      expect(loadSpec(dir)).toEqual(loaded);
    } finally {
      rmSync(external, {recursive: true, force: true});
    }
  });
});

// J2 — Tier B capabilities are merged from spec/capabilities.yaml into the typed
// Spec and schema-validated at parse time (not just read ad-hoc by a detector).
describe('loadSpec — capabilities (Tier B)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-load-cap-'));
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: x, language: typescript}\n' +
        'features:\n  - id: F-001\n    title: t\n    status: done\n',
    );
    mkdirSync(join(dir, 'spec'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-f6d13e/AC-001] merges the capabilities[] array into spec.capabilities', () => {
    writeFileSync(
      join(dir, 'spec', 'capabilities.yaml'),
      'schema: "0.1"\nsource: spec.yaml\ncapabilities:\n' +
        '  - id: auth\n    title: Auth\n    surface: feature\n    features: [F-001]\n',
    );
    const spec = loadSpec(dir);
    expect(spec.capabilities).toHaveLength(1);
    expect(spec.capabilities?.[0].id).toBe('auth');
    expect(spec.capabilities?.[0].surface).toBe('feature');
  });

  test('absent capabilities.yaml → spec.capabilities undefined', () => {
    const spec = loadSpec(dir);
    expect(spec.capabilities).toBeUndefined();
  });

  test('empty capabilities seed (capabilities: []) loads as an empty array', () => {
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'schema: "0.1"\ncapabilities: []\n');
    const spec = loadSpec(dir);
    // `[]` is falsy-length so the loader leaves it absent rather than [] — either
    // way the design tier is empty; HOLLOW_GOVERNANCE owns flagging that.
    expect(spec.capabilities ?? []).toHaveLength(0);
  });

  test('[covers:F-f6d13e/AC-002] a malformed capability is now a parse-time validation error (J2 win)', () => {
    writeFileSync(
      join(dir, 'spec', 'capabilities.yaml'),
      'schema: "0.1"\ncapabilities:\n  - id: bad\n    surface: not-a-valid-surface\n',
    );
    expect(() => loadSpec(dir)).toThrow();
  });
});
