// Cladding · unit tests for src/init/marker.ts (F-90d054)
//
// Covers AC-011 (marker written) and AC-012 (idempotent re-run preserves
// spec body and only re-activates scope items whose `detected` observations
// changed).

import {describe, expect, test} from 'vitest';

import {
  buildMarker,
  diffScope,
  patchMarkerInSpec,
  readDetectedFromSpec,
  renderMarkerYaml,
  DEFAULT_ENRICHMENT_SCOPE,
} from '../../src/init/marker.js';
import type {DetectedContext} from '../../src/init/detect.js';

const sampleContext: DetectedContext = {
  project_type: 'brownfield',
  source_files: 47,
  test_files: 12,
  primary_language: 'typescript',
  package_manager: 'npm',
  has_readme: true,
  has_existing_tests: true,
  observed_layers: ['src/api', 'src/db', 'src/ui'],
  detected_at: '2026-05-22T10:00:00.000Z',
};

const greenfieldContext: DetectedContext = {
  project_type: 'greenfield',
  source_files: 0,
  test_files: 0,
  primary_language: 'unknown',
  package_manager: 'unknown',
  has_readme: false,
  has_existing_tests: false,
  observed_layers: [],
  detected_at: '2026-05-22T11:00:00.000Z',
};

describe('buildMarker (F-90d054 AC-011)', () => {
  test('defaults enrichment_status to pending', () => {
    const m = buildMarker(sampleContext);
    expect(m.enrichment_status).toBe('pending');
    expect(m.detected).toEqual(sampleContext);
    expect(m.enrichment_scope).toEqual(DEFAULT_ENRICHMENT_SCOPE);
  });

  test('accepts a custom scope subset', () => {
    const m = buildMarker(sampleContext, ['features', 'acceptance_criteria']);
    expect(m.enrichment_scope).toEqual(['features', 'acceptance_criteria']);
  });
});

describe('renderMarkerYaml', () => {
  test('renders as a valid top-level YAML block', () => {
    const yaml = renderMarkerYaml(buildMarker(sampleContext));
    expect(yaml).toMatch(/^_meta:/);
    expect(yaml).toContain('enrichment_status: pending');
    expect(yaml).toContain('project_type: brownfield');
    expect(yaml).toContain('source_files: 47');
    expect(yaml).toContain('- src/api');
    expect(yaml).toContain('detected_at: "2026-05-22T10:00:00.000Z"');
  });

  test('uses inline empty array when observed_layers is empty', () => {
    const yaml = renderMarkerYaml(buildMarker(greenfieldContext));
    expect(yaml).toContain('observed_layers: []');
    expect(yaml).not.toMatch(/observed_layers:\s*\n\s+-/);
  });
});

describe('readDetectedFromSpec', () => {
  test('parses a marker block back into a DetectedContext', () => {
    const body = `schema: "0.1"\n\n${renderMarkerYaml(buildMarker(sampleContext))}\n\nproject:\n  name: x\n`;
    const parsed = readDetectedFromSpec(body);
    expect(parsed).not.toBeNull();
    expect(parsed?.project_type).toBe('brownfield');
    expect(parsed?.source_files).toBe(47);
    expect(parsed?.primary_language).toBe('typescript');
    expect(parsed?.observed_layers).toEqual(['src/api', 'src/db', 'src/ui']);
    expect(parsed?.has_readme).toBe(true);
  });

  test('returns null when no _meta block exists', () => {
    expect(readDetectedFromSpec('schema: "0.1"\nproject:\n  name: x\n')).toBeNull();
  });
});

describe('diffScope', () => {
  test('returns empty when nothing relevant changed', () => {
    expect(diffScope(sampleContext, {...sampleContext, detected_at: 'later'})).toEqual([]);
  });

  test('source_files change re-activates features + conventions', () => {
    const next = {...sampleContext, source_files: 80};
    expect(diffScope(sampleContext, next)).toContain('features');
    expect(diffScope(sampleContext, next)).toContain('docs/conventions.md');
  });

  test('project_type flip re-activates architecture + project-context', () => {
    const r = diffScope(greenfieldContext, sampleContext);
    expect(r).toContain('docs/project-context.md');
    expect(r).toContain('spec/architecture.yaml');
    expect(r).toContain('features');
  });
});

describe('patchMarkerInSpec (F-90d054 AC-012 — idempotent re-run)', () => {
  const initialBody = [
    'schema: "0.1"',
    '',
    renderMarkerYaml(buildMarker(sampleContext)),
    '',
    'project:',
    '  name: example-project',
    '  language: typescript',
    '',
    'features: []',
    '',
  ].join('\n');

  test('returns unchanged when detected has not drifted', () => {
    const result = patchMarkerInSpec(initialBody, sampleContext);
    expect(result.updated).toBe(false);
    expect(result.body).toBe(initialBody);
    expect(result.reactivated).toEqual([]);
  });

  test('returns updated body when source_files change, preserving project body', () => {
    const next = {...sampleContext, source_files: 80, detected_at: 'later'};
    const result = patchMarkerInSpec(initialBody, next);
    expect(result.updated).toBe(true);
    expect(result.reactivated).toContain('features');
    expect(result.reactivated).toContain('docs/conventions.md');
    // Spec body content outside _meta is preserved verbatim.
    expect(result.body).toContain('project:');
    expect(result.body).toContain('  name: example-project');
    expect(result.body).toContain('  language: typescript');
    expect(result.body).toContain('features: []');
    expect(result.body).toContain('source_files: 80');
    expect(result.body).toContain('enrichment_status: pending');
  });

  test('inserts a _meta block when one is missing (post-upgrade scenario)', () => {
    const bodyNoMeta = 'schema: "0.1"\n\nproject:\n  name: x\n  language: ts\n\nfeatures: []\n';
    const result = patchMarkerInSpec(bodyNoMeta, sampleContext);
    expect(result.updated).toBe(true);
    expect(result.body).toContain('_meta:');
    expect(result.body).toContain('enrichment_status: pending');
    expect(result.body).toContain('project:');
    expect(result.body).toContain('features: []');
  });

  test('does not touch project body lines at all when patching', () => {
    const next = {...sampleContext, source_files: 99};
    const result = patchMarkerInSpec(initialBody, next);
    const after = result.body.split('\n');
    // every original `project:` and `features: []` line must reappear unchanged
    expect(after).toContain('project:');
    expect(after).toContain('  name: example-project');
    expect(after).toContain('  language: typescript');
    expect(after).toContain('features: []');
  });
});
