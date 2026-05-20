// Cladding · unit tests for core/telemetry-summary (v0.3.40, F-bb15e6)
//
// Pure-function tests — no IO, no tmpdir. Each test fabricates an
// Event slice in memory and asserts the aggregation contract that
// `clad doctor` and any future MCP doctor resource depend on.

import {describe, expect, test} from 'vitest';

import {summarizeEvents, summarizeSentinelMisses} from '../../src/core/telemetry-summary.js';
import type {Event} from '../../src/events/log.js';

function sentinelMissEvent(payload: Record<string, unknown>, ts = '2026-05-20T22:00:00.000Z'): Event {
  return {id: `ev-${Math.random().toString(36).slice(2, 8)}`, timestamp: ts, type: 'sentinel_miss', payload};
}

describe('summarizeSentinelMisses', () => {
  test('zero state: no sentinel_miss events returns the empty summary', () => {
    const s = summarizeSentinelMisses([]);
    expect(s.total).toBe(0);
    expect(s.byPhase).toEqual({});
    expect(s.byCause).toEqual({});
    expect(s.byFallback).toEqual({});
    expect(s.topMissedSections).toEqual([]);
    expect(s.recentErrors).toEqual([]);
  });

  test('ignores non-sentinel_miss events so unrelated lifecycle entries do not pollute counts', () => {
    const events: Event[] = [
      {id: 'a', timestamp: 't', type: 'feature_checkpoint', payload: {}},
      {id: 'b', timestamp: 't', type: 'drift_detected', payload: {}},
    ];
    const s = summarizeSentinelMisses(events);
    expect(s.total).toBe(0);
  });

  test('aggregates by phase / cause / fallback with three events', () => {
    const events = [
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'transport down'}),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['CAPABILITIES_YAML']}),
      sentinelMissEvent({phase: 'project_context', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['WHY', 'PURPOSE']}),
    ];
    const s = summarizeSentinelMisses(events);
    expect(s.total).toBe(3);
    expect(s.byPhase).toEqual({scan_artifacts: 2, project_context: 1});
    expect(s.byCause).toEqual({dispatcher_error: 1, blank_section: 2});
    expect(s.byFallback).toEqual({total: 1, per_artifact: 2});
  });

  test('topMissedSections lists every section with desc-count + asc-name tie-break', () => {
    const events = [
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['CAPABILITIES_YAML']}),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['CAPABILITIES_YAML', 'SCENARIO_FLOWS']}),
      sentinelMissEvent({phase: 'project_context', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['WHY']}),
      sentinelMissEvent({phase: 'project_context', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['PURPOSE']}),
    ];
    const s = summarizeSentinelMisses(events);
    // CAPABILITIES_YAML appears 2 times → first.
    expect(s.topMissedSections[0]).toEqual({name: 'CAPABILITIES_YAML', count: 2});
    // PURPOSE / SCENARIO_FLOWS / WHY all at 1 → asc-name order.
    const ties = s.topMissedSections.slice(1).map((e) => e.name);
    expect(ties).toEqual(['PURPOSE', 'SCENARIO_FLOWS', 'WHY']);
  });

  test('topMissedSections caps at 5 entries even when more sentinels appear', () => {
    const events = Array.from({length: 7}, (_, i) =>
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: [`SECTION_${i}`]}),
    );
    const s = summarizeSentinelMisses(events);
    expect(s.topMissedSections.length).toBe(5);
  });

  test('recentErrors de-duplicates and keeps newest-first order, max 3', () => {
    const events = [
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'older error'}, '2026-05-20T20:00:00.000Z'),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'duplicate'}, '2026-05-20T21:00:00.000Z'),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'duplicate'}, '2026-05-20T21:30:00.000Z'),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'newest'}, '2026-05-20T22:00:00.000Z'),
    ];
    const s = summarizeSentinelMisses(events);
    expect(s.recentErrors).toEqual(['newest', 'duplicate', 'older error']);
  });

  test('missing or malformed payload fields do not crash and contribute zeros', () => {
    const events = [
      sentinelMissEvent({}),
      sentinelMissEvent({phase: 42, cause: null, fallback: undefined, missed_sections: 'not-an-array'}),
      sentinelMissEvent({phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: [123, 'CAPABILITIES_YAML']}),
    ];
    const s = summarizeSentinelMisses(events);
    expect(s.total).toBe(3);
    // Only the well-formed entries land in the buckets.
    expect(s.byPhase).toEqual({scan_artifacts: 1});
    // Non-string section names normalise to empty strings; one valid name remains.
    expect(s.topMissedSections.find((e) => e.name === 'CAPABILITIES_YAML')?.count).toBe(1);
  });
});

describe('summarizeEvents', () => {
  test('zero state', () => {
    expect(summarizeEvents([])).toEqual({total: 0, byType: {}});
  });

  test('counts every event type, omits unseen types', () => {
    const events: Event[] = [
      {id: 'a', timestamp: 't', type: 'feature_checkpoint', payload: {}},
      {id: 'b', timestamp: 't', type: 'feature_checkpoint', payload: {}},
      {id: 'c', timestamp: 't', type: 'drift_detected', payload: {}},
      {id: 'd', timestamp: 't', type: 'sentinel_miss', payload: {}},
    ];
    const s = summarizeEvents(events);
    expect(s.total).toBe(4);
    expect(s.byType.feature_checkpoint).toBe(2);
    expect(s.byType.drift_detected).toBe(1);
    expect(s.byType.sentinel_miss).toBe(1);
    expect(s.byType.stage_started).toBeUndefined();
  });
});
