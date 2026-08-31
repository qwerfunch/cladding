// Cladding · unit tests for stages/detectors/missing-tests.ts
//
// Regression coverage for the v0.2.3 evidence_refs split (F-052): a
// `status: done` AC must declare *some* verification — either
// `test_refs` (real test files) or `evidence_refs` (npm scripts,
// fixtures, docs). Both empty → error (v0.2.18 promoted from warn).
// Either non-empty → silent.
//
// Why a dedicated file: drift.test.ts already covers strict-mode
// behaviour but uses real-repo spec.yaml. These tests synthesise
// minimal sharded specs in tmpdir to isolate the detector logic
// from cladding's own (large) spec.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {missingTests} from '../../src/stages/detectors/missing-tests.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

describe('MISSING_TESTS detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-missing-tests-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-052/AC-109][covers:F-067/AC-180][covers:F-067/AC-181] errors when status=done AC has neither test_refs nor evidence_refs', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    text: bare\n',
    );
    const findings = missingTests.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.AC-001');
    expect(findings[0].message).toContain('evidence_refs');
  });

  test('silent when AC has test_refs only', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    test_refs: [tests/foo.test.ts]\n',
    );
    expect(missingTests.run({cwd: dir})).toHaveLength(0);
  });

  test('[covers:F-052/AC-107] silent when AC has evidence_refs only (F-052 acceptance)', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [self-dogfood:stage:type]\n',
    );
    expect(missingTests.run({cwd: dir})).toHaveLength(0);
  });

  test('silent when AC has both test_refs and evidence_refs', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    test_refs: [tests/foo.test.ts]\n' +
        '    evidence_refs: [docs/intent.md]\n',
    );
    expect(missingTests.run({cwd: dir})).toHaveLength(0);
  });

  test('non-done features are skipped regardless of refs', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: planned\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    text: bare\n',
    );
    expect(missingTests.run({cwd: dir})).toHaveLength(0);
  });

  test('multiple ACs report independently', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    text: bare1\n' +
        '  - id: AC-002\n' +
        '    test_refs: [tests/ok.test.ts]\n' +
        '  - id: AC-003\n' +
        '    text: bare2\n',
    );
    const findings = missingTests.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const acIds = findings.map((f) => f.message.match(/AC-\d+/)?.[0]).sort();
    expect(acIds).toEqual(['AC-001', 'AC-003']);
  });
});

// ─── F-c037ae — derived-only refs do NOT satisfy verification ───

describe('derived-only refs (F-c037ae)', () => {
  test('an AC whose only test_ref is derived: stays UNVERIFIED, and the message points at confirmation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-mt-derived-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      writeFileSync(
        join(dir, 'spec', 'features', 'x-aaaa11.yaml'),
        'id: F-aaaa11\nslug: x\ntitle: t\nstatus: done\nmodules: []\nacceptance_criteria:\n  - id: AC-001\n    ears: ubiquitous\n    text: t\n    test_refs: ["derived:tests/cli/x.test.ts"]\n',
      );
      const findings = missingTests.run({cwd: dir});
      const hit = findings.find((f) => f.detector === 'MISSING_TESTS');
      expect(hit?.severity).toBe('error');
      expect(hit?.message).toContain('derived:');
      expect(hit?.message).toContain('removing the prefix');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
