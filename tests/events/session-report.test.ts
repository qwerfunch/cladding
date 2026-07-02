// Cladding · F-6ba22c5c AC-c070212c — summarizeValueDelivery, the pure reducer
// behind `clad measure --sessions`. Every case is a hand-built event array; the
// reducer is deterministic and does no I/O, so assertions are on arithmetic:
//   - fired vs skipped counts + per-reason histogram
//   - eligible = fired + skips EXCLUDING not_write_tool / unwatched_path
//   - firedPct over eligible; truncationRate over resolved serves; never NaN
//   - aggregate skip events expand into per-reason counts, never eligible
//   - empty input → all zeros, total 0
//   - property: over fired+skip-only corpora, fired + skipped == total

import {describe, expect, test} from 'vitest';

import type {Event} from '../../src/events/log.js';
import {summarizeValueDelivery} from '../../src/events/session-report.js';

let seq = 0;
function ev(type: Event['type'], payload: Record<string, unknown> = {}): Event {
  return {id: `ev-${seq++}`, timestamp: '2026-07-02T00:00:00.000Z', type, payload};
}
function fired(): Event {
  return ev('impact_card_fired', {file: 'src/x.ts', feature: 'F-x', impacted: 0, tests: 0, unledgered: false});
}
function skip(reason: string): Event {
  return ev('impact_card_skipped', {reason});
}
function agg(not_write_tool: number, unwatched_path: number): Event {
  return ev('impact_card_skipped', {aggregate: true, counts: {not_write_tool, unwatched_path}});
}

describe('summarizeValueDelivery — counts + histogram', () => {
  test('fired vs skipped, per-reason histogram, eligible excludes the two aggregated reasons', () => {
    const s = summarizeValueDelivery([
      fired(),
      fired(),
      skip('owner_miss'),
      skip('trivial_edit'),
      skip('debounced'),
      skip('spec_unreadable'),
      skip('not_write_tool'), // per-occurrence form still lands in byReason, but NOT eligible
      skip('unwatched_path'),
    ]);
    expect(s.fired).toBe(2);
    expect(s.skipped).toBe(6);
    expect(s.byReason).toEqual({
      owner_miss: 1,
      trivial_edit: 1,
      debounced: 1,
      spec_unreadable: 1,
      not_write_tool: 1,
      unwatched_path: 1,
    });
    // eligible = fired(2) + substantive skips(owner_miss,trivial,debounced,spec_unreadable = 4) = 6
    expect(s.eligible).toBe(6);
    expect(s.firedPct).toBe(0.333); // round3(2/6)
    expect(s.total).toBe(8);
  });

  test('aggregate skip events expand into per-reason counts and never touch eligible', () => {
    const s = summarizeValueDelivery([fired(), agg(40, 35), agg(3, 0)]);
    expect(s.fired).toBe(1);
    expect(s.byReason).toEqual({not_write_tool: 43, unwatched_path: 35});
    expect(s.skipped).toBe(78); // 43 + 35
    // eligible = fired(1) + 0 substantive skips (both reasons are aggregated) = 1
    expect(s.eligible).toBe(1);
    expect(s.firedPct).toBe(1);
  });

  test('MCP serves: servedByTool grouping + truncationRate over RESOLVED serves only', () => {
    const s = summarizeValueDelivery([
      ev('working_set_served', {tool: 'clad_get_working_set', resolved: true, truncated: true, sliceTokens: 900}),
      ev('working_set_served', {tool: 'clad_get_working_set', resolved: true, truncated: false, sliceTokens: 200}),
      ev('working_set_served', {tool: 'clad_get_context', resolved: false}), // a miss never counts toward truncation
      ev('working_set_served', {tool: 'clad_get_impact', resolved: true, truncated: false}),
    ]);
    expect(s.servedWorkingSets).toBe(4);
    expect(s.servedByTool).toEqual({clad_get_working_set: 2, clad_get_context: 1, clad_get_impact: 1});
    // 1 truncated / 3 resolved
    expect(s.truncationRate).toBe(0.333);
    expect(s.total).toBe(4);
  });

  test('session cards + prompt suggestions are tallied and count toward total', () => {
    const s = summarizeValueDelivery([
      ev('session_card_rendered', {bytes: 120}),
      ev('session_card_rendered', {bytes: 90}),
      ev('prompt_suggestion_served', {kind: 'completion'}),
    ]);
    expect(s.sessionCards).toBe(2);
    expect(s.promptSuggestions).toBe(1);
    expect(s.total).toBe(3);
  });

  test('empty input → all zeros, firedPct + truncationRate are 0 (never NaN)', () => {
    const s = summarizeValueDelivery([]);
    expect(s).toEqual({
      fired: 0,
      skipped: 0,
      byReason: {},
      eligible: 0,
      suppressed: {dedup: 0, ledger_exhausted: 0}, // F-35954d19 — by-design withholdings field
      firedPct: 0,
      servedWorkingSets: 0,
      servedByTool: {},
      truncationRate: 0,
      sessionCards: 0,
      promptSuggestions: 0,
      total: 0,
    });
    expect(Number.isNaN(s.firedPct)).toBe(false);
    expect(Number.isNaN(s.truncationRate)).toBe(false);
  });

  test('non-value-delivery events are ignored (do not inflate total)', () => {
    const s = summarizeValueDelivery([
      ev('gate_run', {tier: 'all'}),
      ev('stage_started', {stage: 's'}),
      fired(),
    ]);
    expect(s.total).toBe(1);
    expect(s.fired).toBe(1);
  });

  test('property: over fired+skip-only corpora, fired + skipped == total', () => {
    const reasons = ['owner_miss', 'trivial_edit', 'debounced', 'spec_unreadable', 'not_write_tool', 'unwatched_path'];
    // deterministic pseudo-random corpora (seeded LCG) so failures reproduce
    let state = 12345;
    const rand = (n: number) => (state = (state * 1103515245 + 12345) & 0x7fffffff) % n;
    for (let trial = 0; trial < 25; trial++) {
      const events: Event[] = [];
      const len = rand(60);
      for (let i = 0; i < len; i++) {
        if (rand(2) === 0) events.push(fired());
        else events.push(skip(reasons[rand(reasons.length)]));
      }
      const s = summarizeValueDelivery(events);
      expect(s.fired + s.skipped).toBe(s.total);
      expect(s.total).toBe(len);
    }
  });
});
