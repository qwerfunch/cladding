// Cladding · unit tests for the init-empty-layers-valid-yaml fix (F-284be4f6)
//
// Contract (spec/features/init-empty-layers-valid-yaml-284be4f6.yaml):
//   AC-a76ab3fd — when the detected layer array is empty, renderArchitectureYaml
//     must emit `layers: []` (not a bare `layers:`), so the generated
//     architecture.yaml parses to an empty array and the assembled spec loads.
//   AC-743bfe4e — when the layer array is non-empty, renderArchitectureYaml
//     must keep emitting the block form (`layers:` + one entry per layer)
//     unchanged — the fix must not regress the normal multi-layer output.
//
// `renderArchitectureYaml` (src/cli/scan/llm.ts) is module-private — it is
// not in llm.ts's `export` list. Its only caller is the exported
// `deterministicInterpret`, which forwards `scan.architecture.layers` and
// `scan.architecture.forbiddenImportCandidates` straight into it with no
// transformation in between (llm.ts: `renderArchitectureYaml(scan.architecture.layers,
// scan.architecture.forbiddenImportCandidates)`). So
// `deterministicInterpret(scan).architectureYaml` is a byte-faithful proxy for
// the private renderer's output, exercised through the same public entry
// point `clad init` uses (`interpretScanWithFallback` -> `deterministicInterpret`
// on the no-dispatcher path) rather than widening llm.ts's export surface
// just for this test.
//
// Reproduction + root cause: scratchpad/uxlang/initbug-repro.md.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {deterministicInterpret} from '../../src/cli/scan/llm.js';
import type {Layer, ScanResult} from '../../src/cli/scan/index.js';
import {loadSpec} from '../../src/spec/load.js';

/** Builds a minimal ScanResult with configurable layers — the only field
 * renderArchitectureYaml (via deterministicInterpret) actually consumes,
 * along with forbiddenImportCandidates. */
function fakeScan(
  layers: readonly Layer[],
  forbiddenImportCandidates: Readonly<Record<string, readonly string[]>> = {},
): ScanResult {
  return {
    conventions: {
      indent: 'two-space',
      quote: 'single',
      semicolon: 'present',
      namingExports: 'camelCase',
      namingConstants: 'UPPER_SNAKE',
      docBlockRatio: 0,
      docTagCounts: {},
      importOrder: 'node-first',
      exportPattern: 'named-only',
      errorHandling: 'throw-primary',
      typeDefLocation: 'inline',
      fileHeaderPattern: null,
      testLocation: 'tests-dir',
      moduleBoilerplate: null,
    },
    architecture: {
      layers,
      importGraph: [],
      forbiddenImportCandidates,
    },
    scenarios: [],
    examples: [],
    stats: {
      filesScanned: 3,
      languagesSeen: ['.ts'],
      languageCounts: {typescript: 3},
      dominantLanguage: 'typescript',
      sourceRoot: '/tmp/proj/src',
    },
    projectContext: null,
  };
}

/** Writes a minimal schema-valid spec.yaml plus the given architecture.yaml
 * body, mirroring the sharded layout `clad init` produces on disk (spec.yaml
 * carries project metadata, spec/architecture.yaml carries the scanned
 * layers) — this is the real assembled-spec path (`loadSpec` -> `assertSpec`),
 * not a standalone YAML parse. */
function writeMinimalSpec(dir: string, architectureYamlBody: string): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\n' + 'project: {name: x, language: typescript}\n' + 'features: []\n',
  );
  mkdirSync(join(dir, 'spec'), {recursive: true});
  writeFileSync(join(dir, 'spec', 'architecture.yaml'), architectureYamlBody);
}

