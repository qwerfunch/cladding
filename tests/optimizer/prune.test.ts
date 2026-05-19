// Cladding · unit tests for optimizer/prune.ts

import {describe, expect, test} from 'vitest';

import {pruneToFeature} from '../../src/optimizer/prune.js';
import type {Spec} from '../../src/spec/types.js';

const baseSpec: Spec = {
  schema: '0.1',
  project: {name: 'x', language: 'typescript'},
  features: [
    {id: 'F-001', title: 'a', status: 'done'},
    {id: 'F-002', title: 'b', status: 'done', depends_on: ['F-001']},
    {id: 'F-003', title: 'c', status: 'done', depends_on: ['F-002']},
    {id: 'F-099', title: 'unrelated', status: 'done'},
  ],
  scenarios: [
    {id: 'S-001', title: 's', features: ['F-002', 'F-099']},
  ],
};

describe('pruneToFeature', () => {
  test('keeps the focus feature and its transitive deps', () => {
    const pruned = pruneToFeature(baseSpec, 'F-003');
    const ids = pruned.features.map((f) => f.id).sort();
    expect(ids).toEqual(['F-001', 'F-002', 'F-003']);
  });

  test('drops unrelated features', () => {
    const pruned = pruneToFeature(baseSpec, 'F-003');
    expect(pruned.features.find((f) => f.id === 'F-099')).toBeUndefined();
  });

  test('keeps scenarios that mention any retained feature', () => {
    const pruned = pruneToFeature(baseSpec, 'F-002');
    expect(pruned.scenarios).toHaveLength(1);
    expect(pruned.scenarios?.[0].id).toBe('S-001');
  });

  test('returns input unchanged when featureId is not present', () => {
    const pruned = pruneToFeature(baseSpec, 'F-XXX');
    expect(pruned).toBe(baseSpec);
  });
});
