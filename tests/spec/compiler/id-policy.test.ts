// Cladding · Spec 0.2 F1 · executable ID policy contract tests.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

import {
  assertNewShardFilename,
  idPolicySchemaIssues,
  isNewId,
  isReadableId,
  isReadableShardFilename,
  newIdFromDigest,
  readableIdPattern,
  readableIdPatternSource,
} from '../../../src/spec/compiler/id-policy.js';
import {extractScenarios} from '../../../src/cli/scan/intent-onboarding.js';

describe('Spec 0.2 ID policy', () => {
  test('[covers:F-182eaa53/AC-34749728] keeps sequential and six-or-more-hex records readable while writers emit exactly eight lowercase hex', () => {
    expect(isReadableId('feature', 'F-001')).toBe(true);
    expect(isReadableId('feature', 'F-a1b2c3')).toBe(true);
    expect(isReadableId('criterion', 'AC-a1b2c3d4e5')).toBe(true);
    expect(isReadableId('scenario', 'S-A1B2C3')).toBe(false);
    expect(isReadableId('feature', 'F-a1b2c')).toBe(false);
    const identifier = newIdFromDigest('feature', 'ABCDEF1200000000');
    expect(identifier).toBe('F-abcdef12');
    expect(isNewId('feature', identifier)).toBe(true);
    expect(isNewId('feature', 'F-abcdef')).toBe(false);
    expect(isNewId('feature', 'F-ABCDEF12')).toBe(false);
    expect(readableIdPatternSource('feature')).toContain('\\d{3,}');
    expect(readableIdPattern('feature').test('F-001')).toBe(true);
  });

  test('treats the shard suffix as a generated-id checksum', () => {
    expect(() => assertNewShardFilename('feature', 'login-flow-abcdef12.yaml', 'F-abcdef12')).not.toThrow();
    expect(() => assertNewShardFilename('scenario', 'checkout-abcdef12.yml', 'S-abcdef12')).not.toThrow();
    expect(() => assertNewShardFilename('feature', 'login-flow-abcdef13.yaml', 'F-abcdef12')).toThrow(/checksum/);
    expect(() => assertNewShardFilename('feature', 'F-001.yaml', 'F-001')).toThrow(/eight-hex/);
  });

  test('reads safe current and legacy shard names while rejecting traversal', () => {
    expect(isReadableShardFilename('scenario', 'spec/scenarios/checkout-abcdef12.yaml')).toBe(true);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/checkout-a1b2c3.yaml')).toBe(true);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/S-001.yaml')).toBe(true);
    expect(isReadableShardFilename('feature', 'spec/features/login-flow-abcdef12.yaml')).toBe(true);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/../features/login-abcdef12.yaml')).toBe(false);
    expect(isReadableShardFilename('scenario', 'spec/scenarios\\checkout-abcdef12.yaml')).toBe(false);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/checkout-abc12.yaml')).toBe(false);
  });

  test('keeps sequential shard names direct while treating slugged suffixes as hashes', () => {
    expect(isReadableShardFilename('scenario', 'spec/scenarios/S-001.yaml')).toBe(true);
    expect(isReadableShardFilename('feature', 'spec/features/F-001.yaml')).toBe(true);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/checkout-001.yaml')).toBe(false);
    expect(isReadableShardFilename('feature', 'spec/features/login-flow-001.yaml')).toBe(false);
    expect(isReadableShardFilename('scenario', 'spec/scenarios/checkout-000001.yaml')).toBe(true);
  });

  test('checks the static JSON Schema mirror against the policy registry', () => {
    const schema = JSON.parse(readFileSync(join(process.cwd(), 'src', 'spec', 'schema.json'), 'utf8')) as unknown;
    expect(idPolicySchemaIssues(schema)).toEqual([]);
  });

  test('uses eight-hex deterministic onboarding scenario identifiers', () => {
    const scenarios = extractScenarios('- slug: account-recovery\n  title: Account recovery\n  flow: Recover access.\n');
    expect(scenarios).toHaveLength(1);
    expect(scenarios[0].id).toMatch(/^S-[a-f0-9]{8}$/);
    expect(extractScenarios('- slug: account-recovery\n  title: Account recovery\n  flow: Recover access.\n')[0].id).toBe(scenarios[0].id);
  });
});
