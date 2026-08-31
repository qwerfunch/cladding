// Cladding · F-a5228c — STALE_ATTESTATION + the attestation file

import {mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {moduleFileHash, readAttestation, writeAttestation} from '../../src/spec/attestation.js';
import {reduceLegacyStageAdapter} from '../../src/assurance/adapters.js';
import {assuranceProfile} from '../../src/assurance/kernel.js';
import {authoritativeFixtureVerdict as fixtureAuthority, mintAuthoritativeFixtureV3} from '../assurance/authoritative-fixture.js';
import {assuranceClosureInputFromWorkspace, featureClosureSeals} from '../../src/assurance/workspace.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';
import {loadSpec} from '../../src/spec/load.js';
import {staleAttestation} from '../../src/stages/detectors/stale-attestation.js';

function authoritativeFixtureVerdict(digest: string, feature: string) {
  return fixtureAuthority(reduceLegacyStageAdapter({
    profile: assuranceProfile('completion', 'L2'), configuredAssuranceLevel: 'L2', completeScope: true,
    scopeAddresses: [`feature:${feature}`], inputAddresses: [`feature:${feature}`], inputSha256: digest,
    hasExecutableTests: false, hasOracleProof: false, hasDeliverable: false, requiresQuality: false, requiresHuman: false,
    environmentClass: 'test',
    stages: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6'].map((stage) => ({stage, status: 'pass' as const})),
  }));
}

describe('attestation (F-a5228c)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-attest-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const v = 1;\n');
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'x-aaaa11.yaml'),
      'id: F-aaaa11\nslug: x\ntitle: t\nstatus: done\nmodules: [src/m.ts]\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n',
    );
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('absent attestation → ONE info finding naming the path to attested state (never blanket RED)', () => {
    const findings = staleAttestation.run({cwd: dir});
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('clad check --tier=pre-push --strict');
  });

  test('a GREEN-stamped attestation matches → silent; editing a module → warn naming the feature', () => {
    expect(writeAttestation(dir, loadSpec(dir))).toBe(true);
    expect(staleAttestation.run({cwd: dir}).length).toBe(0);

    writeFileSync(join(dir, 'src', 'm.ts'), 'export const v = 2; // changed after verification\n');
    const findings = staleAttestation.run({cwd: dir});
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('F-aaaa11');
    expect(findings[0].message).toContain('changed since the last attested verification');
  });

  test('v2 stale detector message names the drifted module (F-b0f898a6 · AC-ec3d293e)', () => {
    expect(writeAttestation(dir, loadSpec(dir))).toBe(true);
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const v = 3; // drifted\n');
    const findings = staleAttestation.run({cwd: dir});
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
    // v2's per-module resolution: the message points at the exact file.
    expect(findings[0].message).toContain('src/m.ts');
    expect(findings[0].message).toContain('F-aaaa11');
  });

  test('a done feature missing from an existing attestation warns (never-attested shipped code)', () => {
    writeAttestation(dir, loadSpec(dir));
    writeFileSync(
      join(dir, 'spec', 'features', 'y-bbbb22.yaml'),
      'id: F-bbbb22\nslug: y\ntitle: t\nstatus: done\nmodules: [src/m.ts]\nacceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n',
    );
    const findings = staleAttestation.run({cwd: dir});
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('F-bbbb22');
    expect(findings[0].message).toContain('no attestation entry');
  });

  test('the file is content-anchored: per-module hash keyed by path + a constant feature marker, hash moves only with that file', () => {
    writeAttestation(dir, loadSpec(dir));
    const att = readAttestation(dir);
    const h1 = att?.modules?.get('src/m.ts');
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(moduleFileHash(dir, 'src/m.ts')).toBe(h1);
    expect(att?.features?.has('F-aaaa11')).toBe(true);
    // unrelated file change does not move the module hash
    writeFileSync(join(dir, 'spec.yaml'), readFileSync(join(dir, 'spec.yaml'), 'utf8') + '# comment\n');
    expect(moduleFileHash(dir, 'src/m.ts')).toBe(h1);
  });

  test('no done features with modules → no attestation written, no findings', () => {
    rmSync(join(dir, 'spec', 'features', 'x-aaaa11.yaml'));
    expect(writeAttestation(dir, loadSpec(dir))).toBe(false);
    expect(existsSync(join(dir, 'spec', 'attestation.yaml'))).toBe(false);
    expect(staleAttestation.run({cwd: dir}).length).toBe(0);
  });

  test('a current schema 0.2 v3 closure seal takes precedence over legacy module rows', () => {
    rmSync(join(dir, 'spec', 'features', 'x-aaaa11.yaml'));
    mkdirSync(join(dir, 'tests'));
    writeFileSync(join(dir, 'tests', 'x.test.ts'), 'test(\"[covers:F-aaaaaaaa/AC-aaaaaaaa] bound\", () => {});\n');
    writeFileSync(join(dir, 'spec.yaml'), [
      'schema: "0.2"', 'project:', '  name: x', '  language: typescript', '  purpose: Keep verification seals current.',
      '  assurance_level: L2', '  scenario_policy: advisory', '',
    ].join('\n'));
    writeFileSync(join(dir, 'spec', 'features', 'x-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'title: X', 'status: done', 'purpose: Preserve current closure seals.', 'modules: [src/m.ts]',
      'depends_on: []', 'capability_refs: []', 'acceptance_criteria:',
      '  - id: AC-aaaaaaaa', '    kind: behavior', '    statement: The system shall preserve current closure seals.', '',
    ].join('\n'));
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
    const compilation = compileSpecWorkspace(dir);
    const seals = featureClosureSeals(assuranceClosureInputFromWorkspace(dir, compilation), 'F-aaaaaaaa');
    expect(seals.complete).toBe(true);
    const digest = 'a'.repeat(64);
    const v3 = mintAuthoritativeFixtureV3({
      verdict: authoritativeFixtureVerdict(digest, 'F-aaaaaaaa'),
      feature: 'F-aaaaaaaa', ...seals, detectorCatalogSha256: digest, registrySha256: digest,
      toolIdentity: 'cladding-test', environmentClass: 'test', trustSnapshotSha256: digest,
    });
    if (!v3) throw new Error('v3 fixture seal was not created');
    expect(writeAttestation(dir, loadSpec(dir), undefined, [v3], undefined, {writeLegacy: false})).toBe(true);
    expect(staleAttestation.run({cwd: dir})).toEqual([]);
    // The v3 reader must observe proof bytes outside feature.modules, not
    // merely fall back to the legacy module map.
    writeFileSync(join(dir, 'tests', 'x.test.ts'), 'test("[covers:F-aaaaaaaa/AC-aaaaaaaa] changed", () => {});\n');
    expect(staleAttestation.run({cwd: dir})[0]?.message).toContain('F-aaaaaaaa');
  });
});
