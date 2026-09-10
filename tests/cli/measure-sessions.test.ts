// Cladding · F-6ba22c5c AC-c070212c + AC-2dff87ef — `clad measure --sessions`.
//
// Drives the real CLI handler (runMeasureCommand) against a temp cwd whose
// .cladding/events.log.jsonl is hand-built, capturing stdout + the exit code.
// Two contracts:
//   AC-c070212c  a ledger WITH events → fired/eligible/firedPct, per-reason
//                histogram, MCP read-serve counts, and a delivery-not-adoption header
//   AC-2dff87ef  a ledger with ZERO value-delivery events → the honest
//                cannot-distinguish (SILENT vs UNWIRED) message, exit 0

import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {appendEvent, newEvent} from '../../src/events/log.js';
import {runMeasureCommand} from '../../src/cli/clad.js';

let dir: string;
let origCwd: string;
let exitCalls: number[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
}

beforeEach(() => {
  origCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'clad-vt-measure-'));
  process.chdir(dir);
  exitCalls = [];
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCalls.push(code ?? 0);
    return undefined as never;
  }) as never);
  stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
});
afterEach(() => {
  process.chdir(origCwd);
  exitSpy.mockRestore();
  stdoutSpy.mockRestore();
  rmSync(dir, {recursive: true, force: true});
});

describe('clad measure --sessions', () => {
  test('[covers:F-6ba22c5c/AC-2dff87ef] zero value-delivery events → honest cannot-distinguish message, exit 0 (AC-2dff87ef)', () => {
    // Only a non-value-delivery event in the ledger → summary.total === 0.
    appendEvent('.', newEvent('gate_run', {tier: 'all'}));
    runMeasureCommand({sessions: true});
    const out = stdout();
    expect(out).toContain('no value-delivery telemetry was recorded');
    expect(out).toContain('SILENT');
    expect(out).toContain('UNWIRED');
    expect(out).toContain('indistinguishable');
    expect(out).not.toContain('0.0% fired'); // absence must never render as 0% value
    expect(exitCalls).toEqual([0]);
  });

  test('absent ledger → same honest message, exit 0 (AC-2dff87ef)', () => {
    runMeasureCommand({sessions: true}); // no events file at all
    expect(stdout()).toContain('no value-delivery telemetry was recorded');
    expect(exitCalls).toEqual([0]);
  });

  test('[covers:F-6ba22c5c/AC-c070212c] a ledger with events → fire rate over eligible + skip histogram + serves + delivery header (AC-c070212c)', () => {
    // 2 fired, skips: 1 owner_miss + 1 trivial_edit (eligible) and an aggregate
    // {not_write_tool:5, unwatched_path:3} (excluded from eligible).
    appendEvent('.', newEvent('impact_card_fired', {file: 'src/a.ts', feature: 'F-1', impacted: 0, tests: 0}));
    appendEvent('.', newEvent('impact_card_fired', {file: 'src/b.ts', feature: 'F-2', impacted: 1, tests: 2}));
    appendEvent('.', newEvent('impact_card_skipped', {reason: 'owner_miss'}));
    appendEvent('.', newEvent('impact_card_skipped', {reason: 'trivial_edit'}));
    appendEvent('.', newEvent('impact_card_skipped', {aggregate: true, counts: {not_write_tool: 5, unwatched_path: 3}}));
    appendEvent('.', newEvent('working_set_served', {tool: 'clad_get_working_set', resolved: true, truncated: true, sliceTokens: 1200}));
    appendEvent('.', newEvent('session_card_rendered', {bytes: 200}));
    appendEvent('.', newEvent('prompt_suggestion_served', {kind: 'completion'}));

    runMeasureCommand({sessions: true});
    const out = stdout();
    // delivery-not-adoption header
    expect(out).toContain('FIRED');
    expect(out).toContain('not whether the agent ADOPTED');
    // fire rate over eligible = fired(2) / (fired 2 + owner_miss 1 + trivial 1 = 4) = 50.0%
    expect(out).toContain('2 fired / 4 eligible edit(s) = 50.0% fired');
    // per-reason histogram + serves + other surfaces
    expect(out).toContain('skips by reason');
    expect(out).toContain('owner_miss');
    expect(out).toContain('not_write_tool');
    expect(out).toContain('MCP serves');
    expect(out).toContain('clad_get_working_set');
    expect(out).toContain('1 session card(s)');
    expect(out).toContain('1 prompt suggestion(s)');
    expect(exitCalls).toEqual([0]);
  });

  test('--sessions --json emits the raw summary shape, exit 0', () => {
    appendEvent('.', newEvent('impact_card_fired', {file: 'src/a.ts', feature: 'F-1'}));
    runMeasureCommand({sessions: true, json: true});
    const doc = JSON.parse(stdout()) as {fired: number; eligible: number; firedPct: number; total: number; byReason: unknown};
    expect(doc.fired).toBe(1);
    expect(doc.total).toBe(1);
    expect(doc.firedPct).toBe(1);
    expect(doc.byReason).toEqual({});
    expect(exitCalls).toEqual([0]);
  });
});
