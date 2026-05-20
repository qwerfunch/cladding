// Cladding · unit tests for stages/detectors/architecture-from-spec.ts (F-088)
//
// Detector under test resurrects spec/architecture.yaml from dead code
// into a working invariant. Tests cover:
//   - forbidden-import compliance (error) — regex grep across src/
//   - undeclared directory (warn) — src/ dir not in layers
//   - empty layer (warn) — layer name with no src/<layer>/ dir
//   - happy path — all clean → no findings
//   - missing architecture.yaml → silent (soft validator)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {architectureFromSpec} from '../../src/stages/detectors/architecture-from-spec.js';

function writeMaster(dir: string): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n',
  );
}

function writeArchitecture(dir: string, body: string): void {
  mkdirSync(join(dir, 'spec'), {recursive: true});
  writeFileSync(join(dir, 'spec', 'architecture.yaml'), body);
}

function writeSrcFile(dir: string, relPath: string, content: string): void {
  const abs = join(dir, 'src', relPath);
  mkdirSync(join(abs, '..'), {recursive: true});
  writeFileSync(abs, content);
}

describe('ARCHITECTURE_FROM_SPEC (F-088, v0.3.13)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-arch-spec-'));
    writeMaster(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  describe('happy path', () => {
    test('all layers present, no forbidden imports, no findings', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, stages]]\nforbidden_imports: []\n',
      );
      writeSrcFile(dir, 'spec/loader.ts', 'export const x = 1;\n');
      writeSrcFile(dir, 'stages/drift.ts', 'export const y = 2;\n');
      expect(architectureFromSpec.run({cwd: dir})).toEqual([]);
    });
  });

  describe('forbidden_imports (error)', () => {
    test('spec/*.ts importing from stages/ → error', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, stages]]\nforbidden_imports:\n  - from: spec\n    to: stages\n',
      );
      writeSrcFile(
        dir,
        'spec/loader.ts',
        "import {drift} from '../stages/drift.js';\nexport const x = 1;\n",
      );
      writeSrcFile(dir, 'stages/drift.ts', 'export const drift = 1;\n');
      const findings = architectureFromSpec.run({cwd: dir});
      const errors = findings.filter((f) => f.severity === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain("from 'spec' to 'stages'");
      expect(errors[0].message).toContain('src/spec/loader.ts');
    });

    test('legal import (stages/ → spec/) does NOT trigger when only spec→stages is forbidden', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, stages]]\nforbidden_imports:\n  - from: spec\n    to: stages\n',
      );
      writeSrcFile(dir, 'spec/loader.ts', 'export const x = 1;\n');
      writeSrcFile(
        dir,
        'stages/drift.ts',
        "import {loader} from '../spec/loader.js';\nexport const y = 2;\n",
      );
      const findings = architectureFromSpec.run({cwd: dir});
      expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    });

    test('external package imports do not trigger forbidden_imports', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, stages]]\nforbidden_imports:\n  - from: spec\n    to: stages\n',
      );
      writeSrcFile(
        dir,
        'spec/loader.ts',
        "import yaml from 'yaml';\nimport {stages} from 'some-pkg/stages';\nexport const x = 1;\n",
      );
      writeSrcFile(dir, 'stages/drift.ts', 'export const drift = 1;\n');
      const findings = architectureFromSpec.run({cwd: dir});
      expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
    });

    test('multiple forbidden rules + multiple violations → multiple errors', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, stages, toolchain]]\nforbidden_imports:\n  - from: spec\n    to: stages\n  - from: toolchain\n    to: stages\n',
      );
      writeSrcFile(
        dir,
        'spec/a.ts',
        "import {x} from '../stages/x.js';\nexport const a = 1;\n",
      );
      writeSrcFile(
        dir,
        'toolchain/b.ts',
        "import {x} from '../stages/x.js';\nexport const b = 1;\n",
      );
      writeSrcFile(dir, 'stages/x.ts', 'export const x = 1;\n');
      const findings = architectureFromSpec.run({cwd: dir});
      const errors = findings.filter((f) => f.severity === 'error');
      expect(errors).toHaveLength(2);
    });
  });

  describe('undeclared directory (warn)', () => {
    test('src/ contains a directory not in any layer → warn', () => {
      writeArchitecture(dir, 'layers: [[spec, stages]]\nforbidden_imports: []\n');
      writeSrcFile(dir, 'spec/x.ts', 'export const x = 1;\n');
      writeSrcFile(dir, 'stages/y.ts', 'export const y = 1;\n');
      writeSrcFile(dir, 'sneaky-extra/z.ts', 'export const z = 1;\n');
      const findings = architectureFromSpec.run({cwd: dir});
      const warns = findings.filter(
        (f) => f.severity === 'warn' && f.message.includes('sneaky-extra'),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].message).toContain('not declared');
    });
  });

  describe('empty layer (warn)', () => {
    test('layer declared but src/<layer>/ does not exist → warn', () => {
      writeArchitecture(
        dir,
        'layers: [[spec, phantom-layer]]\nforbidden_imports: []\n',
      );
      writeSrcFile(dir, 'spec/x.ts', 'export const x = 1;\n');
      const findings = architectureFromSpec.run({cwd: dir});
      const warns = findings.filter(
        (f) => f.severity === 'warn' && f.message.includes('phantom-layer'),
      );
      expect(warns).toHaveLength(1);
      expect(warns[0].message).toContain('does not exist');
    });
  });

  describe('soft validator', () => {
    test('spec/architecture.yaml absent → silent (no findings)', () => {
      writeSrcFile(dir, 'spec/x.ts', 'export const x = 1;\n');
      expect(architectureFromSpec.run({cwd: dir})).toEqual([]);
    });

    test('spec.yaml absent → silent (loadSpec throws, detector swallows)', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'clad-arch-empty-'));
      try {
        expect(architectureFromSpec.run({cwd: emptyDir})).toEqual([]);
      } finally {
        rmSync(emptyDir, {recursive: true, force: true});
      }
    });

    test('architecture present but empty (no layers, no forbidden_imports) → no findings', () => {
      writeArchitecture(dir, 'layers: []\nforbidden_imports: []\n');
      writeSrcFile(dir, 'spec/x.ts', 'export const x = 1;\n');
      expect(architectureFromSpec.run({cwd: dir})).toEqual([]);
    });
  });
});
