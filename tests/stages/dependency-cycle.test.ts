// Cladding · unit tests for stages/detectors/dependency-cycle.ts
//
// Detector under test inspects the `features[].depends_on` graph and flags
// CYCLES — a dependency cycle means the involved features can never become
// "ready", deadlocking the drive loop. REFERENCE_INTEGRITY already checks
// that each dep EXISTS; this detector checks the graph is ACYCLIC.
//
// Contract surface exercised here:
//   - WITHIN-SPEC-VALIDITY: on spec-load failure it returns [] SILENTLY
//     (no info finding, unlike STATUS_DRIFT).
//   - acyclic graphs (linear chain, diamond/DAG, no deps) → [].
//   - a cycle → at least one error finding, path 'spec.yaml', message
//     contains 'circular depends_on cycle' and names the cycle's feature ids.
//   - only edges to features that ACTUALLY EXIST are traversed; a dangling
//     depends_on (pointing at a non-existent id) is ignored.
//   - each distinct cycle is reported once; disjoint cycles → distinct findings.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {dependencyCycle} from '../../src/stages/detectors/dependency-cycle.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

/**
 * Write a feature shard. When `deps` is empty, `depends_on` is omitted
 * entirely (a feature with no declared dependencies).
 */
function writeFeature(dir: string, id: string, deps: string[]): void {
  let body = `id: ${id}\ntitle: t\nstatus: planned\n`;
  if (deps.length > 0) {
    body += 'depends_on:\n';
    for (const dep of deps) {
      body += `  - ${dep}\n`;
    }
  }
  writeFileSync(join(dir, 'spec', 'features', `${id}.yaml`), body);
}

describe('DEPENDENCY_CYCLE detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-dep-cycle-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('exposes the name DEPENDENCY_CYCLE', () => {
    expect(dependencyCycle.name).toBe('DEPENDENCY_CYCLE');
  });

  test('acyclic linear chain → no finding', () => {
    // F-001 -> F-002 -> F-003 -> (none)
    writeFeature(dir, 'F-001', ['F-002']);
    writeFeature(dir, 'F-002', ['F-003']);
    writeFeature(dir, 'F-003', []);
    expect(dependencyCycle.run({cwd: dir})).toEqual([]);
  });

  test('diamond DAG (shared dependency) → no finding', () => {
    // F-001 -> {F-002, F-003}; F-002 -> F-004; F-003 -> F-004; F-004 -> (none)
    // A shared dependency is not a cycle.
    writeFeature(dir, 'F-001', ['F-002', 'F-003']);
    writeFeature(dir, 'F-002', ['F-004']);
    writeFeature(dir, 'F-003', ['F-004']);
    writeFeature(dir, 'F-004', []);
    expect(dependencyCycle.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-a4b512/AC-003] 2-cycle F-001 <-> F-002 → exactly one error naming both ids', () => {
    writeFeature(dir, 'F-001', ['F-002']);
    writeFeature(dir, 'F-002', ['F-001']);
    const findings = dependencyCycle.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('spec.yaml');
    expect(findings[0].message).toContain('circular depends_on cycle');
    expect(findings[0].message).toContain('F-001');
    expect(findings[0].message).toContain('F-002');
  });

  test('3-cycle F-001 -> F-002 -> F-003 -> F-001 → exactly one error', () => {
    writeFeature(dir, 'F-001', ['F-002']);
    writeFeature(dir, 'F-002', ['F-003']);
    writeFeature(dir, 'F-003', ['F-001']);
    const findings = dependencyCycle.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('spec.yaml');
    expect(findings[0].message).toContain('circular depends_on cycle');
    expect(findings[0].message).toContain('F-001');
    expect(findings[0].message).toContain('F-002');
    expect(findings[0].message).toContain('F-003');
  });

  test('[covers:F-a4b512/AC-001] self-loop F-001 depends_on F-001 → exactly one error naming F-001', () => {
    writeFeature(dir, 'F-001', ['F-001']);
    const findings = dependencyCycle.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('spec.yaml');
    expect(findings[0].message).toContain('circular depends_on cycle');
    expect(findings[0].message).toContain('F-001');
  });

  test('[covers:F-a4b512/AC-002] dangling depends_on (non-existent id) is ignored → no finding', () => {
    // F-001 depends_on F-999, which has no shard. The edge points outside the
    // graph and is not traversed here — that dangling-ref concern belongs to
    // REFERENCE_INTEGRITY, not to cycle detection. No loop exists → [].
    writeFeature(dir, 'F-001', ['F-999']);
    expect(dependencyCycle.run({cwd: dir})).toEqual([]);
  });

  test('two disjoint cycles → exactly two error findings', () => {
    // F-001 <-> F-002 AND F-003 <-> F-004 are independent cycles.
    writeFeature(dir, 'F-001', ['F-002']);
    writeFeature(dir, 'F-002', ['F-001']);
    writeFeature(dir, 'F-003', ['F-004']);
    writeFeature(dir, 'F-004', ['F-003']);
    const findings = dependencyCycle.run({cwd: dir});
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.severity === 'error')).toBe(true);
  });

  test('absent spec.yaml → [] silently (no info finding)', () => {
    rmSync(join(dir, 'spec.yaml'));
    // WITHIN-SPEC-VALIDITY: load failure is silent, NOT an info finding.
    expect(dependencyCycle.run({cwd: dir})).toEqual([]);
  });
});
