// Cladding · unit tests for stages/detectors/spec-conformance.ts (SPEC_CONFORMANCE, #34)
//
// The presence/integrity guard backing stage_2.3. Two halves, done-only:
//   INTEGRITY (always): declared oracle_refs must resolve on disk.
//   MANDATORY (opt-in): require_oracles ⇒ a done AC must declare oracle_refs.
// Critically INERT by default (no flag + no refs ⇒ zero findings), so adding
// it cannot retroactively red legacy specs / cladding-self.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {specConformance} from '../../../src/stages/detectors/spec-conformance.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-spec-conf-detector-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Write a minimal, schema-valid spec.yaml into the temp dir. */
function writeSpec(body: string): void {
  writeFileSync(join(dir, 'spec.yaml'), body);
}
function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return specConformance.run({cwd: dir}).filter((f) => f.detector === 'SPEC_CONFORMANCE');
}
function oracleFile(rel = 'tests/oracle/foo.test.ts'): void {
  mkdirSync(join(dir, 'tests/oracle'), {recursive: true});
  writeFileSync(join(dir, rel), "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));\n");
}

const SPEC = (project: string, acYaml: string): string =>
  `schema: "0.1"\nproject: {${project}}\nfeatures:\n  - id: F-001\n    title: f\n    status: done\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n${acYaml}`;

describe('SPEC_CONFORMANCE detector', () => {
  test('INERT: require_oracles unset + no oracle_refs ⇒ zero findings (dogfood-safety)', () => {
    writeSpec(SPEC('name: f, language: typescript', '        evidence_refs: [fixture:x]'));
    expect(run()).toHaveLength(0);
  });

  test('MANDATORY: require_oracles ON + done AC with no oracle_refs ⇒ error', () => {
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        evidence_refs: [fixture:x]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain('lacks a spec-conformance oracle');
  });

  test('MANDATORY satisfied: require_oracles ON + resolving oracle_ref ⇒ no findings', () => {
    oracleFile();
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    expect(run()).toHaveLength(0);
  });

  test('INTEGRITY (always-on): declared oracle_ref to a missing file ⇒ error, even with require_oracles OFF', () => {
    writeSpec(SPEC('name: f, language: typescript', '        oracle_refs: [tests/oracle/missing.test.ts]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain('resolves to nothing');
  });

  test('INTEGRITY: resolving oracle_ref OUTSIDE tests/oracle/ ⇒ warn (stage_2.3 would not run it)', () => {
    mkdirSync(join(dir, 'tests'), {recursive: true});
    writeFileSync(join(dir, 'tests/elsewhere.test.ts'), "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));\n");
    writeSpec(SPEC('name: f, language: typescript', '        oracle_refs: [tests/elsewhere.test.ts]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('warn');
    expect(f[0]?.message).toContain('outside');
  });

  test('STATUS-AWARE: a planned (non-done) feature is not inspected even with a dangling oracle_ref', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: f, language: typescript, require_oracles: true}\nfeatures:\n' +
        '  - id: F-001\n    title: f\n    status: planned\n    acceptance_criteria:\n' +
        '      - id: AC-001\n        ears: ubiquitous\n        text: t\n        oracle_refs: [tests/oracle/missing.test.ts]\n',
    );
    expect(run()).toHaveLength(0);
  });
});
