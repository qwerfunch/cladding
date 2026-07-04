// Cladding · F-0023ba22 — summarizeAdoption, the pull-vs-push B1 adoption verdict.
//
// These tests encode the four acceptance criteria of adoption-reducer-0023ba22,
// NOT the reducer's internals: every assertion is on the public AdoptionSummary
// contract + the exported B1_ADOPTION_THRESHOLDS. Fixtures are hand-built event
// arrays with explicit timestamps so completed-cycle windows, pull placement,
// distinct heads and the cycle-pull rate are all controllable to the unit.
//
//   AC-3362d108 — only resolved working_set_served are pulls (grouped by tool);
//                 push surfaces (impact/session/prompt) never raise a number or verdict.
//   AC-b200151f — the verdict clears exactly the four B1_ADOPTION_THRESHOLDS;
//                 a single call or a push-only ledger can never confirm.
//   AC-0d7273dd — cycles with no value-delivery still yield a computable
//                 not_confirmed with hasSignal true (never insufficient_data at ≥3 cycles).
//   AC-345af0b5 — reads both log generations, deterministic, insufficient_data +
//                 hasSignal false on an empty or pre-0.8 ledger.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import type {Event} from '../../src/events/log.js';
import {readEventsIncludingRolled} from '../../src/events/log.js';
import {B1_ADOPTION_THRESHOLDS, summarizeAdoption} from '../../src/events/session-report.js';

// --- fixture builders ------------------------------------------------------
// Cycles live in disjoint 10s slots; each cycle's [feature_created .. done]
// window is 5s wide, so a pull placed inside a slot falls in exactly that one
// cycle's window and no other.

const BASE = Date.parse('2026-07-04T00:00:00.000Z');
const SLOT_MS = 10_000;
const WINDOW_MS = 5_000;

let uid = 0;
function at(ms: number, type: Event['type'], payload: Record<string, unknown>): Event {
  return {id: `ev-${uid++}`, timestamp: new Date(ms).toISOString(), type, payload};
}

interface CycleSpec {
  slot: number;
  feature: string;
  doneHead: string;
  kept?: boolean;
  /** Resolved pull serves placed inside the cycle window. */
  pulls?: {tool?: string; head?: string}[];
}

/** feature_created → (resolved pulls) → done_attempted for one cycle. */
function cycle(spec: CycleSpec): Event[] {
  const start = BASE + spec.slot * SLOT_MS;
  const end = start + WINDOW_MS;
  const kept = spec.kept ?? true;
  const events: Event[] = [at(start, 'feature_created', {feature: spec.feature, slug: spec.feature.toLowerCase()})];
  (spec.pulls ?? []).forEach((pull, k) => {
    const payload: Record<string, unknown> = {tool: pull.tool ?? 'clad_get_working_set', query: spec.feature, resolved: true};
    if (pull.head) payload.head = pull.head;
    events.push(at(start + 1000 + k * 100, 'working_set_served', payload));
  });
  events.push(at(end, 'done_attempted', {feature: spec.feature, worst: kept ? 0 : 3, anyFailed: !kept, kept, head: spec.doneHead}));
  return events;
}

const p1 = [{head: 'head-1'}];
/** 4 kept cycles · 3 resolved pulls each (12 ≥ 10) · every cycle pulled (rate 1.0) · 4 distinct heads. */
function confirmedFixture(): Event[] {
  return [
    ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
    ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
    ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3', pulls: [{head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}]}),
    ...cycle({slot: 3, feature: 'F-4', doneHead: 'head-4', pulls: [{head: 'head-4'}, {head: 'head-4'}, {head: 'head-4'}]}),
  ];
}

// --- AC-3362d108 — pull vs push -------------------------------------------

