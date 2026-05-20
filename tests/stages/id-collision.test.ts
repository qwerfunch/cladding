// Cladding · unit tests for stages/detectors/id-collision.ts (F-084)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {idCollision} from '../../src/stages/detectors/id-collision.js';

function writeMaster(dir: string): void {
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\n');
}

function writeFeature(dir: string, fileName: string, body: {id: string}): void {
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  const lines = [
    `id: ${body.id}`,
    `title: ${JSON.stringify(body.id)}`,
    'status: planned',
    'modules: []',
    'acceptance_criteria: []',
  ];
  writeFileSync(join(dir, 'spec', 'features', fileName), lines.join('\n') + '\n');
}

describe('ID_COLLISION detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-id-collision-'));
    writeMaster(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('all unique ids → no findings', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001'});
    writeFeature(dir, 'F-002.yaml', {id: 'F-002'});
    writeFeature(dir, 'F-a3f9c2.yaml', {id: 'F-a3f9c2'});
    expect(idCollision.run({cwd: dir})).toEqual([]);
  });

  test('two files declaring the same id → error finding', () => {
    // Distinct filenames, identical id field.
    writeFeature(dir, 'first.yaml', {id: 'F-a3f9c2'});
    writeFeature(dir, 'second.yaml', {id: 'F-a3f9c2'});
    const findings = idCollision.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-a3f9c2');
    expect(findings[0].message).toContain('2 times');
  });

  test('three features colliding → single finding with count 3', () => {
    writeFeature(dir, 'a.yaml', {id: 'F-aaaaaa'});
    writeFeature(dir, 'b.yaml', {id: 'F-aaaaaa'});
    writeFeature(dir, 'c.yaml', {id: 'F-aaaaaa'});
    const findings = idCollision.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('3 times');
  });

  test('legacy F-NNN + new F-<hash> coexisting → no false positive', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001'});
    writeFeature(dir, 'login-flow.yaml', {id: 'F-a3f9c2'});
    expect(idCollision.run({cwd: dir})).toEqual([]);
  });

  test('spec absent → no findings', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'clad-id-coll-empty-'));
    try {
      expect(idCollision.run({cwd: emptyDir})).toEqual([]);
    } finally {
      rmSync(emptyDir, {recursive: true, force: true});
    }
  });

  // v0.3.12 (F-087) — scenario namespace coverage
  test('two scenarios with the same id → error finding (F-087)', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001'});
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'one.yaml'),
      'id: S-a3f9c2\ntitle: t\n',
    );
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'two.yaml'),
      'id: S-a3f9c2\ntitle: t\n',
    );
    const findings = idCollision.run({cwd: dir});
    const scenarioFindings = findings.filter((f) => f.message.includes('scenario'));
    expect(scenarioFindings).toHaveLength(1);
    expect(scenarioFindings[0].severity).toBe('error');
    expect(scenarioFindings[0].message).toContain('S-a3f9c2');
  });

  test('feature S-xxx and scenario S-xxx coexist NOT triggered (separate namespaces, F-087)', () => {
    // Features can't have an S- id (schema rejects), but the detector
    // works on the loaded spec — feature and scenario id namespaces
    // are checked independently and S- ids only exist in scenarios.
    writeFeature(dir, 'F-001.yaml', {id: 'F-001'});
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'one.yaml'),
      'id: S-a3f9c2\ntitle: t\n',
    );
    expect(idCollision.run({cwd: dir})).toEqual([]);
  });
});
