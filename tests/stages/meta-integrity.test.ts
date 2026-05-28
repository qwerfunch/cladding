// Cladding · unit tests for stages/detectors/meta-integrity.ts
//
// Detector under test is the "self-validates the validator" check:
// it confirms `spec/schema.json` declares the three required root keys
// (schema · project · features) and that spec.yaml's `schema` field
// matches the supported version (0.1).
//
// Regression target: refactoring the schema without updating types.ts
// or the runtime version constant would silently break every other
// detector that depends on loadSpec. META_INTEGRITY surfaces that
// breakage at the same gate as everything else.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {metaIntegrity} from '../../src/stages/detectors/meta-integrity.js';

const VALID_SCHEMA = {
  required: ['schema', 'project', 'features'],
  properties: {schema: {}, project: {}, features: {}},
};

const VALID_SPEC =
  'schema: "0.1"\n' +
  'project: {name: x, language: typescript}\n' +
  'features: []\n';

function writeSchema(dir: string, schema: unknown): void {
  mkdirSync(join(dir, 'src', 'spec'), {recursive: true});
  writeFileSync(join(dir, 'src', 'spec', 'schema.json'), JSON.stringify(schema));
}

describe('META_INTEGRITY detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-meta-int-'));
    writeFileSync(join(dir, 'spec.yaml'), VALID_SPEC);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('valid schema.json + matching spec version → no finding', () => {
    writeSchema(dir, VALID_SCHEMA);
    expect(metaIntegrity.run({cwd: dir})).toEqual([]);
  });

  test('schema.json missing a required root key → error finding', () => {
    writeSchema(dir, {
      required: ['schema', 'project'], // 'features' missing
      properties: {schema: {}, project: {}, features: {}},
    });
    const findings = metaIntegrity.run({cwd: dir});
    expect(findings.some((f) => f.severity === 'error' && f.message.includes("'features'"))).toBe(
      true,
    );
  });

  test('schema.json missing a required property declaration → error finding', () => {
    writeSchema(dir, {
      required: ['schema', 'project', 'features'],
      properties: {schema: {}, project: {}}, // features property missing
    });
    const findings = metaIntegrity.run({cwd: dir});
    expect(
      findings.some((f) => f.severity === 'error' && f.message.includes('property')),
    ).toBe(true);
  });

  test('schema.json malformed JSON → single error finding (early return)', () => {
    mkdirSync(join(dir, 'src', 'spec'), {recursive: true});
    writeFileSync(join(dir, 'src', 'spec', 'schema.json'), '{not valid json');
    const findings = metaIntegrity.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('unreadable or invalid JSON');
  });

  test('schema.json absent → silent no-op (external user projects do not ship the schema)', () => {
    // No spec/schema.json written. Pre-0.5.1 behaviour was to emit
    // an ERROR finding here, but that fired on every external user
    // project (the schema lives inside the cladding npm package, not
    // in the user's cwd). META_INTEGRITY is a maintainer self-check
    // — when the schema is absent there's nothing to check, so the
    // detector returns no findings rather than a false positive.
    const findings = metaIntegrity.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('spec.yaml schema version unsupported → error finding', () => {
    writeSchema(dir, VALID_SCHEMA);
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "9.9"\nproject: {name: x, language: typescript}\nfeatures: []\n',
    );
    const findings = metaIntegrity.run({cwd: dir});
    expect(
      findings.some((f) => f.severity === 'error' && f.message.includes("schema='9.9'")),
    ).toBe(true);
  });
});
