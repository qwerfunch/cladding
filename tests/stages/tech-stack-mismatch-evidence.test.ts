// Cladding · impl-blind oracle for F-9e1279d4 — authored from the spec contract only.
import {afterEach, describe, expect, test} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {techStackMismatch} from '../../src/stages/detectors/tech-stack-mismatch.js';

/**
 * Contract under test (D8), encoded without sight of the implementation:
 *
 *  1. declared language not a known label            -> no findings
 *  2. fewer than 5 classifiable source files         -> no findings
 *  3. declared language absent from observed sources -> exactly 1 finding, 'warn',
 *                                                       message names declared + dominant observed
 *  4. declared observed but under 10% of sources     -> exactly 1 finding, 'info'
 *  5. otherwise                                      -> no findings
 *  6. build manifests have no influence on the outcome
 *  7. severity 'error' is never produced
 */

type FileSpec = readonly [count: number, ext: string];

type Expectation =
  | {readonly kind: 'none'}
  | {readonly kind: 'warn' | 'info'; readonly contains?: readonly string[]};

interface Fixture {
  readonly language: string;
  readonly files: readonly FileSpec[];
  readonly manifests?: readonly string[];
}

interface Row extends Fixture {
  readonly id: number;
  readonly why: string;
  readonly expect: Expectation;
}

const tempDirs: string[] = [];

function makeFixture(fixture: Fixture): string {
  const dir = mkdtempSync(join(tmpdir(), 'tsm-'));
  tempDirs.push(dir);

  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject: {name: x, language: ${fixture.language}}\nfeatures: []\n`,
    'utf8',
  );
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});

  const srcDir = join(dir, 'src', 'pkg');
  mkdirSync(srcDir, {recursive: true});
  let seq = 0;
  for (const [count, ext] of fixture.files) {
    for (let n = 0; n < count; n++) {
      seq++;
      writeFileSync(join(srcDir, `f${seq}.${ext}`), `// f${seq}\n`, 'utf8');
    }
  }

  for (const manifest of fixture.manifests ?? []) {
    writeFileSync(join(dir, manifest), '', 'utf8');
  }

  return dir;
}

function runOn(fixture: Fixture): ReadonlyArray<{
  detector: string;
  severity: string;
  message: string;
}> {
  const cwd = makeFixture(fixture);
  return techStackMismatch.run({cwd}) as ReadonlyArray<{
    detector: string;
    severity: string;
    message: string;
  }>;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, {recursive: true, force: true});
  }
});

