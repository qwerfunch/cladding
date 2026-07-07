// Cladding · SessionStart guidance tail (F-fb9b48a5)
//
// Derives expectations from the 4 ACs of session-start-guidance-fb9b48a5:
//   AC-b08371b3  one context-capability line (F-f46d5c61 AC-2c63b999 superseded the
//                original "name both tools" wording — the line now advertises the
//                capability in plain English with NO MCP tool name)
//   AC-14f7778c  ≤2 verbatim prefer lines from project.ai_hints.preferred_patterns, ≤140 chars
//   AC-20893cbc  ≤9 lines at any feature count, canonical ordering
//   AC-5303e049  absent/malformed ai_hints → context line only, no prefer lines, no throw
//
// Drives runHookEvent('SessionStart', …) as a function against a throwaway
// fixture dir. SessionStart never spawns the deterministic trio, so unlike
// hook.test.ts no drift/arch/secret stub is needed.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {stringify as stringifyYaml} from 'yaml';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runHookEvent} from '../../src/cli/hook.js';
import {appendEvent, newEvent} from '../../src/events/log.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-hook-guide-'));
});

afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
});

/** Writes a spec.yaml from a plain object (yaml.stringify guarantees valid YAML). */
function writeSpec(doc: unknown): void {
  writeFileSync(join(cwd, 'spec.yaml'), stringifyYaml(doc), 'utf8');
}

/** Seeds a cladding project whose counts + in-progress come from spec/index.yaml (no ai_hints). */
function seedIndexProject(): void {
  writeFileSync(
    join(cwd, 'spec.yaml'),
    ['schema: "0.1"', 'project:', '  name: fixture', ''].join('\n'),
    'utf8',
  );
  mkdirSync(join(cwd, 'spec'), {recursive: true});
  writeFileSync(
    join(cwd, 'spec', 'index.yaml'),
    [
      '# Cladding · Tier C — generated feature index',
      'features:',
      '  F-aaa111: {slug: alpha, status: done, modules: 2}',
      '  F-bbb222: {slug: beta, status: in_progress, modules: 1}',
      '',
    ].join('\n'),
    'utf8',
  );
}

/** Appends a gate_run event so the `last gate:` line renders. */
function seedGate(): void {
  appendEvent(
    cwd,
    newEvent('gate_run', {tier: 'pre-push', strict: true, worst: 0, anyFailed: false, head: 'abcdef1234567890'}),
  );
}

/** Writes a persisted stop-block so the `unresolved stop-block:` line renders. */
function seedStopBlock(): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  writeFileSync(
    join(cwd, '.cladding', 'stop-block.json'),
    JSON.stringify({fingerprint: 'f'.repeat(64), count: 2, first: 'AC_DRIFT'}),
    'utf8',
  );
}

describe('AC-b08371b3 — context-capability line (F-f46d5c61: no MCP tool names)', () => {
  test('exactly one context line, after gate/stop-block, before policy, naming NO MCP tool', () => {
    seedIndexProject();
    seedGate();
    seedStopBlock();

    const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
    const ctxLines = lines.filter((l) => l.startsWith('context:'));
    expect(ctxLines).toHaveLength(1); // exactly one context line
    const ctx = ctxLines[0];
    expect(ctx).not.toMatch(/clad_[a-z_]+/); // capability phrasing — no internal MCP tool name

    const idxGate = lines.findIndex((l) => l.startsWith('last gate:'));
    const idxStop = lines.findIndex((l) => l.startsWith('unresolved stop-block:'));
    const idxCtx = lines.indexOf(ctx);
    const idxPolicy = lines.findIndex((l) => l.startsWith('policy:'));
    expect(idxGate).toBeGreaterThanOrEqual(0);
    expect(idxStop).toBeGreaterThanOrEqual(0);
    expect(idxPolicy).toBeGreaterThanOrEqual(0);
    expect(idxCtx).toBeGreaterThan(idxGate); // after gate
    expect(idxCtx).toBeGreaterThan(idxStop); // after stop-block
    expect(idxCtx).toBeLessThan(idxPolicy); // before policy
  });
});

describe('AC-14f7778c — prefer lines from preferred_patterns', () => {
  test('three {when,prefer,over} entries → exactly two prefer lines, each ≤140, values verbatim', () => {
    writeSpec({
      schema: '0.1',
      project: {
        name: 'fixture',
        ai_hints: {
          preferred_patterns: [
            {when: 'error handling', prefer: 'RESULT_TYPE', over: 'THROWING'},
            {when: 'async flow', prefer: 'ASYNC_AWAIT', over: 'CALLBACKS'},
            {when: 'third cond', prefer: 'THIRD_PREFER', over: 'THIRD_OVER'},
          ],
        },
      },
    });

    const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
    const preferLines = lines.filter((l) => l.startsWith('prefer:'));
    expect(preferLines).toHaveLength(2); // capped at 2 (third entry dropped)
    for (const l of preferLines) expect(l.length).toBeLessThanOrEqual(140);

    const joined = preferLines.join('\n');
    // prefer/over/when values are verbatim substrings — no paraphrase (first two entries)
    for (const v of ['RESULT_TYPE', 'THROWING', 'error handling', 'ASYNC_AWAIT', 'CALLBACKS', 'async flow']) {
      expect(joined).toContain(v);
    }
    expect(joined).not.toContain('THIRD_PREFER'); // the third entry is beyond the cap
  });

  test('a 200-char prefer value → single truncated prefer line ≤140 ending in an ellipsis', () => {
    writeSpec({
      schema: '0.1',
      project: {
        name: 'fixture',
        ai_hints: {preferred_patterns: [{when: 'w', prefer: 'P'.repeat(200), over: 'o'}]},
      },
    });

    const preferLines = runHookEvent('SessionStart', {}, cwd)
      .split('\n')
      .filter((l) => l.startsWith('prefer:'));
    expect(preferLines).toHaveLength(1);
    expect(preferLines[0].length).toBeLessThanOrEqual(140); // truncated to 140
    expect(preferLines[0].endsWith('…')).toBe(true); // ellipsis marks the cut
  });
});

