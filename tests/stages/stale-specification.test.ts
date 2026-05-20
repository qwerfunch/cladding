// Cladding · unit tests for stages/detectors/stale-specification.ts
//
// Detector under test surfaces four lifecycle-metadata inconsistencies:
//
//   1. archived_at set but status != 'archived' → warn + propose-archive
//   2. superseded_by set but archived_at missing → warn + propose-archive
//   3. status='archived' but at least one module still exists → warn (no suggestion — removal cadence is project-owned)
//   4. status in {planned, in_progress} with non-empty modules[] but every module vanished from disk → warn + propose-archive (Phased Decommissioning Tier 2, v0.3.19)
//
// Each branch is exercised in isolation and in combination. The
// detector is opt-in on spec presence (info on absence, not throw).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {staleSpecification} from '../../src/stages/detectors/stale-specification.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('STALE_SPECIFICATION detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-stale-spec-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'stages'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('healthy archive (status=archived + modules removed) → no finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [stages/gone.ts]\n',
    );
    expect(staleSpecification.run({cwd: dir})).toEqual([]);
  });

  test('archived_at present but status=done → warn finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n',
    );
    const findings = staleSpecification.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('F-001');
    expect(findings[0].message).toContain('archived_at');
    expect(findings[0].message).toContain("'done'");
  });

  test('superseded_by present but archived_at missing → warn finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nsuperseded_by: F-002\n',
    );
    const findings = staleSpecification.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('superseded_by');
    expect(findings[0].message).toContain('no archived_at');
  });

  test('status=archived + surviving module on disk → warn finding', () => {
    writeFileSync(join(dir, 'stages', 'survivor.ts'), '// still here\nexport const s = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [stages/survivor.ts]\n',
    );
    const findings = staleSpecification.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('archived');
    expect(findings[0].message).toContain('stages/survivor.ts');
  });

  test('plain healthy feature (status=done, no archive metadata) → no finding', () => {
    writeFileSync(join(dir, 'stages', 'active.ts'), '// healthy\nexport const a = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/active.ts]\n',
    );
    expect(staleSpecification.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = staleSpecification.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });

  // Phased Decommissioning Tier 2 (v0.3.19, F-x) — STALE_SPECIFICATION
  // emits machine-actionable `propose-archive` suggestions on findings
  // that the maintainer can resolve by archiving the feature.
  describe('propose-archive suggestion (Tier 2)', () => {
    test('archived_at + non-archived status → suggestion carries featureId + reason', () => {
      writeFileSync(
        join(dir, 'spec', 'features', 'F-100.yaml'),
        'id: F-100\ntitle: t\nstatus: done\narchived_at: "2024-01-01T00:00:00Z"\n',
      );
      const findings = staleSpecification.run({cwd: dir});
      expect(findings[0].suggestion?.action).toBe('propose-archive');
      expect(findings[0].suggestion?.args?.featureId).toBe('F-100');
      expect(String(findings[0].suggestion?.args?.reason)).toContain("'done'");
    });

    test('superseded_by without archived_at → suggestion mentions the superseder', () => {
      writeFileSync(
        join(dir, 'spec', 'features', 'F-200.yaml'),
        'id: F-200\ntitle: t\nstatus: done\nsuperseded_by: F-300\n',
      );
      const findings = staleSpecification.run({cwd: dir});
      expect(findings[0].suggestion?.action).toBe('propose-archive');
      expect(findings[0].suggestion?.args?.featureId).toBe('F-200');
      expect(String(findings[0].suggestion?.args?.reason)).toContain('F-300');
    });

    test('non-final feature with non-empty modules[] all vanished → propose-archive', () => {
      // No file at stages/missing.ts → declared module does not exist.
      writeFileSync(
        join(dir, 'spec', 'features', 'F-300.yaml'),
        'id: F-300\ntitle: t\nstatus: planned\nmodules: [stages/missing.ts]\n',
      );
      const findings = staleSpecification.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('warn');
      expect(findings[0].suggestion?.action).toBe('propose-archive');
      expect(findings[0].suggestion?.args?.featureId).toBe('F-300');
      expect(String(findings[0].suggestion?.args?.reason)).toContain('vanished');
    });

    test('non-final feature with no modules declared → NO finding (design/doc-only is legitimate)', () => {
      writeFileSync(
        join(dir, 'spec', 'features', 'F-400.yaml'),
        'id: F-400\ntitle: t\nstatus: planned\n',
      );
      expect(staleSpecification.run({cwd: dir})).toEqual([]);
    });

    test('archived feature with surviving modules → NO suggestion (removal cadence is project-owned)', () => {
      writeFileSync(join(dir, 'stages', 'survivor.ts'), '// still here\nexport const s = 1;\n');
      writeFileSync(
        join(dir, 'spec', 'features', 'F-500.yaml'),
        'id: F-500\ntitle: t\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nmodules: [stages/survivor.ts]\n',
      );
      const findings = staleSpecification.run({cwd: dir});
      expect(findings).toHaveLength(1);
      expect(findings[0].suggestion).toBeUndefined();
    });
  });
});
