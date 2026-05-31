// Cladding · unit tests for stages/detectors/capabilities-feature-mapping.ts
//
// Detector under test resolves Tier B `spec/capabilities.yaml`'s
// `capabilities[].features[]` against Tier A `spec.yaml` feature ids.
// Three findings:
//   - dangling feature id  → error
//   - orphan capability    → warn
//   - feature without cap  → info
//
// Detector skips silently when capabilities.yaml is missing or
// capabilities array is empty (adoption hasn't reached this artifact
// yet — see docs/ssot-model.md Tier B entry condition).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {capabilitiesFeatureMapping} from '../../src/stages/detectors/capabilities-feature-mapping.js';

function writeSpec(dir: string, featureIds: readonly string[]): void {
  const features = featureIds
    .map((id) => `  - id: ${id}\n    title: "f"\n    status: planned\n    modules: []\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: "x"`)
    .join('\n');
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n${features || '[]'}\n`,
  );
}

function writeCapabilities(dir: string, body: string): void {
  mkdirSync(join(dir, 'spec'), {recursive: true});
  writeFileSync(join(dir, 'spec', 'capabilities.yaml'), body);
}

describe('CAPABILITIES_FEATURE_MAPPING detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-caps-map-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('skips silently when capabilities.yaml is missing', () => {
    writeSpec(dir, ['F-001']);
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('skips silently when capabilities.yaml has empty capabilities array', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(dir, 'schema: "0.1"\nsource: README.md\ncapabilities: []\n');
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('clean mapping → no findings', () => {
    writeSpec(dir, ['F-001', 'F-002']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: auth',
        '    title: "Auth"',
        '    features: [F-001]',
        '  - id: payment',
        '    title: "Payment"',
        '    features: [F-002]',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('dangling feature id → error finding', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: auth',
        '    title: "Auth"',
        '    features: [F-001, F-999000]',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors.length).toBe(1);
    expect(errors[0].message).toContain('F-999000');
    expect(errors[0].message).toContain('does not exist');
  });

  test('orphan capability (features: []) → warn finding', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: orphan-cap',
        '    title: "Nothing bound"',
        '    features: []',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const warns = findings.filter((f) => f.severity === 'warn');
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain('orphan-cap');
    expect(warns[0].message).toContain('no features mapped');
  });

  test('capability without features field → warn (treated as orphan)', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: missing-features-field',
        '    title: "No features key"',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const warns = findings.filter((f) => f.severity === 'warn');
    expect(warns.length).toBe(1);
    expect(warns[0].message).toContain('missing-features-field');
  });

  test('feature without capability → info finding', () => {
    writeSpec(dir, ['F-001', 'F-002', 'F-003']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: auth',
        '    title: "Auth"',
        '    features: [F-001]',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const infos = findings.filter((f) => f.severity === 'info');
    expect(infos.length).toBe(2);
    expect(infos.map((f) => f.message)).toEqual(expect.arrayContaining([
      expect.stringContaining('F-002'),
      expect.stringContaining('F-003'),
    ]));
  });

  test('mixed findings: orphan + dangling + info', () => {
    writeSpec(dir, ['F-001', 'F-002']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: ok',
        '    title: "OK"',
        '    features: [F-001]',
        '  - id: orphan',
        '    title: "Orphan"',
        '    features: []',
        '  - id: bad',
        '    title: "Bad"',
        '    features: [F-999000]',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const bySev = {
      error: findings.filter((f) => f.severity === 'error'),
      warn: findings.filter((f) => f.severity === 'warn'),
      info: findings.filter((f) => f.severity === 'info'),
    };
    expect(bySev.error.length).toBe(1);
    expect(bySev.warn.length).toBe(1);
    expect(bySev.info.length).toBe(1); // F-002 unclaimed
    expect(bySev.info[0].message).toContain('F-002');
  });

  test('malformed YAML → skip silently (other detectors flag corruption)', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(dir, ':::: not valid yaml ::::');
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings).toEqual([]);
  });
});
