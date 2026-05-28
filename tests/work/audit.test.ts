// Cladding · unit tests for src/work/audit.ts (0.4.6, F-89406c)

import {appendFileSync, mkdirSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {auditWorkCompliance} from '../../src/work/audit.js';

function seedEvent(cwd: string, type: string, payload: Record<string, unknown>, timestamp: string): void {
  const dir = join(cwd, '.cladding');
  mkdirSync(dir, {recursive: true});
  const event = {
    id: `ev-${Math.random().toString(36).slice(2, 10)}`,
    timestamp,
    type,
    payload,
  };
  appendFileSync(join(dir, 'events.log.jsonl'), `${JSON.stringify(event)}\n`);
}

const NOW = Date.parse('2026-06-01T12:00:00.000Z');
const stubNow = () => NOW;

describe('auditWorkCompliance', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-audit-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  test('no events file → empty report', () => {
    const report = auditWorkCompliance({cwd, now: stubNow});
    expect(report.transactions).toEqual([]);
    expect(report.openTransactions).toEqual([]);
    expect(report.summary.totalEntered).toBe(0);
  });

  test('entered without close → open transaction', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-aaaaaa', personaId: 'specialists'}, '2026-06-01T11:50:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    expect(report.openTransactions).toHaveLength(1);
    expect(report.openTransactions[0].featureId).toBe('F-aaaaaa');
    expect(report.openTransactions[0].ageMs).toBe(10 * 60 * 1000);
    expect(report.summary.stillOpen).toBe(1);
  });

  test('entered + completed → completed transaction record with duration', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-bbbbbb'}, '2026-06-01T11:30:00.000Z');
    seedEvent(cwd, 'work_completed', {feature: 'F-bbbbbb', driftPass: true}, '2026-06-01T11:45:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    const tx = report.transactions.find((t) => t.featureId === 'F-bbbbbb')!;
    expect(tx.status).toBe('completed');
    expect(tx.durationMs).toBe(15 * 60 * 1000);
    expect(report.summary.totalCompleted).toBe(1);
    expect(report.summary.stillOpen).toBe(0);
  });

  test('entered + abandoned → abandoned status', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-cccccc'}, '2026-06-01T11:30:00.000Z');
    seedEvent(cwd, 'work_abandoned', {feature: 'F-cccccc', reason: 'user changed direction'}, '2026-06-01T11:32:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    const tx = report.transactions.find((t) => t.featureId === 'F-cccccc')!;
    expect(tx.status).toBe('abandoned');
    expect(report.summary.totalAbandoned).toBe(1);
  });

  test('entered + timed_out → timed_out status', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-dddddd'}, '2026-06-01T11:00:00.000Z');
    seedEvent(cwd, 'work_timed_out', {feature: 'F-dddddd'}, '2026-06-01T11:10:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    const tx = report.transactions.find((t) => t.featureId === 'F-dddddd')!;
    expect(tx.status).toBe('timed_out');
    expect(report.summary.totalTimedOut).toBe(1);
  });

  test('idempotent re-entry on same featureId keeps original enteredAt', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-eeeeee'}, '2026-06-01T11:30:00.000Z');
    seedEvent(cwd, 'work_entered', {feature: 'F-eeeeee'}, '2026-06-01T11:31:00.000Z');
    seedEvent(cwd, 'work_completed', {feature: 'F-eeeeee', driftPass: true}, '2026-06-01T11:35:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    const tx = report.transactions.find((t) => t.featureId === 'F-eeeeee')!;
    expect(tx.enteredAt).toBe('2026-06-01T11:30:00.000Z');
    expect(tx.durationMs).toBe(5 * 60 * 1000);
  });

  test('orphan windows surface gaps between transactions', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-ffffff'}, '2026-06-01T11:30:00.000Z');
    seedEvent(cwd, 'work_completed', {feature: 'F-ffffff', driftPass: true}, '2026-06-01T11:35:00.000Z');
    // 20-minute gap (>> 5s threshold) before the next transaction.
    seedEvent(cwd, 'work_entered', {feature: 'F-aabbcc'}, '2026-06-01T11:55:00.000Z');
    seedEvent(cwd, 'work_completed', {feature: 'F-aabbcc', driftPass: true}, '2026-06-01T11:58:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow, sinceMs: 60 * 60 * 1000});
    // Expect at least one orphan window of ~20 min between close-of-F-ffffff
    // and open-of-F-aabbcc.
    const gap = report.orphanWindows.find((w) => w.durationMs === 20 * 60 * 1000);
    expect(gap).toBeDefined();
  });

  test('sinceMs cutoff drops older events', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-oldold'}, '2026-05-30T11:00:00.000Z');
    seedEvent(cwd, 'work_entered', {feature: 'F-newnew'}, '2026-06-01T11:50:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow, sinceMs: 60 * 60 * 1000});
    expect(report.openTransactions.map((t) => t.featureId)).toEqual(['F-newnew']);
  });

  test('non-work events ignored (sentinel_miss, feature_completed etc.)', () => {
    seedEvent(cwd, 'sentinel_miss', {phase: 'scan_artifacts'}, '2026-06-01T11:30:00.000Z');
    seedEvent(cwd, 'feature_completed', {feature: 'F-old', by: 'clad-drive'}, '2026-06-01T11:31:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    expect(report.summary.totalEntered).toBe(0);
  });

  test('0.4.7 — fileDiffs is undefined when includeFileDiff is false (default)', () => {
    seedEvent(cwd, 'work_entered', {feature: 'F-aaaaaa'}, '2026-06-01T11:50:00.000Z');
    const report = auditWorkCompliance({cwd, now: stubNow});
    expect(report.fileDiffs).toBeUndefined();
  });

  test('0.4.7 — fileDiffs is an array (possibly empty) when includeFileDiff is true', () => {
    // No active work registered + no git → fileDiffs is empty array.
    const report = auditWorkCompliance({cwd, now: stubNow, includeFileDiff: true});
    expect(Array.isArray(report.fileDiffs)).toBe(true);
    expect(report.fileDiffs).toEqual([]);
  });
});
