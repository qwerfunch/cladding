import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  detectorCatalogSha256,
  featureAttestation,
  readAttestation,
  writeAttestation,
  type AttestationPolicy,
} from '../../src/spec/attestation.js';
import type {Spec} from '../../src/spec/types.js';

describe('attestation policy stamp', () => {
  let dir: string;
  let spec: Spec;
  const policy: AttestationPolicy = {
    cladding: '0.9.4',
    blocking: 'strict',
    detectorsSha256: 'a'.repeat(64),
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-att-policy-'));
    mkdirSync(join(dir, 'spec'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'src', 'main.ts'), 'export const main = true;\n', 'utf8');
    spec = {
      schema: '0.1',
      project: {name: 'policy-fixture', language: 'typescript'},
      features: [{id: 'F-policy1', title: 'Policy', status: 'done', modules: ['src/main.ts']}],
    };
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('writes and reads the policy stamp deterministically', () => {
    expect(writeAttestation(dir, spec, policy)).toBe(true);
    const path = join(dir, 'spec', 'attestation.yaml');
    const first = readFileSync(path, 'utf8');
    expect(first.indexOf('policy:')).toBeLessThan(first.indexOf('attested_modules:'));
    expect(first).toContain('  cladding: "0.9.4"');
    expect(first).toContain('  blocking: strict');
    expect(first).toContain(`  detectors_sha256: ${'a'.repeat(64)}`);
    expect(readAttestation(dir)?.policy).toEqual(policy);

    writeAttestation(dir, spec, policy);
    expect(readFileSync(path, 'utf8')).toBe(first);
  });

  test('legacy v2 without policy remains readable', () => {
    expect(writeAttestation(dir, spec)).toBe(true);
    const attestation = readAttestation(dir);
    expect(attestation?.policy).toBeNull();
    expect(featureAttestation(attestation!, dir, spec.features[0])).toEqual({state: 'fresh'});
  });

  test('detector catalog fingerprint is deterministic and configuration-sensitive', () => {
    const catalog = [
      {name: 'FIRST'},
      {name: 'SECOND', subprocess: true as const},
    ];
    const baseline = detectorCatalogSha256(catalog);
    expect(baseline).toMatch(/^[0-9a-f]{64}$/);
    expect(detectorCatalogSha256(catalog)).toBe(baseline);
    expect(detectorCatalogSha256([...catalog].reverse())).not.toBe(baseline);
    expect(detectorCatalogSha256([{name: 'RENAMED'}, catalog[1]])).not.toBe(baseline);
    expect(detectorCatalogSha256([{name: 'FIRST', subprocess: true}, catalog[1]])).not.toBe(baseline);
  });
});
