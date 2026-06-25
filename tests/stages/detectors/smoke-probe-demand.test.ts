// F-c' — SMOKE_PROBE_DEMAND: a done feature shipping a runnable deliverable with
// no functional smoke probe is a demand miss (warn), not a silent green. Library/
// static projects (no deliverable) and not-yet-shipped projects raise no demand.

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {smokeProbeDemand} from '../../../src/stages/detectors/smoke-probe-demand.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-smoke-demand-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

function writeSpec(opts: {deliverable?: boolean; smoke?: boolean; done?: boolean}): void {
  const deliverable = opts.deliverable ? '  deliverable:\n    path: ./run\n    is_safe_to_smoke: true\n' : '';
  const smoke = opts.smoke ? '  smoke:\n    - kind: cli\n      run: ["./run"]\n      expect:\n        token: "X"\n' : '';
  writeFileSync(
    join(dir, 'spec.yaml'),
    `schema: "0.1"\nproject:\n  name: t\n  language: typescript\n${deliverable}${smoke}` +
      `features:\n  - id: F-001\n    title: f\n    status: ${opts.done ? 'done' : 'planned'}\n` +
      '    modules: [src/x.ts]\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
  );
}

describe('SMOKE_PROBE_DEMAND (F-c′)', () => {
  test('WARN: a done feature ships a runnable deliverable but no smoke probe', () => {
    writeSpec({deliverable: true, smoke: false, done: true});
    const f = smokeProbeDemand.run({cwd: dir});
    expect(f.length).toBe(1);
    expect(f[0].detector).toBe('SMOKE_PROBE_DEMAND');
    expect(f[0].severity).toBe('warn');
  });

  test('SATISFIED: no demand once a functional smoke probe is declared', () => {
    writeSpec({deliverable: true, smoke: true, done: true});
    expect(smokeProbeDemand.run({cwd: dir}).length).toBe(0);
  });

  test('N/A: no demand when the project has no runnable deliverable (library/static)', () => {
    writeSpec({deliverable: false, smoke: false, done: true});
    expect(smokeProbeDemand.run({cwd: dir}).length).toBe(0);
  });

  test('not-yet-shipped: no demand when nothing is done', () => {
    writeSpec({deliverable: true, smoke: false, done: false});
    expect(smokeProbeDemand.run({cwd: dir}).length).toBe(0);
  });
});
