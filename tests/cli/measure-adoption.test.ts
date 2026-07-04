// Cladding · F-1e7a10c3 — adoption report surface: `clad measure --sessions` renders the B1 verdict.
//
// Drives the real CLI seam (runMeasureCommand) against a temp cwd whose
// .cladding/events.log.jsonl is hand-built with CONTROLLED timestamps — cycle
// windows and pull placement matter to the reducer — then captures stdout + the
// exit code. These tests encode the RENDERING contract of adoption-report-surface,
// NOT the reducer semantics (that is tests/events/adoption.test.ts): the numbers
// come from summarizeAdoption/summarizeValueDelivery as oracles, the thresholds
// from B1_ADOPTION_THRESHOLDS, and the honest note is pinned byte-for-byte.
//   AC-b281f9ec  signal present → a compact (≤8-line) adoption section is appended
//                where the value-delivery summary lives: verdict, completed cycles
//                vs the min, pulls total + by-tool (pushes never counted), cycle-pull
//                rate vs threshold, distinct heads vs threshold.
//   AC-14badb09  --json gains an additive `adoption` key (always present) while
//                every pre-existing value-delivery key stays byte-stable.
//   AC-95686e07  cycles-only ledger → the SILENT/UNWIRED note stays byte-identical
//                and the not_confirmed adoption section co-renders below it.
//   AC-32fe3220  no adoption signal (empty / pre-0.8 ledger) → output is exactly
//                the pre-feature honest message, with no adoption section.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {runMeasureCommand} from '../../src/cli/clad.js';
import type {Event} from '../../src/events/log.js';
import {B1_ADOPTION_THRESHOLDS, summarizeAdoption, summarizeValueDelivery} from '../../src/events/session-report.js';

// --- pre-feature honest note (F-6ba22c5c AC-2dff87ef) ----------------------
// Pinned byte-for-byte from the SILENT/UNWIRED sentence the value-delivery
// summary already emits when no value telemetry exists. AC-95686e07 requires it
// stay byte-identical; AC-32fe3220 builds the no-signal expectation from THIS
// string — never a stale full-output snapshot.
const HONEST_SILENT_UNWIRED =
  'no value-delivery telemetry was recorded — the value surfaces (impact card, session card, ' +
  'prompt suggestion, MCP working-set serves) may simply be SILENT this session, OR their emission ' +
  'may be UNWIRED. These two cases are indistinguishable from an empty ledger.\n';

const T = B1_ADOPTION_THRESHOLDS;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

// The pre-existing keys of the --json value-delivery summary (ValueDeliverySummary).
const PRE_EXISTING_JSON_KEYS = [
  'fired', 'skipped', 'byReason', 'eligible', 'suppressed', 'firedPct',
  'servedWorkingSets', 'servedByTool', 'truncationRate', 'sessionCards',
  'promptSuggestions', 'total',
];
// The additive `adoption` value's shape (AdoptionSummary).
const ADOPTION_KEYS = [
  'hasSignal', 'completedCycles', 'pullsTotal', 'pullsByTool', 'cyclesWithPull',
  'cyclePullRate', 'distinctHeads', 'verdict', 'reasons',
];

// --- controlled-timestamp fixture builders (mirror adoption.test.ts) -------
// Cycles live in disjoint 10s slots; each [feature_created .. done] window is 5s
// wide, so a pull placed inside a slot falls in exactly that one cycle's window.
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

/** 4 kept cycles; pulls in 3 of them (rate 0.75) · 12 resolved pulls (≥10) · 4 distinct heads → confirmed. */
function signalFixture(): Event[] {
  return [
    ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1', pulls: [{head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}, {head: 'head-1'}]}),
    ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2', pulls: [{head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}, {head: 'head-2'}]}),
    ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3', pulls: [{head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}, {head: 'head-3'}]}),
    ...cycle({slot: 3, feature: 'F-4', doneHead: 'head-4'}),
  ];
}

/** 3 kept cycles, ZERO value-delivery events → value lane silent (total 0) yet hasSignal true. */
function cyclesOnlyFixture(): Event[] {
  return [
    ...cycle({slot: 0, feature: 'F-1', doneHead: 'head-1'}),
    ...cycle({slot: 1, feature: 'F-2', doneHead: 'head-2'}),
    ...cycle({slot: 2, feature: 'F-3', doneHead: 'head-3'}),
  ];
}

/** A pre-0.8 ledger: only stage/gate kinds, none of the adoption signal types. */
function pre08Fixture(): Event[] {
  return [
    at(BASE, 'stage_started', {stage: 'stage_1.1'}),
    at(BASE + 1, 'gate_run', {tier: 'all', strict: true, worst: 0}),
  ];
}