describe('summarizeAdoption — AC-3362d108 pull vs push', () => {
  test('push-only ledger (heavy impact_card_fired, distinct heads, zero pulls) → pullsTotal 0, empty pullsByTool, never confirmed', () => {
    const events: Event[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(at(BASE + i * 100, 'impact_card_fired', {file: 'src/x.ts', feature: 'F-x', impacted: 1, tests: 0, head: `push-head-${i}`}));
    }
    const s = summarizeAdoption(events);
    expect(s.pullsTotal).toBe(0);
    expect(s.pullsByTool).toEqual({});
    expect(s.distinctHeads).toBe(0); // 12 distinct PUSH heads must not leak into the adoption head set
    expect(s.hasSignal).toBe(true); // push is still delivery signal…
    expect(s.verdict).not.toBe('confirmed'); // …but delivery can never masquerade as adoption
    expect(s.verdict).toBe('insufficient_data'); // no completed cycles to judge
  });

  test('push events never raise any adoption number or the verdict — adding push traffic leaves the summary identical', () => {
    const base = confirmedFixture();
    const withPush: Event[] = [
      ...base,
      at(BASE + 50, 'impact_card_fired', {file: 'a.ts', feature: 'F-1', head: 'phantom-1'}),
      at(BASE + 60, 'impact_card_skipped', {reason: 'owner_miss', head: 'phantom-2'}),
      at(BASE + 70, 'session_card_rendered', {bytes: 100, head: 'phantom-3'}),
      at(BASE + 80, 'prompt_suggestion_served', {kind: 'completion', head: 'phantom-4'}),
    ];
    // Same pulls, cycles, heads, rate, reasons and verdict: push is inert to adoption.
    expect(summarizeAdoption(withPush)).toEqual(summarizeAdoption(base));
    expect(summarizeAdoption(withPush).verdict).toBe('confirmed');
  });

  test('only resolved working_set_served count as pulls (grouped by tool); resolved:false serves do not', () => {
    const events = [
      at(BASE, 'working_set_served', {tool: 'clad_get_working_set', query: 'q', resolved: true, head: 'h1'}),
      at(BASE + 10, 'working_set_served', {tool: 'clad_get_working_set', query: 'q', resolved: false, head: 'h2'}),
      at(BASE + 20, 'working_set_served', {tool: 'clad_get_context', query: 'q', resolved: false, head: 'h3'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.pullsTotal).toBe(1);
    expect(s.pullsByTool).toEqual({clad_get_working_set: 1});
    expect(s.distinctHeads).toBe(1); // only the resolved serve's head counts
    expect(s.hasSignal).toBe(true); // an unresolved serve is still signal
  });
});

// --- AC-b200151f — thresholds / anti-vacuous confirmation -------------------

describe('summarizeAdoption — AC-b200151f thresholds / anti-vacuous', () => {
  test('B1_ADOPTION_THRESHOLDS exports the documented B1 values', () => {
    expect(B1_ADOPTION_THRESHOLDS).toEqual({
      minCompletedCycles: 3,
      minPulls: 10,
      minCyclePullRate: 0.6,
      minDistinctHeads: 3,
    });
  });

  test('a fully-satisfying ledger is confirmed with empty reasons', () => {
    const s = summarizeAdoption(confirmedFixture());
    expect(s.verdict).toBe('confirmed');
    expect(s.reasons).toEqual([]);
    expect(s.completedCycles).toBe(4);
    expect(s.pullsTotal).toBe(12);
    expect(s.cyclePullRate).toBe(1);
    expect(s.distinctHeads).toBe(4);
  });

  test('below minCompletedCycles (2 cycles, other gates cleared) → insufficient_data, reason insufficient_cycles only', () => {
    // 10 pulls + 3 distinct heads keep every other gate satisfied, isolating the cycle gate.
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-3'}]}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(2);
    expect(s.pullsTotal).toBe(10); // pulls gate cleared
    expect(s.distinctHeads).toBe(3); // heads gate cleared (head-1, head-2, head-3)
    expect(s.cyclePullRate).toBe(1); // rate gate cleared
    expect(s.reasons).toEqual(['insufficient_cycles']);
    expect(s.verdict).toBe('insufficient_data');
  });

  test('below minPulls (9 resolved pulls, other gates cleared) → not_confirmed, reason insufficient_pulls only', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3', pulls: [{head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}]}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(3);
    expect(s.pullsTotal).toBe(9); // one short of minPulls
    expect(s.distinctHeads).toBe(3);
    expect(s.cyclePullRate).toBe(1);
    expect(s.reasons).toEqual(['insufficient_pulls']);
    expect(s.verdict).toBe('not_confirmed');
  });

  test('below minCyclePullRate (5 cycles, pulls in only 2 → rate 0.4) → not_confirmed, reason low_cycle_pull_rate only', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3'}),
      ...cycle({slot: 3, feature: 'F-4', doneHead: 'head-4'}),
      ...cycle({slot: 4, feature: 'F-5', doneHead: 'head-5'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(5);
    expect(s.pullsTotal).toBe(10); // pulls gate cleared
    expect(s.distinctHeads).toBe(5); // heads gate cleared
    expect(s.cyclesWithPull).toBe(2);
    expect(s.cyclePullRate).toBe(0.4); // below minCyclePullRate
    expect(s.reasons).toEqual(['low_cycle_pull_rate']);
    expect(s.verdict).toBe('not_confirmed');
  });

  test('below minDistinctHeads (only 2 distinct heads, other gates cleared) → not_confirmed, reason insufficient_distinct_heads only', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-2', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(3);
    expect(s.pullsTotal).toBe(12); // pulls gate cleared
    expect(s.cyclePullRate).toBe(1); // rate gate cleared
    expect(s.distinctHeads).toBe(2); // only head-1 + head-2 exist
    expect(s.reasons).toEqual(['insufficient_distinct_heads']);
    expect(s.verdict).toBe('not_confirmed');
  });

  test('a single accidental pull with cycles otherwise complete → not_confirmed', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: p1}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2'}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(3); // cycle gate cleared
    expect(s.distinctHeads).toBe(3); // head gate cleared
    expect(s.pullsTotal).toBe(1); // the lone accidental call
    expect(s.verdict).toBe('not_confirmed');
    expect(s.reasons).toContain('insufficient_pulls');
  });

  test('exactly 3 of 5 cycles with pulls (rate 0.6) clears the rate gate → confirmed', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3', pulls: [{head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}]}),
      ...cycle({slot: 3, feature: 'F-4', doneHead: 'head-4'}),
      ...cycle({slot: 4, feature: 'F-5', doneHead: 'head-5'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(5);
    expect(s.cyclesWithPull).toBe(3);
    expect(s.cyclePullRate).toBe(0.6); // exactly the threshold — not below it
    expect(s.pullsTotal).toBe(12);
    expect(s.distinctHeads).toBe(5);
    expect(s.reasons).toEqual([]);
    expect(s.verdict).toBe('confirmed');
  });
});

