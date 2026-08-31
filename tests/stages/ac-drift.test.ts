// Cladding · unit tests for stages/detectors/ac-drift.ts
//
// Detector under test ships two complementary checks:
//
//   (1) Structural floor — an AC must have *either* a rendered `text`
//       field or at least one EARS structural field (condition / action
//       / response). Missing both is a structurally empty AC that
//       cannot be read or verified; the detector flags it as error.
//
//   (2) EARS syntactic check — delegated to spec/ears.ts. ACs that
//       declare an `ears` pattern must align with the pattern's
//       trigger keyword (or have no condition for `ubiquitous`).
//
// Both checks emit `error` severity (not warn). The full semantic
// AC↔implementation drift is a future LLM-assisted enrichment; this
// unit covers only the deterministic, syntactic floor.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {acDrift} from '../../src/stages/detectors/ac-drift.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('AC_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ac-drift-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('AC with text field is structurally valid → no finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n  - id: AC-001\n    text: The system shall do X.\n',
    );
    expect(acDrift.run({cwd: dir})).toEqual([]);
  });

  test('AC with EARS structural fields only → no structural-floor finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n  - id: AC-001\n    action: do X\n    response: returns Y\n',
    );
    expect(acDrift.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-055/AC-127] AC missing text and EARS fields reports structural drift', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n  - id: AC-001\n',
    );
    const findings = acDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.AC-001');
    expect(findings[0].message).toContain('structurally empty');
  });

  test('event-pattern AC without when-trigger → EARS error finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    ears: event\n' +
        '    condition: "Y happens"\n' +
        '    action: do X\n' +
        '    text: When Y happens the system shall do X.\n',
    );
    const findings = acDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('EARS');
  });

  test('ubiquitous AC with no condition → no EARS finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    ears: ubiquitous\n' +
        '    text: The system shall always X.\n',
    );
    expect(acDrift.run({cwd: dir})).toEqual([]);
  });

  test('multiple offending ACs across features → one finding each', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n  - id: AC-001\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: t\nstatus: done\n' +
        'acceptance_criteria:\n  - id: AC-002\n',
    );
    const findings = acDrift.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const acIds = findings.map((f) => f.message.match(/AC-\d+/)?.[0]).sort();
    expect(acIds).toEqual(['AC-001', 'AC-002']);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = acDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
