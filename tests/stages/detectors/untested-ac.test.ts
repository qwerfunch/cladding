// Cladding · unit tests for stages/detectors/untested-ac.ts (UNTESTED_AC)
//
// The v0.1 evidence floor: every done AC's test_refs[] must resolve on disk.
// The cases below pin the `path#anchor` resolution (a test_ref may point at a
// specific test WITHIN a file) and the actionable error that lists the accepted
// forms — both added after an autonomous run burned turns guessing the format.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {untestedAc} from '../../../src/stages/detectors/untested-ac.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-untested-ac-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Write a schema-valid done feature whose single AC carries the given test_refs. */
function writeSpec(testRefs: string[]): void {
  const refs = testRefs.map((r) => `          - ${JSON.stringify(r)}`).join('\n');
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject: {name: f, language: typescript}\nfeatures:\n' +
      '  - id: F-001\n    title: f\n    status: done\n    acceptance_criteria:\n' +
      `      - id: AC-001\n        ears: ubiquitous\n        text: t\n        test_refs:\n${refs}\n`,
  );
}
/** Materialize a file (and its parent dirs) under the temp project. */
function touch(rel: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, '');
}
function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return untestedAc.run({cwd: dir}).filter((f) => f.detector === 'UNTESTED_AC');
}

describe('UNTESTED_AC detector', () => {
  test('a literal path that exists ⇒ no finding', () => {
    writeSpec(['tests/x.test.ts']);
    touch('tests/x.test.ts');
    expect(run()).toHaveLength(0);
  });

  test('a `path#anchor` test_ref resolves via its path part ⇒ no finding', () => {
    writeSpec(['tests/x.test.ts#parses a literal']);
    touch('tests/x.test.ts'); // the anchor names a test inside the file; only the path must exist
    expect(run()).toHaveLength(0);
  });

  test('a `path#anchor` whose path is missing still fails (the anchor does not rescue it)', () => {
    writeSpec(['tests/nope.test.ts#some test']);
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  test('self-dogfood: / fixture: prefixes are skipped', () => {
    writeSpec(['self-dogfood:lint', 'fixture:regex-suite']);
    expect(run()).toHaveLength(0);
  });

  test('an unresolved test_ref names the accepted forms (path / #anchor / prefixes)', () => {
    writeSpec(['totally-bogus']);
    const findings = run();
    expect(findings).toHaveLength(1);
    const msg = findings[0].message;
    expect(msg).toMatch(/#<test name>/);
    expect(msg).toMatch(/self-dogfood:/);
    expect(msg).toMatch(/fixture:/);
  });
});
