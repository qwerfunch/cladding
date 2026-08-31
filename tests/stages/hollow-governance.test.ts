// Cladding · unit tests for stages/detectors/hollow-governance.ts
//
// Detector under test closes the DESIGN-TIER Vacuous Green: once a project
// has GROWN past a feature threshold (DEFAULT_MIN_FEATURES_FOR_DESIGN = 8),
// a PRESENT-but-EMPTY design SSoT file is drift. It is status-BLIND — every
// feature counts toward the threshold regardless of lifecycle status.
//
// Two independent design tiers are checked, each emitting at most one WARN:
//   1. capabilities — spec/capabilities.yaml EXISTS but declares zero
//      capabilities (`capabilities: []`, or the key missing/empty). A
//      MISSING file is NOT flagged here (ABSENCE_OF_GOVERNANCE owns absence).
//   2. architecture — architecture is present (spec/architecture.yaml loaded
//      into spec.architecture) with empty `layers: []`.
//
// Below the threshold the size guard dominates and the detector returns [].
// On spec-load failure it emits one `info` finding (the shared withSpec seam,
// same policy as STATUS_DRIFT / PLANNED_BACKLOG).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  DEFAULT_MIN_FEATURES_FOR_DESIGN,
  hollowGovernance,
} from '../../src/stages/detectors/hollow-governance.js';
import {clearDetectors, registerDetector, runDrift} from '../../src/stages/drift.js';

const SPEC_HEADER = 'schema: "0.1"\n' + 'project: {name: x, language: typescript}\n';

/** Render N minimal inline feature entries (status-blind: all 'planned'). */
function inlineFeatures(n: number): string {
  let yaml = 'features:\n';
  for (let i = 1; i <= n; i++) {
    yaml += `  - {id: F-${String(i).padStart(3, '0')}, title: t, status: planned}\n`;
  }
  return yaml;
}

/** Write spec.yaml with N inline features into `dir`. */
function writeSpec(dir: string, featureCount: number): void {
  writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER + inlineFeatures(featureCount));
}

/** Write spec/capabilities.yaml — empty list when `entries` is 0, else populated. */
function writeCapabilities(dir: string, entries: number): void {
  mkdirSync(join(dir, 'spec'), {recursive: true});
  let yaml: string;
  if (entries === 0) {
    yaml = 'capabilities: []\n';
  } else {
    yaml = 'capabilities:\n';
    for (let i = 0; i < entries; i++) {
      yaml += `  - id: cap${i}\n    title: Cap ${i}\n    features: [F-001]\n`;
    }
  }
  writeFileSync(join(dir, 'spec', 'capabilities.yaml'), yaml);
}

/** Write spec/architecture.yaml — empty `layers: []` when `layers` is 0, else populated. */
function writeArchitecture(dir: string, layers: number): void {
  mkdirSync(join(dir, 'spec'), {recursive: true});
  let yaml: string;
  if (layers === 0) {
    yaml = 'layers: []\n';
  } else {
    yaml = 'layers:\n';
    for (let i = 0; i < layers; i++) {
      yaml += `  - [core${i}]\n`;
    }
  }
  writeFileSync(join(dir, 'spec', 'architecture.yaml'), yaml);
}

