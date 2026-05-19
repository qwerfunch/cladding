// Cladding · unit tests for stages/detectors/harness-integrity.ts
//
// Detector under test guards cladding's self-metadata coherence:
// the numerator of `.claude-plugin/plugin.json current.detectors` must
// equal the count of non-index .ts files under `stages/detectors/`.
//
// Regression target: v0.2.4 bumped the count from 19 to 20 when
// FIXTURE_REFERENCE_INVALID landed. Future detector additions or
// removals MUST be paired with a plugin.json update — this detector
// guarantees the pairing.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {harnessIntegrity} from '../../src/stages/detectors/harness-integrity.js';

function writeManifest(dir: string, detectors: string | null): void {
  mkdirSync(join(dir, '.claude-plugin'), {recursive: true});
  const body: Record<string, unknown> = {name: 'x', version: '0.0.0'};
  if (detectors !== null) {
    body.ironclad = {current: {detectors}};
  }
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(body));
}

function writeDetectorFile(dir: string, name: string): void {
  mkdirSync(join(dir, 'src', 'stages', 'detectors'), {recursive: true});
  writeFileSync(join(dir, 'src', 'stages', 'detectors', name), `// ${name}\nexport const x = 1;\n`);
}

describe('HARNESS_INTEGRITY detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-harness-int-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('declared count matches actual file count → no finding', () => {
    writeManifest(dir, '3/3');
    writeDetectorFile(dir, 'a.ts');
    writeDetectorFile(dir, 'b.ts');
    writeDetectorFile(dir, 'c.ts');
    writeDetectorFile(dir, 'index.ts'); // excluded from count
    expect(harnessIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('declared count diverges from actual count → error finding', () => {
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
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('not in');
  });

  test('plugin.json absent → info finding (opts out, does not throw)', () => {
    writeDetectorFile(dir, 'a.ts');
    const findings = harnessIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('plugin.json not loaded');
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
    // If index.ts were counted, this would diverge (declared 1 vs actual 2).
    // Silence proves the exclusion.
    expect(harnessIntegrity.run({cwd: dir})).toEqual([]);
  });
});
