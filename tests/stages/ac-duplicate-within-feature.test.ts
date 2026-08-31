// Cladding · unit tests for stages/detectors/ac-duplicate-within-feature.ts (F-084)

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {acDuplicateWithinFeature} from '../../src/stages/detectors/ac-duplicate-within-feature.js';

function writeMaster(dir: string): void {
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\n');
}

function writeFeature(
  dir: string,
  fileName: string,
  args: {id: string; acIds: readonly string[]},
): void {
  mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
  const acBlock = args.acIds.length
    ? 'acceptance_criteria:\n' +
      args.acIds
        .map((acId) => `  - id: ${acId}\n    ears: ubiquitous\n    text: ${JSON.stringify(acId)}`)
        .join('\n')
    : 'acceptance_criteria: []';
  const lines = [
    `id: ${args.id}`,
    `title: ${JSON.stringify(args.id)}`,
    'status: planned',
    'modules: []',
    acBlock,
  ];
  writeFileSync(join(dir, 'spec', 'features', fileName), lines.join('\n') + '\n');
}

describe('AC_DUPLICATE_WITHIN_FEATURE detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-ac-dup-'));
    writeMaster(dir);
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('all unique AC ids within each feature → no findings', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001', acIds: ['AC-001', 'AC-002']});
    writeFeature(dir, 'F-002.yaml', {id: 'F-002', acIds: ['AC-001', 'AC-003']});
    expect(acDuplicateWithinFeature.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-67e33f/AC-006] two features sharing the same AC-001 → NOT a finding (feature-scope is the new model)', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001', acIds: ['AC-001']});
    writeFeature(dir, 'F-002.yaml', {id: 'F-002', acIds: ['AC-001']});
    // v0.3.9 says AC ids are feature-scoped; F-001.AC-001 and
    // F-002.AC-001 are distinct composite ids. No finding.
    expect(acDuplicateWithinFeature.run({cwd: dir})).toEqual([]);
  });

  test('[covers:F-67e33f/AC-006] one feature duplicating AC-001 → error finding', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001', acIds: ['AC-001', 'AC-001', 'AC-002']});
    const findings = acDuplicateWithinFeature.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('F-001.AC-001');
    expect(findings[0].message).toContain('2 times');
  });

  test('one feature duplicating an AC three times → count 3', () => {
    writeFeature(dir, 'F-007.yaml', {id: 'F-007', acIds: ['AC-005', 'AC-005', 'AC-005']});
    const findings = acDuplicateWithinFeature.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('F-007.AC-005');
    expect(findings[0].message).toContain('3 times');
  });

  test('feature with no acceptance_criteria → no findings', () => {
    writeFeature(dir, 'F-001.yaml', {id: 'F-001', acIds: []});
    expect(acDuplicateWithinFeature.run({cwd: dir})).toEqual([]);
  });

  test('spec absent → no findings', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'clad-ac-dup-empty-'));
    try {
      expect(acDuplicateWithinFeature.run({cwd: emptyDir})).toEqual([]);
    } finally {
      rmSync(emptyDir, {recursive: true, force: true});
    }
  });
});
