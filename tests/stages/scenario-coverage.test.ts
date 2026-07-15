// Cladding · unit tests for stages/detectors/scenario-coverage.ts
//
// Detector under test guards SCENARIO COVERAGE — the integration-tier SSoT.
// Two independent checks, each emitting at most one WARN per offence:
//
//   1. Scale-gated "no scenarios": once a project has GROWN past a feature
//      threshold (DEFAULT_MIN_FEATURES_FOR_SCENARIOS = 8) AND carries ZERO
//      scenarios, a single WARN fires (the integration tier never started).
//      Below the threshold the size guard dominates and this check is silent.
//
//   2. Graduated "hollow scenario": an empty onboarding scenario is INFO below
//      the threshold and WARN once grown, so future journeys do not block the
//      first feature while mature projects cannot leave them unresolved.
//
// On spec-load failure it emits one `info` finding (the shared withSpec seam,
// same policy as STATUS_DRIFT / PLANNED_BACKLOG / HOLLOW_GOVERNANCE).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {clearDetectors, registerDetector, runDrift} from '../../src/stages/drift.js';
import {
  DEFAULT_MIN_FEATURES_FOR_SCENARIOS,
  scenarioCoverage,
} from '../../src/stages/detectors/scenario-coverage.js';

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

/**
 * Write a scenario shard to spec/scenarios/S-<n>.yaml. When `binds` is empty
 * the scenario is hollow (`features: []`); otherwise it binds the given ids.
 * The loader merges spec/scenarios/*.yaml when the master `scenarios` field is
 * empty/absent (same heuristic as features).
 */
function writeScenario(dir: string, n: number, binds: readonly string[]): void {
  const id = `S-${String(n).padStart(3, '0')}`;
  mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
  let yaml = `id: ${id}\ntitle: t\n`;
  if (binds.length === 0) {
    yaml += 'features: []\n';
  } else {
    yaml += 'features:\n' + binds.map((f) => `  - ${f}`).join('\n') + '\n';
  }
  writeFileSync(join(dir, 'spec', 'scenarios', `${id}.yaml`), yaml);
}

describe('SCENARIO_COVERAGE detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-scenario-cov-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('exposes the expected name and default threshold', () => {
    expect(scenarioCoverage.name).toBe('SCENARIO_COVERAGE');
    expect(DEFAULT_MIN_FEATURES_FOR_SCENARIOS).toBe(8);
  });

  test('at threshold: 8 features + 0 scenarios → exactly 1 warn naming the count', () => {
    writeSpec(dir, 8);
    // deliberately write NO scenario shards
    const findings = scenarioCoverage.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('8');
    expect(findings[0].message).toContain('no scenarios');
    expect(findings[0].path).toBe('spec/scenarios/');
  });

  test('below threshold: 7 features + 0 scenarios → no finding (size guard dominates)', () => {
    writeSpec(dir, 7);
    expect(scenarioCoverage.run({cwd: dir})).toEqual([]);
  });

  test('at threshold WITH a binding scenario: 8 features + 1 scenario binding ≥1 feature → no finding', () => {
    writeSpec(dir, 8);
    writeScenario(dir, 1, ['F-001']); // binds an existing feature
    expect(scenarioCoverage.run({cwd: dir})).toEqual([]);
  });

  test('hollow scenario below threshold → exactly 1 informational future-intent finding', () => {
    writeSpec(dir, 2);
    writeScenario(dir, 1, []); // features: [] → hollow
    const findings = scenarioCoverage.run({cwd: dir});
    // Check 1 cannot fire: only 2 features AND a scenario exists.
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('S-001');
    expect(findings[0].message).toContain('future onboarding intent');
    expect(findings[0].path).toBe('spec/scenarios/');
  });

  test('two hollow scenarios at threshold: 8 features + 2 hollow scenarios → exactly 2 warns (no "no scenarios" finding)', () => {
    writeSpec(dir, 8);
    writeScenario(dir, 1, []); // hollow
    writeScenario(dir, 2, []); // hollow
    const findings = scenarioCoverage.run({cwd: dir});
    // Check 1 does NOT fire — scenarios exist, so it is not "zero scenarios".
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);
    expect(findings.every((f) => f.path === 'spec/scenarios/')).toBe(true);
    expect(findings.every((f) => f.message.includes('binds no features'))).toBe(true);

    const ids = findings.map((f) => f.message).sort();
    expect(ids.some((m) => m.includes('S-001'))).toBe(true);
    expect(ids.some((m) => m.includes('S-002'))).toBe(true);
    // none of the hollow findings is the scale-gated "no scenarios" message
    expect(findings.some((f) => f.message.includes('no scenarios'))).toBe(false);
  });

  test('absent spec.yaml emits one info finding', () => {
    // no spec.yaml written into the temp dir at all
    const findings = scenarioCoverage.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});

