// Cladding · unit tests for stages/detectors/deliverable-integrity.ts
//
// Pure, no-exec companion to stage_2.4. Pins: declared-but-missing path → error
// (blocking); done features ship modules but no deliverable declared → warn
// (advisory nudge, so silencing the smoke leaves an auditable signal); clean
// otherwise.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  DEFAULT_MIN_FEATURES_FOR_DELIVERABLE,
  deliverableIntegrity,
} from '../../../src/stages/detectors/deliverable-integrity.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-deliv-integ-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeSpec(opts: {
  deliverable?: string;
  done?: boolean;
  modules?: boolean;
  featureCount?: number;
  onboardingSeeded?: boolean;
} = {}): void {
  const done = opts.done ?? true;
  const deliverable = opts.deliverable ?? '';
  const modules = (opts.modules ?? true) ? '    modules: [src/x.ts]\n' : '';
  const featureCount = opts.featureCount ?? 1;
  const features = Array.from({length: featureCount}, (_, index) =>
    `  - id: F-${String(index + 1).padStart(3, '0')}\n` +
      `    title: f${index + 1}\n` +
      `    status: ${done ? 'done' : 'planned'}\n` +
      modules +
      `    acceptance_criteria:\n      - id: AC-${String(index + 1).padStart(3, '0')}\n` +
      '        ears: ubiquitous\n        text: t\n',
  ).join('');
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: t\n  language: typescript\n' +
      `  onboarding_seeded: ${opts.onboardingSeeded ?? false}\n${deliverable}` +
      `features:\n${features}`,
  );
}
function run(): readonly {detector: string; severity: string; message: string}[] {
  return deliverableIntegrity.run({cwd: dir}).filter((f) => f.detector === 'DELIVERABLE_INTEGRITY');
}

describe('DELIVERABLE_INTEGRITY detector', () => {
  test('INFO when an early project ships modules before declaring a deliverable', () => {
    writeSpec({onboardingSeeded: true});
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toMatch(/ship modules but project.deliverable is not declared/);
  });

  test('WARN once a grown project still ships modules without a deliverable decision', () => {
    writeSpec({featureCount: DEFAULT_MIN_FEATURES_FOR_DELIVERABLE, onboardingSeeded: true});
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toMatch(/ship modules but project.deliverable is not declared/);
  });

  test('WARN for a legacy early project without an onboarding marker', () => {
    writeSpec();
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
  });

  test('ERROR when deliverable.path is declared but missing on disk', () => {
    writeSpec({deliverable: '  deliverable:\n    path: ./run\n'}); // no ./run written
    const findings = run();
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/declared but does not exist/);
  });

  test('CLEAN when deliverable is declared and the path exists', () => {
    writeSpec({deliverable: '  deliverable:\n    path: ./run\n'});
    writeFileSync(join(dir, 'run'), '#!/bin/sh\nexit 0\n');
    expect(run()).toHaveLength(0);
  });

  test('CLEAN (no warn) on a fresh project with no done features', () => {
    writeSpec({done: false});
    expect(run()).toHaveLength(0);
  });
});