describe('AC-20893cbc — ≤9 lines and canonical ordering', () => {
  test('full card ≤9 lines, ordered counts→in-progress→gate→stop-block→tools→prefer→policy', () => {
    writeSpec({
      schema: '0.1',
      project: {
        name: 'fixture',
        ai_hints: {
          preferred_patterns: [
            {when: 'w1', prefer: 'PREF1', over: 'OVER1'},
            {when: 'w2', prefer: 'PREF2', over: 'OVER2'},
          ],
        },
      },
      features: [
        {id: 'F-wip111', slug: 'wip-one', status: 'in_progress'},
        {id: 'F-wip222', slug: 'wip-two', status: 'in_progress'},
        {id: 'F-done33', slug: 'done-one', status: 'done'},
      ],
      scenarios: [{id: 'S-1'}],
    });
    seedGate();
    seedStopBlock();

    const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
    expect(lines.length).toBeLessThanOrEqual(9);

    const i = {
      counts: lines.findIndex((l) => l.startsWith('cladding:')),
      inProg: lines.findIndex((l) => l.startsWith('in progress:')),
      gate: lines.findIndex((l) => l.startsWith('last gate:')),
      stop: lines.findIndex((l) => l.startsWith('unresolved stop-block:')),
      ctx: lines.findIndex((l) => l.startsWith('context:')),
      prefer: lines.findIndex((l) => l.startsWith('prefer:')),
      policy: lines.findIndex((l) => l.startsWith('policy:')),
    };
    for (const v of Object.values(i)) expect(v).toBeGreaterThanOrEqual(0);
    expect(i.counts).toBeLessThan(i.inProg);
    expect(i.inProg).toBeLessThan(i.gate);
    expect(i.gate).toBeLessThan(i.stop);
    expect(i.stop).toBeLessThan(i.ctx);
    expect(i.ctx).toBeLessThan(i.prefer);
    expect(i.prefer).toBeLessThan(i.policy);
  });

  test('stays ≤9 lines at high feature count — many in-progress collapse to one line', () => {
    writeSpec({
      schema: '0.1',
      project: {
        name: 'fixture',
        ai_hints: {
          preferred_patterns: [
            {when: 'w1', prefer: 'PREF1', over: 'OVER1'},
            {when: 'w2', prefer: 'PREF2', over: 'OVER2'},
          ],
        },
      },
      features: Array.from({length: 50}, (_, n) => ({id: `F-wip${n}`, slug: `wip-${n}`, status: 'in_progress'})),
      scenarios: [],
    });
    seedGate();
    seedStopBlock();

    const lines = runHookEvent('SessionStart', {}, cwd).split('\n');
    expect(lines.length).toBeLessThanOrEqual(9);
    expect(lines.filter((l) => l.startsWith('in progress:'))).toHaveLength(1);
  });
});

describe('AC-5303e049 — absent/malformed ai_hints → context line only, no throw', () => {
  const cases: {readonly name: string; readonly project: unknown}[] = [
    {name: 'ai_hints is a bare string', project: {name: 'x', ai_hints: 'oops'}},
    {name: 'preferred_patterns is a bare string', project: {name: 'x', ai_hints: {preferred_patterns: 'oops'}}},
    {
      name: 'entries missing required fields',
      project: {name: 'x', ai_hints: {preferred_patterns: [{prefer: 'a'}, {when: 'b', over: 'c'}]}},
    },
    {name: 'ai_hints absent entirely', project: {name: 'x'}},
  ];

  for (const c of cases) {
    test(c.name, () => {
      writeSpec({schema: '0.1', project: c.project});
      let out = '';
      expect(() => {
        out = runHookEvent('SessionStart', {}, cwd);
      }).not.toThrow();
      // malformed hints must not collapse the whole card to error-as-silence
      expect(out.length).toBeGreaterThan(0);
      const lines = out.split('\n');
      expect(lines.filter((l) => l.startsWith('context:'))).toHaveLength(1); // context line survives
      expect(lines.filter((l) => l.startsWith('prefer:'))).toHaveLength(0); // no prefer lines
    });
  }
});

describe('spec-less cwd — empty card (unchanged contract)', () => {
  test('no spec.yaml → prints nothing', () => {
    expect(runHookEvent('SessionStart', {}, cwd)).toBe('');
  });
});
