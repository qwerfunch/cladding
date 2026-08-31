// Cladding · unit tests for stages/detectors/harness-integrity.ts
//
// Detector guards cladding's self-metadata coherence across three
// layers (v0.3.5+, F-080):
//   1. detector count (Claude Code plugin.json current.detectors)
//   2. per-host manifest schema (name/version/description required)
//   3. cross-manifest version drift (package.json ↔ 3 host manifests + marketplace catalog)
//
// Regression target (v0.2.4): bumped detector count 19 → 20 when
// FIXTURE_REFERENCE_INVALID landed. Regression target (v0.3.5):
// v0.3.4 bumped 4 of 4 version refs in lockstep; this detector
// guarantees future bumps stay in lockstep too.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {harnessIntegrity} from '../../src/stages/detectors/harness-integrity.js';

function writeManifest(dir: string, detectors: string | null, version = '0.0.0'): void {
  mkdirSync(join(dir, 'plugins', 'claude-code', '.claude-plugin'), {recursive: true});
  const body: Record<string, unknown> = {name: 'x', version};
  if (detectors !== null) {
    body.ironclad = {current: {detectors}};
  }
  writeFileSync(join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), JSON.stringify(body));
}

function writePackageJson(dir: string, version: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({name: 'cladding-test', version}),
  );
}

function writeCodexManifest(
  dir: string,
  body: Record<string, unknown> = {name: 'x', version: '0.0.0', description: 'x'},
): void {
  mkdirSync(join(dir, 'plugins', 'codex', '.codex-plugin'), {recursive: true});
  writeFileSync(
    join(dir, 'plugins', 'codex', '.codex-plugin', 'plugin.json'),
    JSON.stringify(body),
  );
}

function writeGeminiManifest(
  dir: string,
  body: Record<string, unknown> = {name: 'x', version: '0.0.0'},
): void {
  mkdirSync(join(dir, 'plugins', 'gemini-cli'), {recursive: true});
  writeFileSync(
    join(dir, 'plugins', 'gemini-cli', 'gemini-extension.json'),
    JSON.stringify(body),
  );
}

function writeDetectorFile(dir: string, name: string): void {
  mkdirSync(join(dir, 'src', 'stages', 'detectors'), {recursive: true});
  writeFileSync(join(dir, 'src', 'stages', 'detectors', name), `// ${name}\nexport const x = 1;\n`);
}

/** Synthetic src/cli/clad.ts carrying a TIER_STAGES block the stage-list check parses. */
function writeCliSource(dir: string, stages: readonly string[]): void {
  mkdirSync(join(dir, 'src', 'cli'), {recursive: true});
  const all = stages.map((s) => `'${s}'`).join(', ');
  writeFileSync(
    join(dir, 'src', 'cli', 'clad.ts'),
    `export const TIER_STAGES = {\n  'pre-commit': ['stage_1.3'],\n  all: [${all}],\n};\n`,
  );
}

/**
 * Claude Code manifest carrying a stages-implemented array (null = field omitted).
 * Nested under ironclad.current to mirror the REAL manifest layout — a top-level
 * key here would let the detector read undefined and pass vacuously (the exact
 * false-confidence the deliberate-break test caught).
 */
function writeManifestStages(dir: string, stages: readonly string[] | null, version = '0.0.0'): void {
  mkdirSync(join(dir, 'plugins', 'claude-code', '.claude-plugin'), {recursive: true});
  const body: Record<string, unknown> = {name: 'x', version};
  if (stages !== null) body.ironclad = {current: {'stages-implemented': stages}};
  writeFileSync(join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), JSON.stringify(body));
}

function writeMarketplace(dir: string, version: string, name = 'claude-code'): void {
  mkdirSync(join(dir, '.claude-plugin'), {recursive: true});
  writeFileSync(
    join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({name: 'cladding', plugins: [{name, source: './x', version}]}),
  );
}

