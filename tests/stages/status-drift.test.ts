// Cladding · unit tests for stages/detectors/status-drift.ts
//
// Detector under test cross-checks `features[].status` with on-disk
// module presence:
//   - status='done' but at least one module missing → error
//     (feature is marked complete, yet implementation is gone or
//     never landed — concrete drift)
//   - status='in_progress' but every module missing → warn
//     (stale start signal; implementation hasn't begun)
//
// Status 'planned' and 'archived' are intentionally skipped — planned
// features by definition don't have code yet, and archived features
// are allowed to retain their original module paths in spec.yaml even
// after the source was removed (a separate STALE_SPECIFICATION concern).
//
// Detector iterates every feature, so each test asserts both the count
// and the message shape that named the responsible feature.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {statusDrift} from '../../stages/detectors/status-drift.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('STATUS_DRIFT detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-status-drift-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'stages'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('status=done + all modules present → no finding', () => {
    writeFileSync(join(dir, 'stages', 'alpha.ts'), 'export const a = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules: [stages/alpha.ts]\n',
    );
    expect(statusDrift.run({cwd: dir})).toEqual([]);
  });

  test('status=done + one missing module → one error finding', () => {
    writeFileSync(join(dir, 'stages', 'present.ts'), 'export const p = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\nmodules:\n  - stages/present.ts\n  - stages/missing.ts\n',
    );
    const findings = statusDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001');
    expect(findings[0].message).toContain('1/2');
    expect(findings[0].message).toContain('stages/missing.ts');
  });

  test('status=in_progress + every module missing → warn finding', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: in_progress\nmodules:\n  - stages/a.ts\n  - stages/b.ts\n',
    );
    const findings = statusDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('every declared module is missing');
  });

  test('status=in_progress + at least one module present → no finding', () => {
    writeFileSync(join(dir, 'stages', 'started.ts'), 'export const s = 1;\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: in_progress\nmodules:\n  - stages/started.ts\n  - stages/not-yet.ts\n',
    );
    // Real progress is detected → no warn, even though one module is missing
    expect(statusDrift.run({cwd: dir})).toEqual([]);
  });

  test('status=planned with missing modules → no finding (out of scope)', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: planned\nmodules: [stages/not-yet.ts]\n',
    );
    expect(statusDrift.run({cwd: dir})).toEqual([]);
  });

  test('status=archived with missing modules → no finding (separate detector owns it)', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\nmodules: [stages/legacy.ts]\n',
    );
    expect(statusDrift.run({cwd: dir})).toEqual([]);
  });

  test('feature with no modules field is skipped entirely', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    expect(statusDrift.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = statusDrift.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });
});
