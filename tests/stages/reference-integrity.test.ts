// Cladding · unit tests for stages/detectors/reference-integrity.ts
//
// Detector under test validates every internal ID reference in
// spec.yaml against the feature catalog:
//   - features[].depends_on[]   → must exist
//   - features[].superseded_by  → must exist
//   - scenarios[].features[]    → must exist
//
// Each broken reference emits an error finding with context. ADR
// references are out of scope until the ADR subsystem lands.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {referenceIntegrity} from '../../src/stages/detectors/reference-integrity.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('REFERENCE_INTEGRITY detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ref-int-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('all depends_on ids exist → silent', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: a\nstatus: done\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: b\nstatus: done\ndepends_on: [F-001]\n',
    );
    expect(referenceIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-057/AC-135] unknown depends_on reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\ndepends_on: [F-999]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.depends_on');
    expect(findings[0].message).toContain("'F-999'");
  });

  test('[covers:F-057/AC-135] unknown superseded_by reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\nsuperseded_by: F-888\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.superseded_by');
    expect(findings[0].message).toContain("'F-888'");
  });

  test('[covers:F-057/AC-135] unknown scenario feature reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'S-001.yaml'),
      'id: S-001\ntitle: flow\nfeatures: [F-001, F-777]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('S-001.features');
    expect(findings[0].message).toContain("'F-777'");
  });

  test('multiple broken refs → one finding each', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\ndepends_on: [F-901, F-902]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const cited = findings.map((f) => f.message.match(/F-90\d/)?.[0]).sort();
    expect(cited).toEqual(['F-901', 'F-902']);
  });

  test('superseded_by resolves to a real feature → silent', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: legacy\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nsuperseded_by: F-002\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: replacement\nstatus: done\n',
    );
    expect(referenceIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
