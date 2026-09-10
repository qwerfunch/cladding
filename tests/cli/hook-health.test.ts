// Cladding · bounded hook-health snapshot (F-96fa5622).

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {HOOK_EVENTS, readHookHealth, recordHookFiring} from '../../src/cli/hook-health.js';
import {runHookEvent} from '../../src/cli/hook.js';

describe('bounded hook-health snapshot', () => {
  let dir: string;
  const path = (): string => join(dir, '.cladding', 'hook-health.json');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hook-health-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-96fa5622/AC-4c90cd04] five event pulses overwrite fixed keys instead of growing the event log', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n', 'utf8');
    HOOK_EVENTS.forEach((event, index) => {
      expect(recordHookFiring(dir, event, {
        now: new Date(`2026-08-10T00:00:0${index}.000Z`),
        engineVersion: '0.9.4',
      })).toBe(true);
    });
    const first = JSON.parse(readFileSync(path(), 'utf8')) as {
      lastFiredAt: Record<string, string>;
    };
    expect(Object.keys(first.lastFiredAt).sort()).toEqual([...HOOK_EVENTS].sort());
    expect(existsSync(join(dir, '.cladding', 'events.log.jsonl'))).toBe(false);

    expect(recordHookFiring(dir, 'PostToolUse', {
      now: new Date('2026-08-10T01:00:00.000Z'),
      engineVersion: '0.9.4',
    })).toBe(true);
    const report = readHookHealth(dir, '0.9.4');
    expect(report.installation).toBe('observed');
    expect(report.versionCurrent).toBe(true);
    expect(report.lastFiredAt.PostToolUse).toBe('2026-08-10T01:00:00.000Z');
    expect(Object.keys(report.lastFiredAt)).toEqual(HOOK_EVENTS);
  });

  test('spec-less and unknown events do not create runtime state', () => {
    expect(recordHookFiring(dir, 'SessionStart', {engineVersion: '0.9.4'})).toBe(false);
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n', 'utf8');
    expect(recordHookFiring(dir, 'FutureHook', {engineVersion: '0.9.4'})).toBe(false);
    expect(existsSync(path())).toBe(false);
    expect(runHookEvent('FutureHook', {}, dir)).toBe('');
    expect(existsSync(path())).toBe(false);
  });

  test('[covers:F-96fa5622/AC-8b37ba53] missing or corrupt evidence reports not-observed with all five null keys', () => {
    expect(readHookHealth(dir, '0.9.4')).toEqual({
      installation: 'not-observed',
      recordedVersion: null,
      currentVersion: '0.9.4',
      versionCurrent: null,
      lastFiredAt: {
        SessionStart: null,
        UserPromptSubmit: null,
        PreToolUse: null,
        PostToolUse: null,
        Stop: null,
      },
    });
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(path(), '{not-json\n', 'utf8');
    expect(readHookHealth(dir, '0.9.4').installation).toBe('not-observed');
  });

  test('an unwritable health path cannot change the host protocol result', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n', 'utf8');
    writeFileSync(join(dir, '.cladding'), 'blocks directory creation', 'utf8');
    expect(runHookEvent('PreToolUse', {}, dir)).toBe('');
    expect(readHookHealth(dir, '0.9.4').installation).toBe('not-observed');
  });

  test('[covers:F-96fa5622/AC-4c90cd04] recording precedes hook dispatch and preserves the protocol result', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n', 'utf8');
    expect(runHookEvent('PreToolUse', {}, dir)).toBe('');
    const report = readHookHealth(dir);
    expect(report.installation).toBe('observed');
    expect(report.lastFiredAt.PreToolUse).not.toBeNull();
  });
});
