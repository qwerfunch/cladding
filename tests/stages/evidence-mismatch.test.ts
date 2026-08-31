// Cladding · unit tests for stages/detectors/evidence-mismatch.ts
//
// Detector under test reads the audit log via `readEvidence(cwd)`
// (from hitl/audit.ts) and emits an error finding for every entry
// whose `artifact` path is no longer on disk. Evidence without an
// `artifact` field is silently skipped (a feature-level note rather
// than a file-bound piece of evidence).
//
// Audit log absent / empty → single info finding (opt-in semantics).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvidence} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';
import {evidenceMismatch} from '../../src/stages/detectors/evidence-mismatch.js';

describe('EVIDENCE_MISMATCH detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ev-mismatch-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('audit log absent → info finding', () => {
    const findings = evidenceMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no audit log');
  });

  test('evidence with present artifact → silent', () => {
    mkdirSync(join(dir, 'reports'), {recursive: true});
    writeFileSync(join(dir, 'reports', 'pass.txt'), 'green\n');
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'audit ok',
        identity: {author: 'human', name: 'qa'},
        artifact: 'reports/pass.txt',
      }),
    );
    expect(evidenceMismatch.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-057/AC-134] evidence with a missing artifact reports an error', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.1',
        kind: 'pass',
        content: 'audit ok',
        identity: {author: 'human', name: 'qa'},
        artifact: 'reports/vanished.txt',
      }),
    );
    const findings = evidenceMismatch.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('reports/vanished.txt');
    expect(findings[0].message).toContain('missing artifact');
  });

  test('evidence without artifact field is silently skipped', () => {
    // Feature-level note evidence — no artifact attached. The detector
    // should not flag it, regardless of disk state.
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 'stage_4.1',
        kind: 'note',
        content: 'reviewer comment',
        identity: {author: 'human', name: 'qa'},
      }),
    );
    expect(evidenceMismatch.run({cwd: dir})).toEqual([]);
  });

  test('multiple missing artifacts → one finding per entry', () => {
    for (let i = 0; i < 3; i += 1) {
      appendEvidence(
        dir,
        newEvidence({
          featureId: 'F-001',
          stage: 'stage_4.1',
          kind: 'pass',
          content: `entry ${i}`,
          identity: {author: 'human', name: 'qa'},
          artifact: `reports/gone-${i}.txt`,
        }),
      );
    }
    const findings = evidenceMismatch.run({cwd: dir});
    expect(findings).toHaveLength(3);
    for (const f of findings) {
      expect(f.severity).toBe('error');
      expect(f.path).toMatch(/^reports\/gone-\d\.txt$/);
    }
  });
});