describe('HOLLOW_GOVERNANCE detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hollow-gov-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('exposes the expected name and default threshold', () => {
    expect(hollowGovernance.name).toBe('HOLLOW_GOVERNANCE');
    expect(DEFAULT_MIN_FEATURES_FOR_DESIGN).toBe(8);
  });

  test('[covers:F-f44d1b/AC-002] below threshold: 7 features + both design tiers empty → no finding (size guard dominates)', () => {
    writeSpec(dir, 7);
    writeCapabilities(dir, 0); // capabilities: []
    writeArchitecture(dir, 0); // layers: []
    expect(hollowGovernance.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-f44d1b/AC-001] threshold boundary: 8 features + both tiers empty → exactly 2 warn findings (one per file)', () => {
    writeSpec(dir, 8);
    writeCapabilities(dir, 0); // capabilities: []
    writeArchitecture(dir, 0); // layers: []
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);

    const paths = findings.map((f) => f.path).sort();
    expect(paths).toEqual(['spec/architecture.yaml', 'spec/capabilities.yaml']);

    const cap = findings.find((f) => f.path === 'spec/capabilities.yaml');
    expect(cap).toBeDefined();
    expect(cap!.message).toContain('8');
    expect(cap!.message).toContain('capabilities: []');

    const arch = findings.find((f) => f.path === 'spec/architecture.yaml');
    expect(arch).toBeDefined();
    expect(arch!.message).toContain('layers: []');
  });

  test('[covers:F-f44d1b/AC-003] lifecycle status never removes a feature from the grown-design threshold', () => {
    const statuses = ['planned', 'in_progress', 'done', 'blocked', 'archived', 'done', 'archived', 'blocked'];
    const features = statuses
      .map((status, index) => `  - {id: F-${String(index + 1).padStart(3, '0')}, title: t, status: ${status}}`)
      .join('\n');
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER + `features:\n${features}\n`);
    writeCapabilities(dir, 0);
    writeArchitecture(dir, 0);
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(2);
    expect(findings.every((finding) => finding.severity === 'warn')).toBe(true);
  });

  test('only capabilities empty: 8 features + capabilities: [] + populated architecture → exactly 1 warn (capabilities)', () => {
    writeSpec(dir, 8);
    writeCapabilities(dir, 0); // capabilities: []
    writeArchitecture(dir, 1); // layers: [[core0]] — populated
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('spec/capabilities.yaml');
    expect(findings[0].message).toContain('capabilities: []');
  });

  test('only architecture empty: 8 features + populated capabilities + layers: [] → exactly 1 warn (architecture)', () => {
    writeSpec(dir, 8);
    writeCapabilities(dir, 1); // >=1 capability — populated
    writeArchitecture(dir, 0); // layers: []
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('spec/architecture.yaml');
    expect(findings[0].message).toContain('layers: []');
  });

  test('both populated: 8 features + >=1 capability + >=1 layer → no finding', () => {
    writeSpec(dir, 8);
    writeCapabilities(dir, 1); // populated
    writeArchitecture(dir, 1); // populated
    expect(hollowGovernance.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-f44d1b/AC-004] capabilities file MISSING: 8 features, no capabilities.yaml + layers: [] → 1 warn (architecture only), NO capabilities finding', () => {
    writeSpec(dir, 8);
    // deliberately do NOT write spec/capabilities.yaml — absence is
    // ABSENCE_OF_GOVERNANCE's concern, not this detector's.
    writeArchitecture(dir, 0); // layers: []
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('spec/architecture.yaml');
    expect(findings.some((f) => f.path === 'spec/capabilities.yaml')).toBe(false);
  });

  test('absent spec.yaml emits one info finding', () => {
    // no spec.yaml written into the temp dir at all
    const findings = hollowGovernance.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});

describe('HOLLOW_GOVERNANCE strict promotion (integration)', () => {
  let dir: string;
  beforeEach(() => {
    clearDetectors();
    dir = mkdtempSync(join(tmpdir(), 'clad-hollow-gov-'));
    writeSpec(dir, 8); // at threshold → eligible
    writeCapabilities(dir, 0); // capabilities: [] → empty design tier
    writeArchitecture(dir, 0); // layers: [] → empty design tier
    registerDetector(hollowGovernance);
  });
  afterEach(() => {
    clearDetectors();
    rmSync(dir, {recursive: true, force: true});
  });

  test('strict: a hollow design tier DOES fail the stage', () => {
    const report = runDrift({cwd: dir, strict: true});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('default: a hollow design tier does NOT fail but is reported', () => {
    const report = runDrift({cwd: dir});
    expect(report.pass).toBe(true);
    expect(report.findings.some((f) => f.detector === 'HOLLOW_GOVERNANCE')).toBe(true);
  });
});
