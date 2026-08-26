// Cladding · F-1aab1bba — pure Stop outcome attribution and correlation.

import {describe, expect, test} from 'vitest';

import {newEvent, type Event} from '../../src/events/log.js';
import {
  attributeStopFailures,
  blockingDetectorNames,
  gateStopFingerprint,
  summarizeStopOutcomes,
  type TelemetryStage,
} from '../../src/events/stop-telemetry.js';

function event(type: Event['type'], payload: Record<string, unknown>): Event {
  return newEvent(type, payload);
}

describe('Stop outcome telemetry', () => {
  test('compact blockers retain structured detector names and opaque failing stages', () => {
    const stages: TelemetryStage[] = [
      {stage: 'stage_1.1', status: 'fail'},
      {
        stage: 'stage_1.3',
        status: 'fail',
        findings: [
          {detector: 'BETA', path: 'b', severity: 'warn'},
          {detector: 'ALPHA', path: 'a', severity: 'error'},
          {detector: 'ALPHA', path: 'other', severity: 'error'},
          {detector: 'FYI', severity: 'info'},
        ],
      },
      {stage: 'stage_1.5', status: 'pass'},
    ];
    expect(blockingDetectorNames(stages)).toEqual(['ALPHA', 'BETA', 'stage_1.1']);
    expect(blockingDetectorNames([{stage: 'stage_1.3', status: 'pass'}])).toEqual([]);
  });

  test('gate fingerprint is byte-compatible with the deployed Stop detector|path vector', () => {
    const stages: TelemetryStage[] = [
      {
        stage: 'stage_1.3',
        status: 'fail',
        findings: [
          {detector: 'AC_DRIFT', path: 'spec/x.yaml', severity: 'error'},
          {detector: 'IGNORED', path: 'docs/x.md', severity: 'info'},
        ],
      },
      {stage: 'stage_1.5', status: 'fail'},
      {stage: 'stage_1.6', status: 'pass'},
    ];
    expect(gateStopFingerprint(stages)).toBe('bae6850452d64f7bf5284989955dcfc1994669983f354920e3d660a42687bea6');
    expect(gateStopFingerprint([{stage: 'stage_1.3', status: 'pass'}])).toBe('');
  });

  test('attributes findings against the latest gate independently of dirty-tree intersection', () => {
    expect(
      attributeStopFailures(
        [
          {detector: 'NEW', path: 'src/new.ts'},
          {detector: 'OLD', path: 'src/old.ts'},
          {detector: 'OLD', path: ''},
        ],
        ['OLD'],
        ['src/new.ts'],
      ),
    ).toEqual({detectors: ['NEW', 'OLD'], introduced: 1, preexisting: 2, dirty_hit: true});
  });

  test('matches a blocked fingerprint only against later gate runs', () => {
    const events = [
      event('gate_run', {stopFingerprint: 'same'}),
      event('stop_blocked', {fingerprint: 'same'}),
      event('stop_exit_recorded', {fingerprint: 'same'}),
      event('gate_run', {stopFingerprint: 'different'}),
      event('stop_blocked', {fingerprint: 'later'}),
      event('gate_run', {stopFingerprint: 'later'}),
      event('stop_blocked', {}),
    ];
    expect(summarizeStopOutcomes(events)).toEqual({
      blocked: 3,
      exitsRecorded: 1,
      observedByLaterGate: 1,
      notObservedByLaterGate: 2,
    });
  });
});
