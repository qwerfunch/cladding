// Cladding · unit tests for stages/detectors/capabilities-feature-mapping.ts
//
// Detector under test resolves Tier B `spec/capabilities.yaml`'s
// `capabilities[].features[]` against Tier A `spec.yaml` feature ids.
// Three findings:
//   - dangling feature id  → error
//   - orphan capability    → info while small, warn once grown
//   - feature without cap  → info
//
// Detector skips silently when capabilities.yaml is missing or
// capabilities array is empty (adoption hasn't reached this artifact
// yet — see docs/ssot-model.md Tier B entry condition).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  capabilitiesFeatureMapping,
  DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS,
} from '../../src/stages/detectors/capabilities-feature-mapping.js';

function writeSpec(
  dir: string,
  featureIds: readonly string[],
  onboardingSeeded = false,
): void {
  const features = featureIds
    .map((id) => `  - id: ${id}\n    title: "f"\n    status: planned\n    modules: []\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: "x"`)
    .join('\n');
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject: {name: x, language: typescript, onboarding_seeded: ${onboardingSeeded}}\n` +
      `features:\n${features || '[]'}\n`,
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

  test('[covers:F-0f4dd6/AC-023] orphan capability below the maturity threshold → informational future intent', () => {
    writeSpec(dir, ['F-001'], true);
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
    const infos = findings.filter((f) => f.severity === 'info');
    expect(infos.length).toBe(2); // orphan capability + F-001 not claimed
    expect(infos.some((f) => f.message.includes('orphan-cap') && f.message.includes('future onboarding intent'))).toBe(true);
  });

  test('capability without features field below the threshold → info (treated as future intent)', () => {
    writeSpec(dir, ['F-001'], true);
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
    const infos = findings.filter((f) => f.severity === 'info');
    expect(infos.some((f) => f.message.includes('missing-features-field'))).toBe(true);
  });

  test('orphan capability at the maturity threshold → warn finding', () => {
    const ids = Array.from(
      {length: DEFAULT_MIN_FEATURES_FOR_CAPABILITY_BINDINGS},
      (_, index) => `F-${String(index + 1).padStart(3, '0')}`,
    );
    writeSpec(dir, ids, true);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: intent',
        'capabilities:',
        '  - id: overdue-binding',
        '    features: []',
        '',
      ].join('\n'),
    );
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    const warns = findings.filter((f) => f.severity === 'warn');
    expect(warns).toHaveLength(1);
    expect(warns[0].message).toContain('overdue-binding');
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

  test('mixed findings: early orphan info + dangling error + unclaimed-feature info', () => {
    writeSpec(dir, ['F-001', 'F-002'], true);
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
    expect(bySev.warn.length).toBe(0);
    expect(bySev.info.length).toBe(2); // early orphan + F-002 unclaimed
    expect(bySev.info.some((f) => f.message.includes('F-002'))).toBe(true);
  });

  test('legacy project below the threshold retains the established orphan warning', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(
      dir,
      [
        'schema: "0.1"',
        'source: README.md',
        'capabilities:',
        '  - id: unresolved-capability',
        '    features: []',
        '',
      ].join('\n'),
    );

    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings.some((finding) =>
      finding.severity === 'warn' && finding.message.includes('unresolved-capability'),
    )).toBe(true);
  });

  test('malformed YAML → skip silently (other detectors flag corruption)', () => {
    writeSpec(dir, ['F-001']);
    writeCapabilities(dir, ':::: not valid yaml ::::');
    const findings = capabilitiesFeatureMapping.run({cwd: dir});
    expect(findings).toEqual([]);
  });
});