// --- AC-0d7273dd — cycles-only ledger (value lane silent) ------------------

describe('summarizeAdoption — AC-0d7273dd cycles-only ledger', () => {
  test('completed cycles with zero value-delivery events → hasSignal true, not_confirmed (never insufficient_data at ≥3 cycles), reasons include the pull gates', () => {
    // feature_created + kept done only — no working_set_served / cards / suggestions.
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1'}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2'}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.hasSignal).toBe(true);
    expect(s.completedCycles).toBe(3);
    expect(s.pullsTotal).toBe(0);
    expect(s.verdict).toBe('not_confirmed');
    expect(s.verdict).not.toBe('insufficient_data'); // the section is reported, never suppressed
    expect(s.reasons).toEqual(expect.arrayContaining(['insufficient_pulls', 'low_cycle_pull_rate']));
  });

  test('kept:false done_attempted does not count as a completed cycle', () => {
    const events = [
      ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1'}),
      ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2'}),
      ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3'}),
      ...cycle({slot: 3, feature: 'F-4', doneHead: 'head-4', kept: false}),
      ...cycle({slot: 4, feature: 'F-5', doneHead: 'head-5', kept: false}),
    ];
    const s = summarizeAdoption(events);
    expect(s.completedCycles).toBe(3); // only the 3 kept flips count
  });
});

// --- AC-345af0b5 — generations / determinism / empty -----------------------

describe('summarizeAdoption — AC-345af0b5 generations / determinism / empty', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-adoption-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('readEventsIncludingRolled concatenates the rolled generation then the live log, in append order', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    const rolled = [
      at(BASE, 'feature_created', {feature: 'F-rolled', slug: 'r'}),
      at(BASE + 1, 'done_attempted', {feature: 'F-rolled', worst: 0, kept: true, head: 'r1'}),
    ];
    const live = [
      at(BASE + 2, 'feature_created', {feature: 'F-live', slug: 'l'}),
      at(BASE + 3, 'done_attempted', {feature: 'F-live', worst: 0, kept: true, head: 'l1'}),
    ];
    writeFileSync(join(dir, '.cladding', 'events.log.1.jsonl'), `${rolled.map((e) => JSON.stringify(e)).join('\n')}\n`);
    writeFileSync(join(dir, '.cladding', 'events.log.jsonl'), `${live.map((e) => JSON.stringify(e)).join('\n')}\n`);
    const back = readEventsIncludingRolled(dir);
    expect(back.map((e) => e.payload.feature)).toEqual(['F-rolled', 'F-rolled', 'F-live', 'F-live']);
    // the reducer sees BOTH generations' completed cycles — a rotation cannot drop them from view
    expect(summarizeAdoption(back).completedCycles).toBe(2);
  });

  test('summarizeAdoption is deterministic — identical input yields deeply-equal output', () => {
    const events = confirmedFixture();
    expect(summarizeAdoption(events)).toEqual(summarizeAdoption(events));
  });

  test('empty ledger → insufficient_data with hasSignal false', () => {
    const s = summarizeAdoption([]);
    expect(s.hasSignal).toBe(false);
    expect(s.verdict).toBe('insufficient_data');
    expect(s.completedCycles).toBe(0);
    expect(s.pullsTotal).toBe(0);
  });

  test('pre-0.8 ledger (none of the 7 signal event types) → insufficient_data with hasSignal false', () => {
    const events = [
      at(BASE, 'stage_started', {stage: 'stage_1.1'}),
      at(BASE + 1, 'gate_run', {tier: 'all', strict: true, worst: 0}),
      at(BASE + 2, 'feature_activated', {feature: 'F-old'}),
      at(BASE + 3, 'stage_completed', {stage: 'stage_1.1'}),
    ];
    const s = summarizeAdoption(events);
    expect(s.hasSignal).toBe(false);
    expect(s.verdict).toBe('insufficient_data');
  });
});
