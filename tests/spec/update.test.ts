// Cladding · unit tests for src/spec/update.ts (0.4.2)
//
// Covers findFeatureFile / updateFeatureStatus / getFeatureScope /
// appendEvidence on a tmpdir-seeded spec/features/ tree.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  FeatureNotFoundError,
  InvalidStatusTransitionError,
  appendEvidence,
  findFeatureFile,
  getFeatureScope,
  updateFeatureStatus,
} from '../../src/spec/update.js';

function seedFeature(cwd: string, filename: string, body: string): string {
  const dir = join(cwd, 'spec', 'features');
  mkdirSync(dir, {recursive: true});
  const path = join(dir, filename);
  writeFileSync(path, body);
  return path;
}

describe('findFeatureFile', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-update-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('locates a hash-suffix file via F-<hash6> shortcut', () => {
    seedFeature(dir, 'login-flow-a3f9c2.yaml', 'id: F-a3f9c2\nslug: login-flow\nstatus: planned\n');
    const path = findFeatureFile(dir, 'F-a3f9c2');
    expect(path.endsWith('login-flow-a3f9c2.yaml')).toBe(true);
  });

  test('locates a legacy F-NNN.yaml direct match', () => {
    seedFeature(dir, 'F-049.yaml', 'id: F-049\nslug: legacy-feature\nstatus: planned\n');
    const path = findFeatureFile(dir, 'F-049');
    expect(path.endsWith('F-049.yaml')).toBe(true);
  });

  test('falls back to id: line scan when filename does not hint', () => {
    seedFeature(dir, 'arbitrary-name.yaml', 'id: F-zzzz12\nslug: arbitrary\nstatus: planned\n');
    const path = findFeatureFile(dir, 'F-zzzz12');
    expect(path.endsWith('arbitrary-name.yaml')).toBe(true);
  });

  test('throws FeatureNotFoundError for unknown id', () => {
    seedFeature(dir, 'something-aaaaaa.yaml', 'id: F-aaaaaa\nslug: something\nstatus: planned\n');
    expect(() => findFeatureFile(dir, 'F-missin')).toThrow(FeatureNotFoundError);
  });
});

describe('updateFeatureStatus', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-update-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('planned → in_progress preserves all other lines', () => {
    const path = seedFeature(
      dir,
      'demo-b1b1b1.yaml',
      [
        'id: F-b1b1b1',
        'slug: demo',
        'title: "A demo feature"  # trailing comment kept',
        'status: planned',
        'modules:',
        '  - src/demo.ts',
        'acceptance_criteria: []',
        '',
      ].join('\n'),
    );
    const oldStatus = updateFeatureStatus(dir, 'F-b1b1b1', 'in_progress');
    expect(oldStatus).toBe('planned');
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('status: in_progress');
    expect(body).toContain('# trailing comment kept');
    expect(body).toContain('  - src/demo.ts');
  });

  test('idempotent — same status returns oldStatus and does not rewrite file', () => {
    const path = seedFeature(dir, 'demo-c2c2c2.yaml', 'id: F-c2c2c2\nslug: demo\nstatus: planned\n');
    const mtimeBefore = readFileSync(path, 'utf8');
    const oldStatus = updateFeatureStatus(dir, 'F-c2c2c2', 'planned');
    expect(oldStatus).toBe('planned');
    expect(readFileSync(path, 'utf8')).toBe(mtimeBefore);
  });

  test('throws InvalidStatusTransitionError on disallowed jump (planned → done)', () => {
    seedFeature(dir, 'demo-d3d3d3.yaml', 'id: F-d3d3d3\nslug: demo\nstatus: planned\n');
    expect(() => updateFeatureStatus(dir, 'F-d3d3d3', 'done')).toThrow(InvalidStatusTransitionError);
  });

  test('archived has no forward transitions', () => {
    seedFeature(dir, 'demo-e4e4e4.yaml', 'id: F-e4e4e4\nslug: demo\nstatus: archived\n');
    expect(() => updateFeatureStatus(dir, 'F-e4e4e4', 'planned')).toThrow(InvalidStatusTransitionError);
  });
});

describe('getFeatureScope', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-update-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('returns slug + modules array', () => {
    seedFeature(
      dir,
      'auth-f5f5f5.yaml',
      [
        'id: F-f5f5f5',
        'slug: auth',
        'status: planned',
        'modules:',
        '  - src/auth/login.ts',
        '  - src/auth/session.ts',
        'acceptance_criteria: []',
        '',
      ].join('\n'),
    );
    const scope = getFeatureScope(dir, 'F-f5f5f5');
    expect(scope.slug).toBe('auth');
    expect(scope.modules).toEqual(['src/auth/login.ts', 'src/auth/session.ts']);
  });

  test('returns empty modules when none declared', () => {
    seedFeature(dir, 'bare-a6a6a6.yaml', 'id: F-a6a6a6\nslug: bare\nstatus: planned\n');
    const scope = getFeatureScope(dir, 'F-a6a6a6');
    expect(scope.modules).toEqual([]);
  });
});

describe('appendEvidence', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-spec-update-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('appends a new evidence_refs entry to the matching AC', () => {
    const path = seedFeature(
      dir,
      'demo-b7b7b7.yaml',
      [
        'id: F-b7b7b7',
        'slug: demo',
        'status: in_progress',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    text: "demo AC"',
        '',
      ].join('\n'),
    );
    const result = appendEvidence(dir, 'F-b7b7b7', 'AC-001', 'tests/demo.test.ts');
    expect(result.appended).toBe(true);
    const body = readFileSync(path, 'utf8');
    expect(body).toContain('evidence_refs');
    expect(body).toContain('tests/demo.test.ts');
  });

  test('idempotent — adding same evidence twice is a no-op on the second call', () => {
    seedFeature(
      dir,
      'demo-c8c8c8.yaml',
      [
        'id: F-c8c8c8',
        'slug: demo',
        'status: in_progress',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    evidence_refs:',
        '      - tests/existing.test.ts',
        '',
      ].join('\n'),
    );
    const result = appendEvidence(dir, 'F-c8c8c8', 'AC-001', 'tests/existing.test.ts');
    expect(result.appended).toBe(false);
  });

  test('throws on unknown ac id', () => {
    seedFeature(
      dir,
      'demo-d9d9d9.yaml',
      [
        'id: F-d9d9d9',
        'slug: demo',
        'status: in_progress',
        'acceptance_criteria:',
        '  - id: AC-001',
        '    text: "first AC"',
        '',
      ].join('\n'),
    );
    expect(() => appendEvidence(dir, 'F-d9d9d9', 'AC-999', 'whatever')).toThrow(/AC-999/);
  });
});
