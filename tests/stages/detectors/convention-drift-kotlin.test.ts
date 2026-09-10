// Cladding · unit tests for stages/detectors/convention-drift.ts (Kotlin)
//
// CONVENTION_DRIFT's extension check flexes by language config: for a Kotlin
// project it inspects `.kt` modules (not `.ts`), while the file-header comment
// rule (`//`, `/*`) is unchanged. Pins: a declared .kt module with no header
// comment warns; the same module with a `// x` header is clean.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {conventionDrift} from '../../../src/stages/detectors/convention-drift.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-conv-kt-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Writes a Kotlin spec whose single done feature declares the given module. */
function writeKotlinSpec(modulePath: string): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: t\n  language: kotlin\n' +
      `features:\n  - id: F-001\n    title: f\n    status: done\n    modules: [${modulePath}]\n` +
      '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}

/** Writes a module file at the given relative path with the given body. */
function writeModule(rel: string, body: string): void {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), {recursive: true});
  writeFileSync(abs, body);
}

function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return conventionDrift.run({cwd: dir}).filter((f) => f.detector === 'CONVENTION_DRIFT');
}

describe('CONVENTION_DRIFT detector (Kotlin)', () => {
  const MODULE = 'src/main/kotlin/App.kt';

  test('[covers:F-dd51b42c/AC-2d888ee2] WARN when a declared .kt module has no file-header comment', () => {
    writeKotlinSpec(MODULE);
    writeModule(MODULE, 'package x\n\nfun main() {}\n');
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe(MODULE);
    expect(findings[0].message).toContain('no file-header comment');
  });

  test('CLEAN when the .kt module starts with a // header comment', () => {
    writeKotlinSpec(MODULE);
    writeModule(MODULE, '// App entry point\npackage x\n\nfun main() {}\n');
    expect(run()).toHaveLength(0);
  });
});
