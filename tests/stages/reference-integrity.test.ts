// Cladding · unit tests for stages/detectors/reference-integrity.ts
//
// Detector under test validates every internal ID reference in
// spec.yaml against the feature catalog:
//   - features[].depends_on[]   → must exist
//   - features[].superseded_by  → must exist
//   - scenarios[].features[]    → must exist
//
// Each broken reference emits an error finding with context. ADR
// references are out of scope until the ADR subsystem lands.

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  type Stats,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

const sourceReferenceScan = vi.hoisted(() => vi.fn());

vi.mock('../../src/graph/source-references.js', async (importOriginal) => {
  const sourceReferences = await importOriginal<typeof import('../../src/graph/source-references.js')>();
  sourceReferenceScan.mockImplementation(sourceReferences.scanSourceReferences);
  return {...sourceReferences, scanSourceReferences: sourceReferenceScan};
});

import {scanSourceReferences} from '../../src/graph/source-references.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {allDetectors} from '../../src/stages/detectors/index.js';
import {referenceIntegrity} from '../../src/stages/detectors/reference-integrity.js';

const SPEC_HEADER =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

const SOURCE_SHARD = 'spec/features/alpha-aaaaaaaa.yaml';

function writeSourceFixture(
  dir: string,
  schema: '0.1' | '0.2',
  source: string,
  modules: readonly string[] = ['src/carriers.ts'],
  capabilityRefs: readonly string[] = [],
): void {
  if (schema === '0.2') {
    writeFileSync(join(dir, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: source-references', '  language: typescript',
      '  purpose: Keep authored source references strict.', '  assurance_level: L2', '  scenario_policy: advisory', '',
    ].join('\n'));
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  }
  writeFileSync(join(dir, SOURCE_SHARD), [
    'id: F-aaaaaaaa', 'title: Alpha', 'status: planned', 'purpose: Keep authored source references strict.',
    `modules: [${modules.join(', ')}]`, 'depends_on: []', `capability_refs: [${capabilityRefs.join(', ')}]`,
    'acceptance_criteria:', '  - id: AC-11111111', '    kind: behavior',
    '    statement: The system shall preserve authored source references.', '',
  ].join('\n'));
  mkdirSync(join(dir, 'src'), {recursive: true});
  writeFileSync(join(dir, 'src', 'carriers.ts'), source);
}

