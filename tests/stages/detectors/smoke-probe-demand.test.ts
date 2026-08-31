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
  test("[covers:F-7076f7/AC-111865] WARN: a done feature ships a runnable deliverable but no smoke probe", () => {
    writeSpec({deliverable: true, smoke: false, done: true});
    const f = smokeProbeDemand.run({cwd: dir});
    expect(f.length).toBe(1);
    expect(f[0].detector).toBe('SMOKE_PROBE_DEMAND');
    expect(f[0].severity).toBe('warn');
  });

  test("[covers:F-7076f7/AC-5abfc0] SATISFIED: no demand once a functional smoke probe is declared", () => {
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

// F-4ef09f38 AC-4 (AC-5e95db0b) — a probe.feature that resolves to no feature in
// the spec is annotation drift: SMOKE_PROBE_DEMAND warns, naming the probe argv +
// the dangling id. A valid binding raises no such warn.
describe('SMOKE_PROBE_DEMAND · dangling feature binding (F-4ef09f38 AC-4)', () => {
  /** Write a spec whose single cli probe binds `bound`, plus one done feature F-aaaaaa. */
  function writeBoundSpec(bound: string): void {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject:\n  name: t\n  language: typescript\n' +
        `  smoke:\n    - kind: cli\n      run: ["./run"]\n      feature: ${bound}\n` +
        'features:\n  - id: F-aaaaaa\n    title: f\n    status: done\n',
    );
  }
  const isDangling = (m: string): boolean => m.includes('dangling');

  test("[covers:F-4ef09f38/AC-5e95db0b] WARN naming the probe argv and the dangling id when the binding resolves to no feature", () => {
    writeBoundSpec('F-dddddd'); // not present in features
    const findings = smokeProbeDemand.run({cwd: dir});
    const dangling = findings.filter((f) => isDangling(f.message));
    expect(dangling).toHaveLength(1);
    expect(dangling[0].detector).toBe('SMOKE_PROBE_DEMAND');
    expect(dangling[0].severity).toBe('warn');
    expect(dangling[0].message).toContain('./run'); // names the probe argv
    expect(dangling[0].message).toContain('F-dddddd'); // names the dangling id
  });

  test('no dangling warn when the binding resolves to a real feature', () => {
    writeBoundSpec('F-aaaaaa'); // present in features
    const findings = smokeProbeDemand.run({cwd: dir});
    expect(findings.filter((f) => isDangling(f.message))).toHaveLength(0);
  });
});
