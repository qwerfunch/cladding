// Cladding · unit tests · ui/softShell.ts

import {describe, expect, test} from 'vitest';

import {featureLabel, gateLabel} from '../../src/ui/softShell.js';
import type {Spec} from '../../src/spec/types.js';

const stubSpec: Spec = {
  schema: '0.1',
  project: {
    name: 'test',
    language: 'typescript',
  },
  features: [
    {
      id: 'F-001',
      title: 'Login flow',
      status: 'done',
      modules: [],
    },
    {
      id: 'F-002',
      title: '', // intentionally empty — exercise fallback
      status: 'planned',
      modules: [],
    },
  ],
};

describe('featureLabel', () => {
  test('returns the business title when found', () => {
    expect(featureLabel('F-001', stubSpec)).toBe('Login flow');
  });

  test('falls back to the raw id when title is missing', () => {
    expect(featureLabel('F-002', stubSpec)).toBe('F-002');
  });

  test('falls back to the raw id when the feature is not in the spec', () => {
    expect(featureLabel('F-999', stubSpec)).toBe('F-999');
  });
});

describe('gateLabel', () => {
  test('translates known stage ids', () => {
    expect(gateLabel('stage_1.3')).toBe('Drift');
    expect(gateLabel('stage_4.2')).toBe('UAT');
  });

  test('falls back to the raw id for unknown stages', () => {
    expect(gateLabel('stage_9.9')).toBe('stage_9.9');
  });
});