// --- harness (mirrors measure-sessions.test.ts) ----------------------------
let dir: string;
let origCwd: string;
let exitCalls: number[];
let exitSpy: ReturnType<typeof vi.spyOn>;
let stdoutSpy: ReturnType<typeof vi.spyOn>;

function stdout(): string {
  return stdoutSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('');
}

/** Write hand-built events to the LIVE ledger — both readEvents (value delivery)
 *  and readEventsIncludingRolled (adoption) read through it. */
function writeLedger(events: Event[]): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  const body = events.length > 0 ? `${events.map((e) => JSON.stringify(e)).join('\n')}\n` : '';
  writeFileSync(join(dir, '.cladding', 'events.log.jsonl'), body);
}

/** Slice the whole appended adoption section: from its `adoption` header line to
 *  EOF. `adoption` (lowercase) appears only in that header — the delivery summary
 *  says `ADOPTED` (no match) and the SILENT/UNWIRED note has neither — so this
 *  isolates the entire appended block, header included, for a faithful line count. */
function adoptionSection(out: string): string[] {
  const lines = out.replace(/\n+$/, '').split('\n');
  const start = lines.findIndex((l) => /adoption/i.test(l));
  return start < 0 ? [] : lines.slice(start);
}

beforeEach(() => {
  origCwd = process.cwd();
  dir = mkdtempSync(join(tmpdir(), 'clad-vt-adoption-'));
  process.chdir(dir);
  uid = 0;
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

// --- AC-b281f9ec — render on signal ---------------------------------------

describe('clad measure --sessions — adoption section renders on signal (F-1e7a10c3 AC-b281f9ec)', () => {
  test('appends verdict, cycles-vs-min, pulls (pushes never counted), rate-vs-threshold and heads-vs-threshold', () => {
    const events = signalFixture();
    const s = summarizeAdoption(events);
    // fixture sanity — the reducer ground truth the render must surface
    expect(s.verdict).toBe('confirmed');
    expect(s.completedCycles).toBe(4);
    expect(s.pullsTotal).toBe(12);
    expect(s.cyclesWithPull).toBe(3);
    expect(s.cyclePullRate).toBe(0.75);
    expect(s.distinctHeads).toBe(4);

    writeLedger(events);
    runMeasureCommand({sessions: true});
    const section = adoptionSection(stdout());
    const block = section.join('\n');

    // section rendered, headed by its adoption header, with the verdict below it
    expect(section.length).toBeGreaterThan(0);
    expect(section[0]).toMatch(/adoption/i);
    const verdictLine = section.find((l) => /verdict:/i.test(l)) ?? '';
    expect(verdictLine).toMatch(/confirmed/i);
    expect(verdictLine).not.toMatch(/not[\s_-]?confirmed/i);
    // completed cycles shown with the min-to-judge threshold
    expect(block).toMatch(new RegExp(`completed cycles?[^\\d]*${s.completedCycles}[^\\d]+${T.minCompletedCycles}`, 'i'));
    // pulls total + by-tool + minPulls threshold + "pushes never counted"
    const pullsLine = section.find((l) => /pulls:/i.test(l)) ?? '';
    expect(pullsLine).toContain(String(s.pullsTotal));
    expect(pullsLine).toContain('clad_get_working_set');
    expect(pullsLine).toContain(String(T.minPulls));
    expect(pullsLine).toMatch(/push/i);
    expect(pullsLine).toMatch(/never/i);
    // cycle-pull rate shown as a fraction and vs the threshold percentage
    const rateLine = section.find((l) => /cycle.?pull rate/i.test(l)) ?? '';
    expect(rateLine).toContain(`${s.cyclesWithPull}/${s.completedCycles}`);
    expect(rateLine).toContain(pct(s.cyclePullRate));
    expect(rateLine).toContain(pct(T.minCyclePullRate));
    // distinct heads shown with its threshold
    expect(block).toMatch(new RegExp(`distinct heads?[^\\d]*${s.distinctHeads}[^\\d]+${T.minDistinctHeads}`, 'i'));
    expect(exitCalls).toEqual([0]);
  });

  test('the appended adoption section is compact — at most 8 lines', () => {
    writeLedger(signalFixture());
    runMeasureCommand({sessions: true});
    const section = adoptionSection(stdout());
    expect(section.length).toBeGreaterThan(0);
    expect(section.length).toBeLessThanOrEqual(8);
  });
});

// --- AC-14badb09 — JSON is additive ---------------------------------------

describe('clad measure --sessions --json — additive adoption key (F-1e7a10c3 AC-14badb09)', () => {
  test('adds the adoption key with the AdoptionSummary shape while every pre-existing key stays byte-stable', () => {
    const events = signalFixture();
    writeLedger(events);
    runMeasureCommand({sessions: true, json: true});
    const doc = JSON.parse(stdout()) as Record<string, unknown>;

    // additive adoption key, present with the full AdoptionSummary shape + unchanged values
    expect(doc).toHaveProperty('adoption');
    expect(Object.keys(doc.adoption as object).sort()).toEqual([...ADOPTION_KEYS].sort());
    expect(doc.adoption).toEqual(JSON.parse(JSON.stringify(summarizeAdoption(events))));

    // every PRE-EXISTING key still present (explicit snapshot) with values unchanged (byte-stable vs the reducer)
    const rest: Record<string, unknown> = {...doc};
    delete rest.adoption;
    expect(Object.keys(rest).sort()).toEqual([...PRE_EXISTING_JSON_KEYS].sort());
    expect(rest).toEqual(JSON.parse(JSON.stringify(summarizeValueDelivery(events))));
    expect(exitCalls).toEqual([0]);
  });

  test('the adoption key is present in JSON mode even when hasSignal is false (pre-0.8 ledger)', () => {
    const events = pre08Fixture();
    expect(summarizeAdoption(events).hasSignal).toBe(false); // precondition: no signal
    writeLedger(events);
    runMeasureCommand({sessions: true, json: true});
    const doc = JSON.parse(stdout()) as {adoption: {hasSignal: boolean; verdict: string}};
    expect(doc).toHaveProperty('adoption');
    expect(doc.adoption.hasSignal).toBe(false);
    expect(doc.adoption.verdict).toBe('insufficient_data');
    expect(exitCalls).toEqual([0]);
  });
});

// --- AC-95686e07 — co-render with the SILENT/UNWIRED note ------------------

describe('clad measure --sessions — SILENT/UNWIRED note co-renders with the adoption section (F-1e7a10c3 AC-95686e07)', () => {
  test('the SILENT/UNWIRED note stays byte-identical AND the not_confirmed section renders below it', () => {
    const events = cyclesOnlyFixture();
    // preconditions: the value lane is silent (total 0) yet adoption has signal
    expect(summarizeValueDelivery(events).total).toBe(0);
    const s = summarizeAdoption(events);
    expect(s.hasSignal).toBe(true);
    expect(s.verdict).toBe('not_confirmed');
    expect(s.reasons).toEqual(expect.arrayContaining(['insufficient_pulls', 'low_cycle_pull_rate']));

    writeLedger(events);
    runMeasureCommand({sessions: true});
    const out = stdout();

    // 1) the pre-existing note is byte-identical and leads the output
    expect(out.startsWith(HONEST_SILENT_UNWIRED)).toBe(true);

    // 2) the adoption section co-renders below it (not_confirmed), still compact
    const below = out.slice(HONEST_SILENT_UNWIRED.length).replace(/\n+$/, '');
    const section = below.split('\n');
    expect(section.length).toBeGreaterThan(0);
    expect(section.length).toBeLessThanOrEqual(8);
    expect(section[0]).toMatch(/adoption/i); // the section header leads, directly below the note
    const verdictLine = section.find((l) => /verdict:/i.test(l)) ?? '';
    expect(verdictLine).toMatch(/not[\s_-]?confirmed/i);
    // the unmet gate reasons the reducer reports are surfaced verbatim
    expect(below).toContain(s.reasons.join(', '));
    expect(exitCalls).toEqual([0]);
  });
});

// --- AC-32fe3220 — no signal, no change -----------------------------------

describe('clad measure --sessions — no adoption signal renders zero output change (F-1e7a10c3 AC-32fe3220)', () => {
  test('empty ledger → exactly the pre-feature honest message, no adoption section', () => {
    // nothing recorded at all (no .cladding ledger in the fresh temp cwd)
    runMeasureCommand({sessions: true});
    const out = stdout();
    expect(out).toBe(HONEST_SILENT_UNWIRED);
    expect(out).not.toMatch(/verdict:/i);
    expect(out).not.toMatch(/completed cycles?/i);
    expect(out).not.toMatch(/cycle.?pull rate/i);
    expect(out).not.toMatch(/distinct heads?/i);
    expect(exitCalls).toEqual([0]);
  });

  test('pre-0.8 ledger (only stage_started / gate_run kinds) → the same honest message byte-for-byte, no adoption section', () => {
    const events = pre08Fixture();
    expect(summarizeAdoption(events).hasSignal).toBe(false); // precondition: no signal
    writeLedger(events);
    runMeasureCommand({sessions: true});
    const out = stdout();
    expect(out).toBe(HONEST_SILENT_UNWIRED);
    expect(out).not.toMatch(/verdict:/i);
    expect(exitCalls).toEqual([0]);
  });
});
