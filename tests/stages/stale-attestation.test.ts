// Cladding · F-a5228c — STALE_ATTESTATION + the attestation file

import {mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {moduleFileHash, readAttestation, writeAttestation} from '../../src/spec/attestation.js';
import {loadSpec} from '../../src/spec/load.js';
import {staleAttestation} from '../../src/stages/detectors/stale-attestation.js';

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
});