describe('REFERENCE_INTEGRITY detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ref-int-'));
    writeFileSync(join(dir, 'spec.yaml'), SPEC_HEADER);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    sourceReferenceScan.mockClear();
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('all depends_on ids exist → silent', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: a\nstatus: done\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: b\nstatus: done\ndepends_on: [F-001]\n',
    );
    expect(referenceIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-057/AC-135] unknown depends_on reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\ndepends_on: [F-999]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.depends_on');
    expect(findings[0].message).toContain("'F-999'");
  });

  test('[covers:F-057/AC-135] unknown superseded_by reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: archived\nsuperseded_by: F-888\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.superseded_by');
    expect(findings[0].message).toContain("'F-888'");
  });

  test('[covers:F-057/AC-135] unknown scenario feature reference reports an error', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    mkdirSync(join(dir, 'spec', 'scenarios'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'scenarios', 'S-001.yaml'),
      'id: S-001\ntitle: flow\nfeatures: [F-001, F-777]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('S-001.features');
    expect(findings[0].message).toContain("'F-777'");
  });

  test('multiple broken refs → one finding each', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\ndepends_on: [F-901, F-902]\n',
    );
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(2);
    const cited = findings.map((f) => f.message.match(/F-90\d/)?.[0]).sort();
    expect(cited).toEqual(['F-901', 'F-902']);
  });

  test('superseded_by resolves to a real feature → silent', () => {
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: legacy\nstatus: archived\narchived_at: "2024-01-01T00:00:00Z"\nsuperseded_by: F-002\n',
    );
    writeFileSync(
      join(dir, 'spec', 'features', 'F-002.yaml'),
      'id: F-002\ntitle: replacement\nstatus: done\n',
    );
    expect(referenceIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('absent spec.yaml emits one info finding', () => {
    rmSync(join(dir, 'spec.yaml'));
    const findings = referenceIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('spec.yaml not loaded');
  });

  test.each(['0.1', '0.2'] as const)(
    '[covers:F-208eaa79/AC-4f8c2542] schema %s valid source reference is silent',
    (schema) => {
      writeSourceFixture(dir, schema, `// @see ${SOURCE_SHARD} AC-11111111\n`);
      expect(referenceIntegrity.run({cwd: dir})).toEqual([]);
    },
  );

  test(
    '[covers:F-208eaa79/AC-d452908b] each authored source-reference issue reports its exact path, line, and remediation',
    () => {
      writeSourceFixture(dir, '0.1', [
        `// @see ${SOURCE_SHARD}`,
        `// @see ./${SOURCE_SHARD} AC-11111111`,
        '// @see spec/features/missing-bbbbbbbb.yaml AC-11111111',
        `// @see ${SOURCE_SHARD} AC-deadbeef`,
        '',
      ].join('\n'));

      expect(referenceIntegrity.run({cwd: dir})).toEqual([
        {
          detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 1,
          message: `source reference '// @see ${SOURCE_SHARD}' names a feature without an acceptance criterion` +
            ' — add an AC target.',
        },
        {
          detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 2,
          message: `source reference '// @see ./${SOURCE_SHARD} AC-11111111' uses a non-canonical feature path` +
            ' — use spec/features/<shard>.yaml.',
        },
        {
          detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 3,
          message: "source reference '// @see spec/features/missing-bbbbbbbb.yaml AC-11111111'" +
            ' names an unknown feature shard' +
            ' — fix the path or add the shard.',
        },
        {
          detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 4,
          message: `source reference '// @see ${SOURCE_SHARD} AC-deadbeef' names unknown criterion` +
            ` 'criterion:F-aaaaaaaa/AC-deadbeef' — fix the AC id or add it to '${SOURCE_SHARD}'.`,
        },
      ]);
    },
  );

  test(
    '[covers:F-208eaa79/AC-d452908b] a known shard with a wrong criterion stays unresolved without aliasing another criterion',
    () => {
      writeSourceFixture(dir, '0.1', `// @see ${SOURCE_SHARD} AC-deadbeef\n`);

      expect(referenceIntegrity.run({cwd: dir})).toEqual([{
        detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 1,
        message: `source reference '// @see ${SOURCE_SHARD} AC-deadbeef' names unknown criterion` +
          ` 'criterion:F-aaaaaaaa/AC-deadbeef' — fix the AC id or add it to '${SOURCE_SHARD}'.`,
      }]);
    },
  );

  test('[covers:F-208eaa79/AC-d452908b] schema 0.2 retains compiler and authored source-reference findings together', () => {
    writeSourceFixture(dir, '0.2', [
      '// @see spec/features/missing-bbbbbbbb.yaml AC-11111111',
      `// @see ${SOURCE_SHARD} AC-deadbeef`,
      '',
    ].join('\n'), undefined, ['missing-capability']);

    expect(referenceIntegrity.run({cwd: dir})).toEqual([
      {
        detector: 'REFERENCE_INTEGRITY', severity: 'error', path: SOURCE_SHARD,
        message: 'F-aaaaaaaa capability_refs contains unknown capability missing-capability' +
          ' — fix the reference or add the missing item.',
      },
      {
        detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 1,
        message: "source reference '// @see spec/features/missing-bbbbbbbb.yaml AC-11111111'" +
          ' names an unknown feature shard' +
          ' — fix the path or add the shard.',
      },
      {
        detector: 'REFERENCE_INTEGRITY', severity: 'error', path: 'src/carriers.ts', line: 2,
        message: `source reference '// @see ${SOURCE_SHARD} AC-deadbeef' names unknown criterion` +
          ` 'criterion:F-aaaaaaaa/AC-deadbeef' — fix the AC id or add it to '${SOURCE_SHARD}'.`,
      },
    ]);
  });

  test('[covers:F-208eaa79/AC-616e6e74] uses the compiler-bounded source scanner exactly once per detector run', () => {
    writeSourceFixture(dir, '0.1', `// @see ${SOURCE_SHARD} AC-11111111\n`);

    referenceIntegrity.run({cwd: dir});

    expect(sourceReferenceScan).toHaveBeenCalledTimes(1);
  });

  test('[covers:F-208eaa79/AC-d452908b] unknown source artifacts remain graph completeness state, not REFERENCE_INTEGRITY findings', () => {
    writeSourceFixture(
      dir,
      '0.1',
      `// @see ${SOURCE_SHARD} AC-11111111\n`,
      ['src/missing.ts', 'src/link.ts', 'src/not-file.ts', 'src/unreadable.ts', 'src/ownership'],
    );
    writeFileSync(join(dir, 'src', 'not-file.ts'), 'export const regularOnDisk = true;\n');
    writeFileSync(join(dir, 'src', 'unreadable.ts'), 'export const unreadable = true;\n');
    mkdirSync(join(dir, 'src', 'ownership'), {recursive: true});
    writeFileSync(join(dir, 'src', 'ownership', 'nested.ts'), `// @see ${SOURCE_SHARD} AC-deadbeef\n`);
    symlinkSync(join(dir, 'outside.ts'), join(dir, 'src', 'link.ts'));

    expect(referenceIntegrity.run({cwd: dir})).toEqual([]);

    const nonRegularStats = {
      isDirectory: () => false,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats;
    const scan = scanSourceReferences(dir, compileSpecWorkspace(dir), {
      lstat: (path) => path === join(dir, 'src', 'not-file.ts') ? nonRegularStats : lstatSync(path),
      readFile: (path) => {
        if (path === join(dir, 'src', 'unreadable.ts')) {
          throw Object.assign(new Error('denied'), {code: 'EACCES'});
        }
        return readFileSync(path);
      },
    });

    expect(scan.completeness).toBe('unknown');
    expect(scan.unknownFiles).toEqual(expect.arrayContaining([
      {path: 'src/missing.ts', reason: 'missing'},
      {path: 'src/link.ts', reason: 'symlink'},
      {path: 'src/not-file.ts', reason: 'not_file'},
      {path: 'src/unreadable.ts', reason: 'unreadable'},
    ]));
    expect(scan.unknownFiles.map((file) => file.path)).not.toContain('src/ownership');
    expect(scan.issues).toEqual([]);
  });

  test('the detector catalog remains at 41 entries', () => {
    expect(allDetectors).toHaveLength(41);
  });
});