describe('AC-a76ab3fd — empty layer array renders layers: [] (valid, loadable)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-init-empty-layers-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('empty layers -> explicit empty-array form, not a bare key', () => {
    const {architectureYaml} = deterministicInterpret(fakeScan([]));
    expect(architectureYaml).toContain('layers: []');
    // Pre-fix shape: a bare `layers:` with nothing after it on its own
    // line must not reappear.
    expect(architectureYaml).not.toMatch(/^layers:$/m);
  });

  test('empty-array output parses as YAML to {layers: []}, an actual array', () => {
    const {architectureYaml} = deterministicInterpret(fakeScan([]));
    const parsed = parseYaml(architectureYaml) as {layers: unknown};
    expect(Array.isArray(parsed.layers)).toBe(true);
    expect(parsed.layers).toEqual([]);
  });

  test('strongest: the rendered body loads through the real assembled-spec path (loadSpec/assertSpec)', () => {
    const {architectureYaml} = deterministicInterpret(fakeScan([]));
    writeMinimalSpec(dir, architectureYaml);
    let spec: ReturnType<typeof loadSpec> | undefined;
    expect(() => {
      spec = loadSpec(dir);
    }).not.toThrow();
    expect(spec?.architecture?.layers).toEqual([]);
  });

  test('pre-fix negative control: a bare "layers:" parses to null, not an array', () => {
    // Exact pre-fix output shape (see initbug-repro.md §4), asserted
    // directly against the `yaml` package cladding itself uses to parse
    // spec files (src/spec/parse.ts) — independent of the renderer, this
    // documents why a bare key was never schema-valid.
    const parsed = parseYaml('layers:\n') as {layers: unknown};
    expect(parsed.layers).toBeNull();
    expect(Array.isArray(parsed.layers)).toBe(false);
  });

  test('pre-fix negative control: a bare "layers:" body fails to load through the real schema — the exact bug this fix prevents', () => {
    writeMinimalSpec(dir, 'layers:\n');
    expect(() => loadSpec(dir)).toThrow(/architecture\.layers.*is not of a type\(s\) array/);
  });
});

describe('AC-743bfe4e — non-empty layer array keeps the block form unchanged', () => {
  test('one layer -> block form ("layers:" + its entry), unchanged', () => {
    const layers: Layer[] = [{name: 'core', dir: 'core', moduleCount: 5}];
    const {architectureYaml} = deterministicInterpret(fakeScan(layers, {}));
    expect(architectureYaml).not.toContain('layers: []');
    expect(architectureYaml).toContain(
      'layers:\n' + '  - name: core\n' + '    modules: ["core/**"]\n' + '    forbidden_imports: []\n',
    );
  });

  test('two layers -> block form with both entries in order and forbidden_imports candidates populated', () => {
    const layers: Layer[] = [
      {name: 'core', dir: 'core', moduleCount: 5},
      {name: 'cli', dir: 'cli', moduleCount: 3},
    ];
    const {architectureYaml} = deterministicInterpret(fakeScan(layers, {core: ['cli']}));
    expect(architectureYaml).not.toContain('layers: []');
    expect(architectureYaml).toContain(
      'layers:\n' +
        '  - name: core\n' +
        '    modules: ["core/**"]\n' +
        '    forbidden_imports: ["cli"]\n' +
        '  - name: cli\n' +
        '    modules: ["cli/**"]\n' +
        '    forbidden_imports: []\n',
    );
  });

  test('regression control: the non-empty block form still loads through the real assembled-spec path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-init-nonempty-layers-'));
    try {
      const layers: Layer[] = [
        {name: 'core', dir: 'core', moduleCount: 5},
        {name: 'cli', dir: 'cli', moduleCount: 3},
      ];
      const {architectureYaml} = deterministicInterpret(fakeScan(layers, {core: ['cli']}));
      writeMinimalSpec(dir, architectureYaml);
      let spec: ReturnType<typeof loadSpec> | undefined;
      expect(() => {
        spec = loadSpec(dir);
      }).not.toThrow();
      expect(spec?.architecture?.layers).toHaveLength(2);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