describe('HARNESS_INTEGRITY · detector count (v0.2.4)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-harness-int-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test("[covers:F-056/AC-131] declared count matches actual file count → no finding", () => {
    writeManifest(dir, '3/3');
    writeDetectorFile(dir, 'a.ts');
    writeDetectorFile(dir, 'b.ts');
    writeDetectorFile(dir, 'c.ts');
    writeDetectorFile(dir, 'index.ts'); // excluded from count
    expect(harnessIntegrity.run({cwd: dir})).toEqual([]);
  });

  test("[covers:F-080/AC-241][covers:F-67e33f/AC-007] declared count diverges from actual count → error finding", () => {
    writeManifest(dir, '2/2');
    writeDetectorFile(dir, 'a.ts');
    writeDetectorFile(dir, 'b.ts');
    writeDetectorFile(dir, 'c.ts');
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain("'2/2'");
    expect(findings[0].message).toContain('3 non-index');
  });

  test('declared field in wrong shape → warn finding (not error)', () => {
    writeManifest(dir, 'twenty/twenty');
    writeDetectorFile(dir, 'a.ts');
    const findings = harnessIntegrity.run({cwd: dir});
    const matched = findings.filter((f) => f.message.includes('not in'));
    expect(matched).toHaveLength(1);
    expect(matched[0].severity).toBe('warn');
  });

  test('plugin.json absent → info finding (opts out, does not throw)', () => {
    writeDetectorFile(dir, 'a.ts');
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings.some((f) => f.severity === 'info' && f.message.includes('plugin.json not loaded'))).toBe(true);
  });

  test('plugin.json has no detectors field → silent (opt-in metadata)', () => {
    writeManifest(dir, null);
    writeDetectorFile(dir, 'a.ts');
    expect(harnessIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('index.ts is excluded from the count', () => {
    writeManifest(dir, '1/1');
    writeDetectorFile(dir, 'real.ts');
    writeDetectorFile(dir, 'index.ts');
    expect(harnessIntegrity.run({cwd: dir})).toEqual([]);
  });
});

describe('HARNESS_INTEGRITY · per-host schema (F-080)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-harness-int-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test("[covers:F-080/AC-242] Codex manifest missing description → error finding", () => {
    writeManifest(dir, null);
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.5'}); // description omitted
    const findings = harnessIntegrity.run({cwd: dir});
    const codexErrors = findings.filter(
      (f) => f.severity === 'error' && f.message.includes('codex') && f.message.includes('description'),
    );
    expect(codexErrors).toHaveLength(1);
  });

  test("[covers:F-080/AC-242] Gemini manifest missing version → error finding", () => {
    writeManifest(dir, null);
    writeGeminiManifest(dir, {name: 'cladding'}); // version omitted
    const findings = harnessIntegrity.run({cwd: dir});
    const geminiErrors = findings.filter(
      (f) => f.severity === 'error' && f.message.includes('gemini-cli') && f.message.includes('version'),
    );
    expect(geminiErrors).toHaveLength(1);
  });

  test("[covers:F-080/AC-242] Claude Code manifest missing name → error finding", () => {
    mkdirSync(join(dir, 'plugins', 'claude-code', '.claude-plugin'), {recursive: true});
    writeFileSync(
      join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'),
      JSON.stringify({version: '0.3.5'}), // name omitted
    );
    const findings = harnessIntegrity.run({cwd: dir});
    const claudeErrors = findings.filter(
      (f) => f.severity === 'error' && f.message.includes('claude-code') && f.message.includes('name'),
    );
    expect(claudeErrors).toHaveLength(1);
  });

  test('host manifest absent → no finding (only present-but-broken triggers)', () => {
    writeManifest(dir, null);
    // No codex, no gemini → silent.
    const findings = harnessIntegrity.run({cwd: dir});
    const hostFindings = findings.filter(
      (f) => f.message.includes('codex') || f.message.includes('gemini-cli'),
    );
    expect(hostFindings).toEqual([]);
  });

  test("[covers:F-080/AC-243] codex manifest malformed JSON → warn finding (not error)", () => {
    writeManifest(dir, null);
    mkdirSync(join(dir, 'plugins', 'codex', '.codex-plugin'), {recursive: true});
    writeFileSync(
      join(dir, 'plugins', 'codex', '.codex-plugin', 'plugin.json'),
      '{not valid json',
    );
    const findings = harnessIntegrity.run({cwd: dir});
    const parseWarns = findings.filter(
      (f) => f.severity === 'warn' && f.message.includes('codex') && f.message.includes('could not be parsed'),
    );
    expect(parseWarns).toHaveLength(1);
  });

  test('all three host manifests well-formed → no per-host finding', () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.5');
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.5', description: 'x'});
    writeGeminiManifest(dir, {name: 'cladding', version: '0.3.5'});
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
  });
});

