import {describe, test, expect, beforeEach, afterEach} from 'vitest';
import {mkdtempSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {inferableDependsOn} from '../../../src/stages/detectors/inferable-depends-on.js';

function writeFile(root: string, relPath: string, contents: string): void {
  const abs = join(root, relPath);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, contents, 'utf8');
}

describe('inferableDependsOn detector', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'clad-infdep-'));
  });

  afterEach(() => {
    rmSync(tmp, {recursive: true, force: true});
  });

  /**
   * Two features: F-aaa111 owns pkg/a.py which imports pkg.b (owned by
   * F-bbb222) but declares NO depends_on. The detector should infer the
   * undeclared edge and surface exactly one info finding.
   */
  function buildEdgeBearingProject(declareEdge: boolean): void {
    const dependsOnLine = declareEdge ? '\n    depends_on: [F-bbb222]' : '';
    const specYaml = `schema: "0.1"
project: {name: t, language: python}
features:
  - id: F-aaa111
    slug: a
    title: A
    status: done
    modules: ["pkg/a.py"]
    acceptance_criteria: []${dependsOnLine}
  - id: F-bbb222
    slug: b
    title: B
    status: done
    modules: ["pkg/b.py"]
    acceptance_criteria: []
`;
    writeFile(tmp, 'spec.yaml', specYaml);
    writeFile(tmp, 'pkg/a.py', 'from pkg.b import thing\n');
    writeFile(tmp, 'pkg/b.py', 'x = 1\n');
  }

  test('[covers:F-15999130/AC-40564f] emits one info finding when undeclared inferable edges exist', () => {
    buildEdgeBearingProject(false);

    const findings = inferableDependsOn.run({cwd: tmp});

    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding.detector).toBe('INFERABLE_DEPENDS_ON');
    expect(finding.severity).toBe('info');
    expect(typeof finding.message).toBe('string');
    expect(finding.message).toContain('clad infer-deps');
  });

  test('[covers:F-15999130/AC-40564f] emits nothing when the dependency graph is fully declared', () => {
    buildEdgeBearingProject(true);

    const findings = inferableDependsOn.run({cwd: tmp});

    expect(findings).toEqual([]);
  });

  test('[covers:F-15999130/AC-e80942] safe-degrades to no findings on an import-less or empty spec', () => {
    // Sub-case (1): features whose modules have NO cross-feature imports.
    const importLessSpec = `schema: "0.1"
project: {name: t, language: python}
features:
  - id: F-aaa111
    slug: a
    title: A
    status: done
    modules: ["pkg/a.py"]
    acceptance_criteria: []
  - id: F-bbb222
    slug: b
    title: B
    status: done
    modules: ["pkg/b.py"]
    acceptance_criteria: []
`;
    writeFile(tmp, 'spec.yaml', importLessSpec);
    writeFile(tmp, 'pkg/a.py', 'x = 1\n');
    writeFile(tmp, 'pkg/b.py', 'x = 1\n');

    let importLessResult: ReturnType<typeof inferableDependsOn.run> = [];
    expect(() => {
      importLessResult = inferableDependsOn.run({cwd: tmp});
    }).not.toThrow();
    expect(importLessResult).toEqual([]);

    // Sub-case (2): an empty features list.
    const emptyTmp = mkdtempSync(join(tmpdir(), 'clad-infdep-'));
    try {
      const emptySpec = `schema: "0.1"
project: {name: t, language: python}
features: []
`;
      writeFile(emptyTmp, 'spec.yaml', emptySpec);

      let emptyResult: ReturnType<typeof inferableDependsOn.run> = [];
      expect(() => {
        emptyResult = inferableDependsOn.run({cwd: emptyTmp});
      }).not.toThrow();
      expect(emptyResult).toEqual([]);
    } finally {
      rmSync(emptyTmp, {recursive: true, force: true});
    }
  });

  test('only ever returns info severity (never fails the gate)', () => {
    buildEdgeBearingProject(false);

    const findings = inferableDependsOn.run({cwd: tmp});

    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.severity).toBe('info');
      expect(finding.severity).not.toBe('error');
      expect(finding.severity).not.toBe('warn');
    }
  });
});
