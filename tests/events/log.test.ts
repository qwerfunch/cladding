// Cladding · unit tests for events/log.ts
//
// Append-only lifecycle event stream. Branches:
//   - append creates the .cladding/ directory if absent
//   - append + read round-trips every entry
//   - read on absent log returns []
//   - read on empty / whitespace-only log returns []
//   - newEvent fills id + timestamp
//   - multiple events preserve order

import {mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvent, newEvent, readEvents} from '../../events/log.js';

describe('events/log.ts', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-events-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('newEvent fills id + ISO timestamp + type + payload', () => {
    const ev = newEvent('feature_activated', {feature: 'F-001'});
    expect(ev.type).toBe('feature_activated');
    expect(ev.payload).toEqual({feature: 'F-001'});
    expect(ev.id).toMatch(/^ev-/);
    expect(ev.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/); // ISO
  });

  test('appendEvent creates .cladding/ directory on demand', () => {
    expect(existsSync(join(dir, '.cladding'))).toBe(false);
    appendEvent(dir, newEvent('stage_started', {stage: 'stage_1.1'}));
    expect(existsSync(join(dir, '.cladding'))).toBe(true);
    expect(existsSync(join(dir, '.cladding', 'events.log.jsonl'))).toBe(true);
  });

  test('append + read round-trip preserves type and payload', () => {
    const ev = newEvent('drift_detected', {detector: 'AC_DRIFT', count: 3});
    appendEvent(dir, ev);
    const back = readEvents(dir);
    expect(back).toHaveLength(1);
    expect(back[0].type).toBe('drift_detected');
    expect(back[0].payload.detector).toBe('AC_DRIFT');
    expect(back[0].payload.count).toBe(3);
  });

  test('readEvents returns [] when log is absent', () => {
    expect(readEvents(dir)).toEqual([]);
  });

  test('readEvents returns [] on empty file', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'events.log.jsonl'), '');
    expect(readEvents(dir)).toEqual([]);
  });

  test('readEvents returns [] on whitespace-only file', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'events.log.jsonl'), '\n\n   \n');
    expect(readEvents(dir)).toEqual([]);
  });

  test('multiple appends preserve order', () => {
    appendEvent(dir, newEvent('feature_activated', {n: 1}));
    appendEvent(dir, newEvent('stage_started', {n: 2}));
    appendEvent(dir, newEvent('stage_completed', {n: 3}));
    const back = readEvents(dir);
    expect(back).toHaveLength(3);
    expect(back.map((e) => e.payload.n)).toEqual([1, 2, 3]);
  });

  test('append is idempotent on existing .cladding/ directory', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    appendEvent(dir, newEvent('evidence_recorded', {}));
    expect(readEvents(dir)).toHaveLength(1);
  });
});