const rows: readonly Row[] = [
  {
    id: 1,
    language: 'cpp',
    files: [[12, 'cpp'], [6, 'h'], [3, 'java']],
    manifests: ['build.gradle'],
    why: 'declared cpp dominates the observed sources',
    expect: {kind: 'none'},
  },
  {
    id: 2,
    language: 'kotlin',
    files: [[24, 'kt'], [4, 'cpp'], [2, 'java']],
    manifests: ['build.gradle.kts'],
    why: 'declared kotlin dominates the observed sources',
    expect: {kind: 'none'},
  },
  {
    id: 3,
    language: 'typescript',
    files: [[20, 'ts'], [6, 'java'], [4, 'swift'], [3, 'kt']],
    manifests: ['package.json'],
    why: 'declared typescript dominates a polyglot tree',
    expect: {kind: 'none'},
  },
  {
    id: 4,
    language: 'javascript',
    files: [[14, 'js']],
    manifests: ['package.json'],
    why: 'declared javascript is the only observed language',
    expect: {kind: 'none'},
  },
  {
    id: 5,
    language: 'csharp',
    files: [[16, 'cs']],
    manifests: [],
    why: 'declared csharp is the only observed language, no manifest at all',
    expect: {kind: 'none'},
  },
  {
    id: 6,
    language: 'scala',
    files: [[12, 'scala']],
    manifests: ['build.sbt'],
    why: 'declared scala is the only observed language',
    expect: {kind: 'none'},
  },
  {
    id: 7,
    language: 'rust',
    files: [[15, 'rs']],
    manifests: ['package.json'],
    why: 'declared rust matches sources; a node manifest must not sway the verdict',
    expect: {kind: 'none'},
  },
  {
    id: 8,
    language: 'zig',
    files: [[16, 'zig']],
    manifests: [],
    why: 'declared label is not a known language',
    expect: {kind: 'none'},
  },
  {
    id: 9,
    language: 'nim',
    files: [[10, 'nim'], [6, 'ts']],
    manifests: ['package.json'],
    why: 'declared label is not a known language, even with known sources present',
    expect: {kind: 'none'},
  },
  {
    id: 10,
    language: 'python',
    files: [[38, 'zig'], [2, 'ts']],
    manifests: ['package.json'],
    why: 'only 2 classifiable files — evidence below the floor of 5',
    expect: {kind: 'none'},
  },
  {
    id: 11,
    language: 'python',
    files: [[40, 'ipynb'], [2, 'ts']],
    manifests: [],
    why: 'notebooks are invisible; only 2 classifiable files',
    expect: {kind: 'none'},
  },
  {
    id: 12,
    language: 'cpp',
    files: [[10, 'c'], [4, 'h']],
    manifests: [],
    why: '.c is unknown, so only 4 classifiable files — below the floor',
    expect: {kind: 'none'},
  },
  {
    id: 13,
    language: 'python',
    files: [[20, 'ts']],
    manifests: ['package.json'],
    why: 'declared python absent from an all-typescript tree',
    expect: {kind: 'warn', contains: ['python', 'typescript']},
  },
  {
    id: 14,
    language: 'typescript',
    files: [[18, 'go']],
    manifests: ['go.mod'],
    why: 'declared typescript absent from an all-go tree',
    expect: {kind: 'warn', contains: ['typescript', 'go']},
  },
  {
    id: 15,
    language: 'java',
    files: [[25, 'kt']],
    manifests: ['build.gradle.kts'],
    why: 'declared java absent from an all-kotlin tree',
    expect: {kind: 'warn', contains: ['java', 'kotlin']},
  },
  {
    id: 16,
    language: 'python',
    files: [[38, 'zig'], [10, 'ts']],
    manifests: ['package.json'],
    why: 'unknown files are invisible; the 10 typescript files clear the floor of 5',
    expect: {kind: 'warn', contains: ['python', 'typescript']},
  },
  {
    id: 17,
    language: 'python',
    files: [[22, 'ts'], [2, 'py']],
    manifests: ['package.json'],
    why: 'declared python present but 2/24 ~= 8.3% of sources',
    expect: {kind: 'info'},
  },
  {
    id: 18,
    language: 'cpp',
    files: [[60, 'kt'], [3, 'cpp']],
    manifests: ['build.gradle'],
    why: 'declared cpp present but 3/63 ~= 4.8% of sources',
    expect: {kind: 'info'},
  },
  {
    id: 19,
    language: 'typescript',
    files: [[3, 'ts'], [30, 'js']],
    manifests: ['package.json'],
    why: 'declared typescript present but 3/33 ~= 9.1% of sources',
    expect: {kind: 'info'},
  },
  {
    id: 20,
    language: 'java',
    files: [[20, 'java'], [8, 'kt']],
    manifests: ['build.gradle'],
    why: 'declared java holds a ~71% majority',
    expect: {kind: 'none'},
  },
] as const;

describe('TECH_STACK_MISMATCH — evidence-based conformance table (F-9e1279d4)', () => {
  for (const row of rows) {
    const label = `row ${row.id}: declared ${row.language} -> ${row.expect.kind} (${row.why})`;

    test(label, () => {
      const findings = runOn(row);

      expect(Array.isArray(findings)).toBe(true);
      for (const finding of findings) {
        expect(finding.detector).toBe('TECH_STACK_MISMATCH');
        expect(finding.severity).not.toBe('error');
      }

      if (row.expect.kind === 'none') {
        expect(findings).toEqual([]);
        return;
      }

      expect(findings).toHaveLength(1);
      const [finding] = findings;
      expect(finding.severity).toBe(row.expect.kind);
      expect(typeof finding.message).toBe('string');

      for (const needle of row.expect.contains ?? []) {
        expect(finding.message.toLowerCase()).toContain(needle);
      }
    });
  }

  test('build manifests never influence the outcome (row 13 with and without package.json)', () => {
    const withManifest = runOn({
      language: 'python',
      files: [[20, 'ts']],
      manifests: ['package.json'],
    });
    const withoutManifest = runOn({
      language: 'python',
      files: [[20, 'ts']],
      manifests: [],
    });

    const shape = (
      findings: ReadonlyArray<{detector: string; severity: string; message: string}>,
    ) => findings.map((f) => ({detector: f.detector, severity: f.severity, message: f.message}));

    expect(shape(withoutManifest)).toEqual(shape(withManifest));
    expect(withManifest).toHaveLength(1);
    expect(withManifest[0].severity).toBe('warn');
  });

  test("no row of the table ever produces severity 'error'", () => {
    const produced: Array<{detector: string; severity: string}> = [];

    for (const row of rows) {
      for (const finding of runOn(row)) {
        produced.push({detector: finding.detector, severity: finding.severity});
      }
    }

    // The table has 4 warn rows + 3 info rows, so the detector must speak exactly 7 times.
    expect(produced).toHaveLength(7);
    for (const finding of produced) {
      expect(finding.detector).toBe('TECH_STACK_MISMATCH');
      expect(finding.severity).not.toBe('error');
      expect(['warn', 'info']).toContain(finding.severity);
    }
  });
});
