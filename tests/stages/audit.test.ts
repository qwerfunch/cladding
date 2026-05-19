// Cladding · unit tests for stages/audit.ts (stage_4.1)
//
// Stage runner under test reads the audit log and applies the anti-
// self-cert guard from hitl/anti-self-cert.ts. Branches:
//   - audit log empty / absent          → pass=false, exitCode=2 (skipped)
//   - every AC has human evidence       → pass=true
//   - at least one AC fails the guard   → pass=false, exitCode=1, stderr lists reasons
//
// No subprocess — pure read-only logic. Tests write real audit-log
// entries via appendEvidence + newEvidence so the guard sees the same
// shape it sees in production.

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence} from '../../hitl/audit.js';
import {newEvidence} from '../../hitl/identity.js';
import {runAudit} from '../../stages/audit.js';

describe('runAudit (stage_4.1)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-audit-stage-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('audit log absent → skipped (exitCode=2)', () => {
    const r = runAudit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(2);
    expect(r.stage).toBe('stage_4.1');
    expect(r.stderr).toContain('no audit log present');
  });

  test('AC with human evidence → pass=true', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'reviewed',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    const r = runAudit({cwd: dir});
    expect(r.pass).toBe(true);
    expect(r.exitCode).toBe(0);
  });

  test('AC with only tool evidence → guard fails (exitCode=1)', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'CI ran',
        identity: {author: 'tool', name: 'ci'},
      }),
    );
    const r = runAudit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('anti-self-cert guard');
    expect(r.stderr).toContain('AC-001');
  });

  test('multiple failing ACs → all listed in stderr (semicolon-joined)', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'tool ran',
        identity: {author: 'tool', name: 'ci'},
      }),
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-002',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'llm verified',
        identity: {author: 'llm', name: 'claude'},
      }),
    );
    const r = runAudit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('AC-001');
    expect(r.stderr).toContain('AC-002');
    expect(r.stderr).toContain(';');
  });

  test('mixed evidence — human pass for one AC + tool-only for another → guard fails on the latter', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        acId: 'AC-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'human ok',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-002',
        acId: 'AC-002',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'only tool',
        identity: {author: 'tool', name: 'ci'},
      }),
    );
    const r = runAudit({cwd: dir});
    expect(r.pass).toBe(false);
    expect(r.stderr).toContain('AC-002');
    expect(r.stderr).not.toContain('AC-001');
  });
});
