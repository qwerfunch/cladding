// Cladding · unit tests for stages/detectors/fixture-reference.ts
//
// Coverage for the v0.2.4 fixture validation contract (F-053):
//   - registered fixture: → silent
//   - unregistered fixture: → warn
//   - non-fixture refs → ignored
//   - missing conformance/fixtures.yaml → detector opts out (no findings)
//   - registry parse error → detector opts out (no findings)
//   - test_refs citations honoured for backward compatibility

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {fixtureReference} from '../../stages/detectors/fixture-reference.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

const REGISTRY_YAML =
  'fixtures:\n' +
  '  - name: alpha\n' +
  '    kind: runnable\n' +
  '  - name: beta-doc\n' +
  '    kind: documentary\n';

function writeFeature(dir: string, body: string): void {
  writeFileSync(join(dir, 'spec', 'features', 'F-001.yaml'), body);
}

describe('FIXTURE_REFERENCE_INVALID detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-fixref-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'conformance'), {recursive: true});
    writeFileSync(join(dir, 'conformance', 'fixtures.yaml'), REGISTRY_YAML);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('silent when fixture name is registered', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:alpha]\n',
    );
    expect(fixtureReference.run({cwd: dir})).toEqual([]);
  });

  test('warns when fixture name is not in the registry', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:typo-zed]\n',
    );
    const findings = fixtureReference.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('F-001.AC-001');
    expect(findings[0].message).toContain('typo-zed');
    expect(findings[0].message).toContain('evidence_refs');
  });

  test('accepts documentary kind the same as runnable', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:beta-doc]\n',
    );
    expect(fixtureReference.run({cwd: dir})).toEqual([]);
  });

  test('ignores non-fixture evidence_refs entries', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [docs/notes.md, script:lint, self-dogfood:stage:type]\n',
    );
    expect(fixtureReference.run({cwd: dir})).toEqual([]);
  });

  test('honours legacy test_refs citations for backward compat', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    test_refs: [fixture:alpha, fixture:does-not-exist]\n',
    );
    const findings = fixtureReference.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('does-not-exist');
    expect(findings[0].message).toContain('test_refs');
  });

  test('returns no findings when the registry file is absent', () => {
    rmSync(join(dir, 'conformance', 'fixtures.yaml'));
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:alpha]\n',
    );
    expect(fixtureReference.run({cwd: dir})).toEqual([]);
  });

  test('returns no findings on malformed registry YAML', () => {
    writeFileSync(join(dir, 'conformance', 'fixtures.yaml'), 'fixtures: [oh no\n');
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: done\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:alpha]\n',
    );
    expect(fixtureReference.run({cwd: dir})).toEqual([]);
  });

  test('checks all features, not just status=done', () => {
    writeFeature(
      dir,
      'id: F-001\n' +
        'title: t\n' +
        'status: planned\n' +
        'acceptance_criteria:\n' +
        '  - id: AC-001\n' +
        '    evidence_refs: [fixture:typo-here]\n',
    );
    const findings = fixtureReference.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('typo-here');
  });
});
