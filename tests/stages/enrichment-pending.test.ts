// Cladding · unit tests for src/stages/detectors/enrichment-pending.ts (F-90d054)
//
// Detector #28. Surfaces the `_meta.enrichment_status: "pending"` marker so
// `clad check` warns the user (and `clad check --strict` blocks CI) until
// the host AI has finished enrichment.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {enrichmentPending} from '../../src/stages/detectors/enrichment-pending.js';

const PENDING_BODY = `schema: "0.1"

_meta:
  enrichment_status: pending
  enrichment_scope:
    - project.intent
  detected:
    project_type: greenfield
    source_files: 0
    test_files: 0
    primary_language: unknown
    package_manager: unknown
    has_readme: false
    has_existing_tests: false
    observed_layers: []
    detected_at: "2026-05-22T10:00:00.000Z"

project:
  name: example
  language: typescript

features: []
`;

const COMPLETE_BODY = PENDING_BODY.replace(
  'enrichment_status: pending',
  'enrichment_status: complete',
);

const NO_META_BODY = `schema: "0.1"

project:
  name: example
  language: typescript

features: []
`;

describe('ENRICHMENT_PENDING detector (F-90d054)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-enrichment-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('no spec.yaml → no findings', () => {
    const findings = enrichmentPending.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('spec.yaml without _meta → no findings (post-enrichment / pre-marker)', () => {
    writeFileSync(join(dir, 'spec.yaml'), NO_META_BODY);
    const findings = enrichmentPending.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('enrichment_status: complete → no findings', () => {
    writeFileSync(join(dir, 'spec.yaml'), COMPLETE_BODY);
    const findings = enrichmentPending.run({cwd: dir});
    expect(findings).toEqual([]);
  });

  test('enrichment_status: pending → exactly one warn finding', () => {
    writeFileSync(join(dir, 'spec.yaml'), PENDING_BODY);
    const findings = enrichmentPending.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].detector).toBe('ENRICHMENT_PENDING');
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].path).toBe('spec.yaml');
    expect(findings[0].message).toMatch(/pending/);
    expect(findings[0].message).toMatch(/host AI/);
  });
});
