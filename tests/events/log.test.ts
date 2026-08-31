// Cladding · unit tests for events/log.ts
//
// Append-only lifecycle event stream. Branches:
//   - append creates the .cladding/ directory if absent
//   - append + read round-trips every entry
//   - read on absent log returns []
//   - read on empty / whitespace-only log returns []
//   - newEvent fills id + timestamp
//   - multiple events preserve order

import {spawn} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {appendEvent, newEvent, readEvents, recordEvent} from '../../src/events/log.js';

interface GateChild {
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  release(): void;
}

/** Starts a gate caller that waits for an explicit parent barrier before writing. */
function startGateChild(cwd: string, payload: Record<string, unknown>): GateChild {
  const childSource = [
    'const {recordEvent} = await import(process.env.CLADDING_EVENTS_MODULE);',
    'const payload = JSON.parse(process.env.CLADDING_GATE_PAYLOAD);',
    'process.stdout.write(\'READY\\n\');',
    'process.stdin.once(\'data\', () => { recordEvent(process.env.CLADDING_EVENT_CWD, \'gate_run\', payload); process.exit(0); });',
  ].join('\n');
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', childSource], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLADDING_EVENTS_MODULE: new URL('../../src/events/log.ts', import.meta.url).href,
      CLADDING_EVENT_CWD: cwd,
      CLADDING_GATE_PAYLOAD: JSON.stringify(payload),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let ready = false;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (!ready && chunk.includes('READY')) {
      ready = true;
      readyResolve?.();
    }
  });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!ready) readyReject?.(new Error(`gate child exited before the barrier: ${stderr}`));
      if (code === 0) resolve();
      else reject(new Error(`gate child exited ${code}: ${stderr}`));
    });
  });
  return {ready: readyPromise, done, release: () => { child.stdin.write('go\n'); }};
}

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

  test('[covers:F-063/AC-160] append and read preserve a valid JSONL event round trip', () => {
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

  test('[covers:F-063/AC-160] absent and empty event logs read as no observations', () => {
    expect(readEvents(dir)).toEqual([]);

    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'events.log.jsonl'), '  \n\n');
    expect(readEvents(dir)).toEqual([]);
  });

  test('[covers:F-063/AC-160] multiple JSONL appends preserve observed order', () => {
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

  test('[covers:F-063/AC-160] managed symbolic paths remain observer-only no-ops', () => {
    const outside = mkdtempSync(join(tmpdir(), 'clad-events-outside-'));
    try {
      writeFileSync(join(outside, 'events.log.jsonl'), 'outside sentinel\n');
      symlinkSync(outside, join(dir, '.cladding'), 'dir');
      const before = readFileSync(join(outside, 'events.log.jsonl'), 'utf8');
      const entries = readdirSync(outside).sort();

      expect(() => appendEvent(dir, newEvent('stage_started', {stage: 'stage_1.1'}))).not.toThrow();
      expect(() => recordEvent(dir, 'gate_run', {tier: 'all', strict: true, worst: 0})).not.toThrow();

      expect(readFileSync(join(outside, 'events.log.jsonl'), 'utf8')).toBe(before);
      expect(readdirSync(outside).sort()).toEqual(entries);
      expect(readEvents(dir)).toEqual([]);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  test('event-file and lock symbolic links are observer no-ops', () => {
    const outside = mkdtempSync(join(tmpdir(), 'clad-events-outside-'));
    try {
      mkdirSync(join(dir, '.cladding'));
      const eventTarget = join(outside, 'event-target');
      const lockTarget = join(outside, 'lock-target');
      writeFileSync(eventTarget, 'event sentinel\n');
      writeFileSync(lockTarget, 'lock sentinel\n');
      symlinkSync(eventTarget, join(dir, '.cladding', 'events.log.jsonl'));
      const eventBefore = readFileSync(eventTarget, 'utf8');
      expect(() => appendEvent(dir, newEvent('stage_started', {}))).not.toThrow();
      expect(readFileSync(eventTarget, 'utf8')).toBe(eventBefore);

      rmSync(join(dir, '.cladding', 'events.log.jsonl'));
      symlinkSync(lockTarget, join(dir, '.cladding', 'spec-transaction.lock'));
      const lockBefore = readFileSync(lockTarget, 'utf8');
      expect(() => recordEvent(dir, 'gate_run', {tier: 'all', strict: true, worst: 0})).not.toThrow();
      expect(readFileSync(lockTarget, 'utf8')).toBe(lockBefore);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
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

  test('a stop block makes the next identical gate observable', () => {
    const gate = {tier: 'pre-push', strict: true, worst: 1, anyFailed: true, stopFingerprint: 'blocked'};
    recordEvent(dir, 'gate_run', gate);
    recordEvent(dir, 'gate_run', gate);
    expect(readEvents(dir).filter((event) => event.type === 'gate_run')).toHaveLength(1);

    recordEvent(dir, 'stop_blocked', {count: 1, fingerprint: 'blocked'});
    recordEvent(dir, 'gate_run', gate);
    recordEvent(dir, 'gate_run', gate);

    const events = readEvents(dir);
    expect(events.map((event) => event.type)).toEqual(['gate_run', 'stop_blocked', 'gate_run']);
  });

  test('changed blocker evidence is not deduped behind the same red outcome tuple', () => {
    recordEvent(dir, 'gate_run', {
      tier: 'pre-push',
      strict: true,
      worst: 1,
      anyFailed: true,
      blockers: ['FIRST'],
      stopFingerprint: 'first',
    });
    recordEvent(dir, 'gate_run', {
      tier: 'pre-push',
      strict: true,
      worst: 1,
      anyFailed: true,
      blockers: ['SECOND'],
      stopFingerprint: 'second',
    });
    expect(readEvents(dir).filter((event) => event.type === 'gate_run')).toHaveLength(2);
  });

  test('concurrent gate callers dedupe under one lock and retain changed blockers', async () => {
    const first = {tier: 'pre-push', strict: true, worst: 1, anyFailed: true, blockers: ['FIRST'], stopFingerprint: 'first'};
    const left = startGateChild(dir, first);
    const right = startGateChild(dir, first);
    await Promise.all([left.ready, right.ready]);
    left.release();
    right.release();
    await Promise.all([left.done, right.done]);
    expect(readEvents(dir).filter((event) => event.type === 'gate_run')).toHaveLength(1);

    recordEvent(dir, 'gate_run', {...first, blockers: ['SECOND'], stopFingerprint: 'second'});
    expect(readEvents(dir).filter((event) => event.type === 'gate_run')).toHaveLength(2);
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
