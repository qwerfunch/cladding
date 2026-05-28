// Cladding · unit tests for src/work/registry.ts (0.4.3, F-ca18ea)

import {existsSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  type ActiveWork,
  findExpiredWork,
  getActiveWork,
  listActiveWork,
  loadRegistry,
  registerActiveWork,
  removeActiveWork,
} from '../../src/work/registry.js';

function makeWork(featureId: string, enteredAt = new Date().toISOString()): ActiveWork {
  return {
    featureId,
    enteredAt,
    intent: 'test intent',
    scope: {slug: 'demo', modules: ['src/demo.ts']},
    personaId: 'specialists',
  };
}

describe('work/registry', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-work-registry-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('loadRegistry returns empty when file absent', () => {
    expect(loadRegistry(dir)).toEqual({active: {}});
  });

  test('register + getActiveWork round-trip', () => {
    const work = makeWork('F-aaaaaa');
    registerActiveWork(dir, work);
    expect(getActiveWork(dir, 'F-aaaaaa')).toEqual(work);
    expect(existsSync(join(dir, '.cladding', 'work-registry.json'))).toBe(true);
  });

  test('register is idempotent — second call returns the original, does not overwrite enteredAt', () => {
    const first = makeWork('F-bbbbbb', '2026-01-01T00:00:00.000Z');
    registerActiveWork(dir, first);
    const second = makeWork('F-bbbbbb', '2026-12-31T23:59:59.000Z');
    const returned = registerActiveWork(dir, second);
    expect(returned.enteredAt).toBe(first.enteredAt);
    expect(getActiveWork(dir, 'F-bbbbbb')?.enteredAt).toBe(first.enteredAt);
  });

  test('removeActiveWork drops the entry', () => {
    registerActiveWork(dir, makeWork('F-cccccc'));
    removeActiveWork(dir, 'F-cccccc');
    expect(getActiveWork(dir, 'F-cccccc')).toBeUndefined();
  });

  test('removeActiveWork is no-op for unknown id', () => {
    expect(() => removeActiveWork(dir, 'F-zzzzzz')).not.toThrow();
  });

  test('listActiveWork returns every registered entry', () => {
    registerActiveWork(dir, makeWork('F-aaaaaa'));
    registerActiveWork(dir, makeWork('F-bbbbbb'));
    const list = listActiveWork(dir);
    expect(list.map((w) => w.featureId).sort()).toEqual(['F-aaaaaa', 'F-bbbbbb']);
  });

  test('findExpiredWork picks entries older than the timeout', () => {
    const longAgo = new Date(Date.now() - 60_000).toISOString();
    const recent = new Date().toISOString();
    registerActiveWork(dir, makeWork('F-oldold', longAgo));
    registerActiveWork(dir, makeWork('F-newnew', recent));
    const expired = findExpiredWork(dir, 1_000);
    expect(expired.map((w) => w.featureId)).toEqual(['F-oldold']);
  });

  test('corrupt registry file falls back to empty without throwing', () => {
    registerActiveWork(dir, makeWork('F-aaaaaa'));
    const path = join(dir, '.cladding', 'work-registry.json');
    rmSync(path);
    // Re-create with garbage
    const garbageDir = join(dir, '.cladding');
    require('node:fs').writeFileSync(join(garbageDir, 'work-registry.json'), 'not valid json {{');
    expect(loadRegistry(dir)).toEqual({active: {}});
  });

  test('persisted registry file is valid JSON readable cross-process', () => {
    const work = makeWork('F-aaaaaa');
    registerActiveWork(dir, work);
    const raw = readFileSync(join(dir, '.cladding', 'work-registry.json'), 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual({active: {[work.featureId]: work}});
  });
});