describe('HARNESS_INTEGRITY · cross-manifest version drift (F-080)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-harness-int-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('all four versions match → no version finding', () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.5');
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.5', description: 'x'});
    writeGeminiManifest(dir, {name: 'cladding', version: '0.3.5'});
    const findings = harnessIntegrity.run({cwd: dir});
    const versionFindings = findings.filter((f) => f.message.includes('version='));
    expect(versionFindings).toEqual([]);
  });

  test("[covers:F-080/AC-244] Codex version drifts from package.json → error", () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.5');
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.4', description: 'x'});
    writeGeminiManifest(dir, {name: 'cladding', version: '0.3.5'});
    const findings = harnessIntegrity.run({cwd: dir});
    const codexDrift = findings.filter(
      (f) => f.severity === 'error' && f.message.includes('codex') && f.message.includes("version='0.3.4'"),
    );
    expect(codexDrift).toHaveLength(1);
  });

  test('two manifests drift simultaneously → two error findings', () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.5');
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.4', description: 'x'});
    writeGeminiManifest(dir, {name: 'cladding', version: '0.3.3'});
    const findings = harnessIntegrity.run({cwd: dir});
    const drifts = findings.filter(
      (f) => f.severity === 'error' && f.message.includes('but package.json version='),
    );
    expect(drifts).toHaveLength(2);
  });

  test("[covers:F-080/AC-245] package.json missing → version check skipped silently", () => {
    writeManifest(dir, null, '0.3.5');
    writeCodexManifest(dir, {name: 'cladding', version: '0.3.4', description: 'x'});
    const findings = harnessIntegrity.run({cwd: dir});
    const drifts = findings.filter((f) => f.message.includes('but package.json version='));
    expect(drifts).toEqual([]);
  });

  test('Claude Code manifest version drifts from package.json → error', () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.4'); // claude-code drifts
    const findings = harnessIntegrity.run({cwd: dir});
    const claudeDrift = findings.filter(
      (f) =>
        f.severity === 'error' &&
        f.message.includes('claude-code') &&
        f.message.includes("version='0.3.4'"),
    );
    expect(claudeDrift).toHaveLength(1);
  });

  test('marketplace.json catalog matches package.json → no version finding', () => {
    writePackageJson(dir, '0.3.5');
    writeManifest(dir, null, '0.3.5');
    writeMarketplace(dir, '0.3.5');
    const findings = harnessIntegrity.run({cwd: dir});
    const versionFindings = findings.filter((f) => f.message.includes('version='));
    expect(versionFindings).toEqual([]);
  });

  test('marketplace.json catalog lags package.json → error (the stale-catalog gap)', () => {
    writePackageJson(dir, '0.5.0');
    writeManifest(dir, null, '0.5.0');
    writeMarketplace(dir, '0.4.0'); // catalog advertises a stale release
    const findings = harnessIntegrity.run({cwd: dir});
    const marketDrift = findings.filter(
      (f) =>
        f.severity === 'error' &&
        f.message.includes('marketplace') &&
        f.message.includes("version='0.4.0'"),
    );
    expect(marketDrift).toHaveLength(1);
  });

  test('marketplace.json absent → marketplace check skipped silently', () => {
    writePackageJson(dir, '0.5.0');
    writeManifest(dir, null, '0.5.0');
    const findings = harnessIntegrity.run({cwd: dir});
    const marketDrift = findings.filter((f) => f.message.includes('marketplace'));
    expect(marketDrift).toEqual([]);
  });
});

describe('HARNESS_INTEGRITY · stage list (v0.6.2)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-harness-int-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('manifest stages-implemented matches TIER_STAGES.all → no finding', () => {
    writeCliSource(dir, ['stage_1.1', 'stage_2.3', 'stage_2.4', 'stage_4.2']);
    writeManifestStages(dir, ['stage_1.1', 'stage_2.3', 'stage_2.4', 'stage_4.2']);
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings.filter((f) => f.message.includes('stages-implemented'))).toEqual([]);
  });

  test('manifest omits stages the engine runs → error finding (the 13-vs-15 drift)', () => {
    writeCliSource(dir, ['stage_1.1', 'stage_2.3', 'stage_2.4', 'stage_4.2']);
    writeManifestStages(dir, ['stage_1.1', 'stage_4.2']); // stage_2.3 + stage_2.4 missing
    const findings = harnessIntegrity.run({cwd: dir});
    const stageErr = findings.filter((f) => f.severity === 'error' && f.message.includes('stages-implemented'));
    expect(stageErr).toHaveLength(1);
    expect(stageErr[0].message).toContain('missing [stage_2.3, stage_2.4]');
  });

  test('manifest lists a stage the engine does not run → error (unexpected)', () => {
    writeCliSource(dir, ['stage_1.1', 'stage_4.2']);
    writeManifestStages(dir, ['stage_1.1', 'stage_4.2', 'stage_9.9']);
    const findings = harnessIntegrity.run({cwd: dir});
    const stageErr = findings.filter((f) => f.severity === 'error' && f.message.includes('stages-implemented'));
    expect(stageErr).toHaveLength(1);
    expect(stageErr[0].message).toContain('unexpected [stage_9.9]');
  });

  test('stages-implemented field absent → silent (opt-in metadata)', () => {
    writeCliSource(dir, ['stage_1.1', 'stage_4.2']);
    writeManifestStages(dir, null);
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings.filter((f) => f.message.includes('stages-implemented'))).toEqual([]);
  });

  test('cli source absent (adopting project) → silent', () => {
    writeManifestStages(dir, ['stage_1.1']); // manifest present, but no src/cli/clad.ts
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings.filter((f) => f.message.includes('stages-implemented'))).toEqual([]);
  });
});
