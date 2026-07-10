import {describe, it, expect} from 'vitest';
import {
  reducePriorAttempts,
  type PostMortemRecord,
} from '../../src/optimizer/prior-attempts.js';
import type {Event} from '../../src/events/log.js';

// Newline built via char code per repo rule (no raw control bytes in source,
// no backtick template literals).
const NL = String.fromCharCode(10);

function driftEvent(feature: string, gate: string): Event {
  return {
    type: 'drift_detected',
    payload: {feature, gate},
  } as unknown as Event;
}

function doneAttemptedEvent(feature: string, worst: string, kept: boolean): Event {
  return {
    type: 'done_attempted',
    payload: {feature, worst, anyFailed: !kept, kept},
  } as unknown as Event;
}

describe('reducePriorAttempts — F-59af798d prior_attempts', () => {
  // AC2 (null-omit)
  it('AC2: no events and no post-mortems omit the field (undefined)', () => {
    expect(reducePriorAttempts([], [], 'F-x')).toBeUndefined();
  });

  it('AC2: events belonging only to a different feature yield undefined for F-x', () => {
    const events: Event[] = [
      driftEvent('F-other', 'stage_2.1'),
      driftEvent('F-other', 'stage_2.2'),
    ];
    expect(reducePriorAttempts(events, [], 'F-x')).toBeUndefined();
  });

  // AC1 (compile)
  it('AC1: compiles attempt count, last failed gate, and a drift history', () => {
    const events: Event[] = [
      driftEvent('F-x', 'stage_2.1'),
      driftEvent('F-x', 'stage_2.2'),
      // different-feature event must be excluded from the count
      driftEvent('F-other', 'stage_9.9'),
    ];
    const result = reducePriorAttempts(events, [], 'F-x');
    expect(result).toBeDefined();
    expect(result!.attempts).toBe(2);
    expect(result!.last_failed_gate).toBe('stage_2.2');
    expect(result!.drift_history).toBeDefined();
    expect(result!.drift_history!.length).toBeGreaterThan(0);
  });

  // AC3 (bounded — cap)
  it('AC3: caps drift history at 5 entries', () => {
    const events: Event[] = [];
    for (let i = 1; i <= 8; i++) {
      events.push(driftEvent('F-x', 'stage_2.' + i));
    }
    const result = reducePriorAttempts(events, [], 'F-x');
    expect(result).toBeDefined();
    expect(result!.drift_history).toBeDefined();
    expect(result!.drift_history!.length).toBe(5);
  });

  // AC3 (bounded — message truncation + no raw multi-line text)
  it('AC3: truncates messages and never carries raw multi-line text', () => {
    const longGate =
      'stage_2.2_' + 'x'.repeat(250) + NL + 'tail_' + 'y'.repeat(40);
    const longWorst =
      'WORST_DETECTOR_' + 'z'.repeat(250) + NL + 'more_' + 'w'.repeat(40);
    const events: Event[] = [
      driftEvent('F-x', longGate),
      doneAttemptedEvent('F-x', longWorst, false),
    ];
    const result = reducePriorAttempts(events, [], 'F-x');
    expect(result).toBeDefined();
    const history = result!.drift_history ?? [];
    expect(history.length).toBeGreaterThan(0);
    for (const entry of history) {
      expect(entry.message.length).toBeLessThanOrEqual(121);
      expect(entry.message.includes(NL)).toBe(false);
    }
  });

  // AC1 (done_attempted semantics)
  it('AC1: done_attempted kept:false counts as an attempt, kept:true does not', () => {
    const events: Event[] = [
      doneAttemptedEvent('F-x', 'stage_2.2', false),
      doneAttemptedEvent('F-x', 'stage_2.3', true),
    ];
    const result = reducePriorAttempts(events, [], 'F-x');
    expect(result).toBeDefined();
    expect(result!.attempts).toBe(1);
  });

  // AC5 (truncated honesty)
  it('AC5: the truncated option marks truncated_history true', () => {
    const events: Event[] = [driftEvent('F-x', 'stage_2.2')];
    const result = reducePriorAttempts(events, [], 'F-x', {truncated: true});
    expect(result).toBeDefined();
    expect(result!.truncated_history).toBe(true);
  });

  it('AC5: without the truncated option, truncated_history is absent', () => {
    const events: Event[] = [driftEvent('F-x', 'stage_2.2')];
    const result = reducePriorAttempts(events, [], 'F-x');
    expect(result).toBeDefined();
    expect(result!.truncated_history).toBeUndefined();
  });

  // AC1 (post-mortem derived)
  it('AC1: derives retry_count and a single-line recovery_hint from post-mortems', () => {
    const events: Event[] = [driftEvent('F-x', 'stage_2.2')];
    const postmortems: PostMortemRecord[] = [
      {
        featureId: 'F-x',
        timestamp: '2026-07-10T00:00:00Z',
        lastFailedGate: 'stage_2.2',
        retryCount: 3,
        recovery: 'clad rollback F-x',
      },
    ];
    const result = reducePriorAttempts(events, postmortems, 'F-x');
    expect(result).toBeDefined();
    expect(result!.retry_count).toBe(3);
    expect(typeof result!.recovery_hint).toBe('string');
    expect(result!.recovery_hint!.length).toBeGreaterThan(0);
    expect(result!.recovery_hint!.includes('rollback')).toBe(true);
    expect(result!.recovery_hint!.includes(NL)).toBe(false);
  });

  // AC4 (pure)
  it('AC4: reducer is pure — identical inputs yield deep-equal output', () => {
    const events: Event[] = [
      driftEvent('F-x', 'stage_2.1'),
      doneAttemptedEvent('F-x', 'stage_2.2', false),
    ];
    const postmortems: PostMortemRecord[] = [
      {
        featureId: 'F-x',
        timestamp: '2026-07-10T00:00:00Z',
        lastFailedGate: 'stage_2.2',
        retryCount: 2,
        recovery: 'clad rollback F-x',
      },
    ];
    const first = reducePriorAttempts(events, postmortems, 'F-x');
    const second = reducePriorAttempts(events, postmortems, 'F-x');
    expect(first).toBeDefined();
    expect(first).toEqual(second);
  });
});
