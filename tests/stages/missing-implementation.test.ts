// Cladding · unit tests for stages/detectors/missing-implementation.ts
//
// Detector under test walks every `features[].modules` entry and emits
// an `error` finding when the declared file is absent from disk. It is
// the mirror of UNMAPPED_ARTIFACT — both check the spec ↔ code seam
// from opposite directions.
//
// Status-aware (F-e8912be3): a missing module is an `error` for `done`
// and `archived` features (real shipped-code drift, and `archived` is
// guarded only here) but only `info` for `planned` / `in_progress` ones,
// which sit inside the documented spec-first window (the shard is authored
// before the code). STATUS_DRIFT layers the richer status interpretation
// on top; this detector reports ground truth at the right severity.
//
// Spec absence → single `info` finding (opt-in on spec presence,
// matching the rest of the spec-vs-code detector cohort).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {missingImplementation} from '../../src/stages/detectors/missing-implementation.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('MISSING_IMPLEMENTATION detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-missing-impl-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('silent when every declared module exists on disk', () => {
    mkdirSync(join(dir, 'stages'), {recursive: true});
    writeFileSync(join(dir, 'stages', 'alpha.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    expect(missingImplementation.run({cwd: dir})).toEqual([]);
  });

  test('emits one error per missing module', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules:\n  - stages/missing-1.ts\n  - stages/missing-2.ts\n',
    );
    const findings = missingImplementation.run({cwd: dir});
    expect(findings).toHaveLength(2);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.message).toContain('F-001');
      expect(f.message).toMatch(/missing-[12]\.ts/);
      expect(f.message).toContain('does not exist');
    }
  });

  test('mixed feature: present + absent modules report only the absent ones', () => {
    mkdirSync(join(dir, 'stages'), {recursive: true});
    writeFileSync(join(dir, 'stages', 'present.ts'), 'export const p = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules:\n  - stages/present.ts\n  - stages/absent.ts\n',
    );
    const findings = missingImplementation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('stages/absent.ts');
  });

  test('feature with no modules field is silent', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    expect(missingImplementation.run({cwd: dir})).toEqual([]);
  });

  test('status-blind: archived feature with missing module still emits error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\nmodules: [stages/legacy.ts]\n',
    );
    const findings = missingImplementation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  test('absent spec.yaml emits one info finding (not a throw)', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = missingImplementation.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });

  test('multiple features each contribute their own finding, at status-appropriate severity', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/a.ts]\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: t\nstatus: in_progress\nmodules: [stages/b.ts]\n',
    );
    const findings = missingImplementation.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const byId = new Map(findings.map((f) => [f.message.match(/F-\d{3}/)?.[0], f]));
    expect([...byId.keys()].sort()).toEqual(['F-001', 'F-002']);
    // done keeps the blocking error; in_progress still EMITS but as info
    // (the spec-first window is normal, not drift).
    expect(byId.get('F-001')?.severity).toBe('error');
    expect(byId.get('F-002')?.severity).toBe('info');
  });
});
