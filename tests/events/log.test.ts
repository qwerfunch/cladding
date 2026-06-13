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

import {appendEvent, newEvent, readEvents, recordEvent} from '../../src/events/log.js';

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

// ─── F-b84c38 — lifecycle events with identity ───

describe('recordEvent (F-b84c38)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-events-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('stamps identity and (when in a git repo) head into the payload', () => {
    recordEvent(dir, 'feature_created', {feature: 'F-test', slug: 'x'});
    const events = readEvents(dir);
    expect(events.length).toBe(1);
    const p = events[0].payload as {identity?: {author: string; name?: string}; head?: string};
    expect(p.identity?.author).toBe('human');
    expect(typeof p.identity?.name).toBe('string'); // git author or OS user — always resolvable on a dev box
  });

  test('never throws even when the cwd is not writable territory', () => {
    expect(() => recordEvent('/nonexistent/deeply/bogus', 'gate_run', {tier: 'all'})).not.toThrow();
  });

  test('gate_run dedupes the identical (head, tier, strict, worst) tuple but appends on any change', () => {
    recordEvent(dir, 'gate_run', {tier: 'pre-push', strict: true, worst: 0, anyFailed: false});
    recordEvent(dir, 'gate_run', {tier: 'pre-push', strict: true, worst: 0, anyFailed: false}); // identical → skipped
    recordEvent(dir, 'gate_run', {tier: 'pre-push', strict: true, worst: 1, anyFailed: true}); // worst changed → appended
    recordEvent(dir, 'gate_run', {tier: 'pre-commit', strict: true, worst: 1, anyFailed: true}); // tier changed → appended
    const runs = readEvents(dir).filter((e) => e.type === 'gate_run');
    expect(runs.length).toBe(3);
  });

  test('non-gate_run types are never deduped', () => {
    recordEvent(dir, 'done_attempted', {feature: 'F-x', worst: 0, kept: true});
    recordEvent(dir, 'done_attempted', {feature: 'F-x', worst: 0, kept: true});
    expect(readEvents(dir).filter((e) => e.type === 'done_attempted').length).toBe(2);
  });
});

describe('rotation (F-b84c38)', () => {
  test('rolls the live log to events.log.1.jsonl past the threshold; reads stay bounded to the live file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-events-rot-'));
    try {
      const live = join(dir, '.cladding', 'events.log.jsonl');
      mkdirSync(join(dir, '.cladding'), {recursive: true});
      // Seed a live log just past 5 MB.
      const line = `${JSON.stringify(newEvent('drift_detected', {pad: 'x'.repeat(1024)}))}\n`;
      writeFileSync(live, line.repeat(Math.ceil((5 * 1024 * 1024) / line.length) + 10));
      appendEvent(dir, newEvent('gate_run', {tier: 'all'}));
      expect(existsSync(join(dir, '.cladding', 'events.log.1.jsonl'))).toBe(true);
      const events = readEvents(dir);
      expect(events.length).toBe(1); // live log restarted with just the new event
      expect(events[0].type).toBe('gate_run');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
