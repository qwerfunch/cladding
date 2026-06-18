// Cladding · unit tests for stages/detectors/architecture-from-spec.ts (Kotlin)
//
// ARCHITECTURE_FROM_SPEC flexes by spec.project.language. For a Kotlin
// project the layer dirs live under src/main/kotlin/<layer>/, sources are
// `**/*.kt`, and forbidden-import matching uses DOTTED package segments: a
// Kotlin `import core.add` whose package path contains a forbidden `to` layer
// segment is flagged. Pins: a cli→core import crossing a forbidden boundary
// emits an error naming the file; removing the import clears it.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {architectureFromSpec} from '../../../src/stages/detectors/architecture-from-spec.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-arch-kt-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** A schema-valid Kotlin spec with an inline cli→core forbidden-import rule. */
function writeKotlinSpec(): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: t\n  language: kotlin\n' +
      'architecture:\n  layers:\n    - [cli, core]\n  forbidden_imports:\n    - {from: cli, to: core}\n' +
      'features:\n  - id: F-001\n    title: f\n    status: done\n' +
      '    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}

/** Writes a layer source file under src/main/kotlin/<layer>/<name>. */
function writeKtLayerFile(layer: string, name: string, body: string): void {
  const layerDir = join(dir, 'src', 'main', 'kotlin', layer);
  mkdirSync(layerDir, {recursive: true});
  writeFileSync(join(layerDir, name), body);
}

function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return architectureFromSpec.run({cwd: dir}).filter((f) => f.detector === 'ARCHITECTURE_FROM_SPEC');
}

describe('ARCHITECTURE_FROM_SPEC detector (Kotlin)', () => {
  test('ERROR when a Kotlin cli file imports a forbidden core layer (dotted package match)', () => {
    writeKotlinSpec();
    writeKtLayerFile('cli', 'App.kt', 'package cli\n\nimport core.add\n\nfun main() {}\n');
    writeKtLayerFile('core', 'Math.kt', 'package core\n\nfun add(a: Int, b: Int) = a + b\n');
    const findings = run();
    const err = findings.find((f) => f.severity === 'error');
    expect(err).toBeDefined();
    expect(err?.path).toBe('src/main/kotlin/cli/App.kt');
    expect(err?.message).toContain('core');
  });

  test('CLEAN when the forbidden import is removed', () => {
    writeKotlinSpec();
    writeKtLayerFile('cli', 'App.kt', 'package cli\n\nfun main() {}\n');
    writeKtLayerFile('core', 'Math.kt', 'package core\n\nfun add(a: Int, b: Int) = a + b\n');
    expect(run().filter((f) => f.severity === 'error')).toHaveLength(0);
  });
});
