// Cladding · unit tests · ui/softShell.ts

import {describe, expect, test} from 'vitest';

import {featureLabel, gateLabel, haltMessage} from '../../src/ui/softShell.js';
import type {HaltReason} from '../../src/drive/halt.js';
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

describe('haltMessage', () => {
  test('maps each halt class to a plain sentence', () => {
    const classes: HaltReason['class'][] = [
      'ALL_FEATURES_DONE',
      'MAX_ITERATIONS',
      'WALL_CLOCK',
      'BUDGET_EXCEEDED',
      'BLOCKED_FEATURE',
      'RETRY_THRESHOLD',
      'GATE_NO_PROGRESS',
      'HUMAN_REQUIRED',
      'LLM_UNAVAILABLE',
      'UNCAUGHT_ERROR',
    ];
    for (const cls of classes) {
      const halt: HaltReason = {class: cls, detail: '', iteration: 0};
      const msg = haltMessage(halt, stubSpec);
      // Each message starts with a capital letter and never contains the raw enum name.
      expect(msg).toMatch(/^[A-Z]/);
      expect(msg).not.toContain(cls);
    }
  });

  test('rewrites feature ids in the detail to titles', () => {
    const halt: HaltReason = {class: 'RETRY_THRESHOLD', detail: 'F-001 retried 3 times', iteration: 7};
    const msg = haltMessage(halt, stubSpec);
    expect(msg).toContain('"Login flow"');
    expect(msg).not.toContain('F-001');
  });

  test('keeps unknown feature ids unchanged in the detail', () => {
    const halt: HaltReason = {class: 'RETRY_THRESHOLD', detail: 'F-999 retried 3 times', iteration: 7};
    const msg = haltMessage(halt, stubSpec);
    expect(msg).toContain('F-999');
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