describe('SCENARIO_COVERAGE strict promotion (integration)', () => {
  let dir: string;
  beforeEach(() => {
    clearDetectors();
    dir = mkdtempSync(join(tmpdir(), 'clad-scenario-cov-'));
    writeSpec(dir, 8); // at threshold → eligible
    // no scenario shards → check 1 fires one warn
    registerDetector(scenarioCoverage);
  });
  afterEach(() => {
    clearDetectors();
    rmSync(dir, {recursive: true, force: true});
  });

  test('strict: a missing-scenarios warn DOES fail the stage', () => {
    const report = runDrift({cwd: dir, strict: true});
    expect(report.pass).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  test('default: a missing-scenarios warn does NOT fail but is reported', () => {
    const report = runDrift({cwd: dir});
    expect(report.pass).toBe(true);
    expect(report.findings.some((f) => f.detector === 'SCENARIO_COVERAGE')).toBe(true);
  });
});

// Check 3 — UNDER-BOUND: a scenario whose `flow` names a feature by its slug (the
// `(feature-slug)` convention) that it doesn't bind in features[]. Needs features
// WITH slugs + a scenario WITH a flow, so it uses its own fixtures.
describe('SCENARIO_COVERAGE under-bound flow (check 3)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-scenario-ub-'));
    // 3 features WITH slugs.
    writeFileSync(
      join(dir, 'spec.yaml'),
      SPEC_HEADER +
        'features:\n' +
        '  - {id: F-001, slug: auth-register, title: t, status: planned}\n' +
        '  - {id: F-002, slug: auth-login, title: t, status: planned}\n' +
        '  - {id: F-003, slug: sprints, title: t, status: planned}\n',
    );
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  function writeFlowScenario(flow: string, binds: readonly string[]): void {
    const feats = binds.map((f) => `  - ${f}`).join('\n');
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'S-001.yaml'),
      `id: S-001\ntitle: t\nflow: ${JSON.stringify(flow)}\nfeatures:\n${feats}\n`,
    );
  }

  test('flow references a feature slug not in features[] → one under-bound warn naming it', () => {
    writeFlowScenario('user registers (auth-register), logs in (auth-login), plans a (sprints)', ['F-001', 'F-002']);
    const findings = scenarioCoverage.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('S-001');
    expect(findings[0].message).toContain('sprints');
    expect(findings[0].message).toContain('F-003');
    expect(findings[0].message).toContain('does not bind');
    // the BOUND slugs (auth-register/login) are not named as offenders
    expect(findings[0].message).not.toContain('auth-register');
  });

  test('flow references only BOUND feature slugs → no under-bound warn', () => {
    writeFlowScenario('user registers (auth-register) then logs in (auth-login)', ['F-001', 'F-002']);
    expect(scenarioCoverage.run({cwd: dir})).toEqual([]);
  });

  test('non-slug parentheticals (free prose) never false-fire', () => {
    // `(type/lint/drift)` are not feature slugs — exact-slug matching ignores them.
    writeFlowScenario('runs the gates (type/lint/drift) and ships', ['F-001']);
    expect(scenarioCoverage.run({cwd: dir})).toEqual([]);
  });

  test('a scenario with no flow is not under-bound-checked', () => {
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'S-001.yaml'),
      'id: S-001\ntitle: t\nfeatures:\n  - F-001\n',
    );
    expect(scenarioCoverage.run({cwd: dir})).toEqual([]);
  });
});
