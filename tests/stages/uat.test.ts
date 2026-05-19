// Cladding · unit tests for stages/uat.ts (stage_4.2)
//
// UAT goes one step beyond stage_4.1 audit: it requires every
// status=done feature to carry at least one human-authored kind=pass
// evidence. Branches:
//   - spec.yaml not loaded                       → exitCode=2 (skipped)
//   - audit log empty                             → exitCode=2 (skipped)
//   - every done feature has human pass          → pass=true
//   - one or more done features lack human pass  → pass=false, exitCode=1, stderr lists ids
//   - in_progress / planned / archived features ignored
//
// Pure read-only — no subprocess. Tests write real audit-log entries
// + sharded spec features into a tmp dir.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';
import {runUat} from '../../src/stages/uat.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('runUat (stage_4.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-uat-stage-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('spec.yaml absent → skipped (exitCode=2)', () => {
    rmSync(join(dir, 'spec.yaml'));
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_4.2');
    expect(r.stderr).toContain('spec.yaml not loaded');
  });

  test('audit log absent → skipped (exitCode=2)', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    const r = runUat({cwd: dir});
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('no audit log present');
  });

  test('every done feature has human kind=pass → pass=true', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.2',
        kind: 'pass',
        content: 'human signed off',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('done feature with only tool evidence → fails listing feature id', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.2',
        kind: 'pass',
        content: 'CI ran',
        identity: {author: 'tool', name: 'ci'},
      }),
    );
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('F-001');
    expect(r.stderr).toContain('1 done feature(s)');
  });

  test('human evidence with kind=note (not pass) does NOT satisfy', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.2',
        kind: 'note',
        content: 'looked at it',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('F-001');
  });

  test('in_progress / planned / archived features are ignored', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: in flight\nstatus: in_progress\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: future\nstatus: planned\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-003.yaml'),
      'id: F-003\ntitle: legacy\nstatus: archived\n',
    );
    // Need ANY evidence so the audit-log empty branch doesn't fire.
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.2',
        kind: 'note',
        content: 'wip',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('multiple done features → all missing ones listed', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: a\nstatus: done\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: b\nstatus: done\n',
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.2',
        kind: 'pass',
        content: 'ok',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    // F-002 has no evidence at all
    const r = runUat({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('F-002');
    expect(r.stderr).not.toContain('F-001');
  });
});
