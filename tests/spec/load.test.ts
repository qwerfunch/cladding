// Cladding · unit tests for spec/load.ts — sharded vs unsharded

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {loadSpec} from '../../src/spec/load.js';

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

  test('merges sharded features from spec/features/*.yaml', () => {
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

  test('scenario.features[] accepts hash F-<hash> references (F-086, v0.3.11)', () => {
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

  test('inline features beat sharded directory (unsharded wins)', () => {
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
});
