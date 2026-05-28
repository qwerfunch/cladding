// Cladding · unit tests for plugins/claude-code/hooks/pre-tool-use.mjs (0.4.7, Layer-C)

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

const HOOK_PATH = join(process.cwd(), 'plugins', 'claude-code', 'hooks', 'pre-tool-use.mjs');

function runHook(payload: object): {stdout: string; stderr: string; status: number | null} {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
  };
}

function seedRegistry(cwd: string, body: object): void {
  const dir = join(cwd, '.cladding');
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, 'work-registry.json'), JSON.stringify(body));
}

describe('pre-tool-use.mjs Claude Code hook', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'clad-hook-'));
  });
  afterEach(() => {
    rmSync(cwd, {recursive: true, force: true});
  });

  test('silent allow when no registry file (cladding not initialised)', () => {
    const result = runHook({cwd, hook_event_name: 'PreToolUse'});
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('deny when registry exists but has zero active transactions', () => {
    seedRegistry(cwd, {active: {}});
    const result = runHook({cwd, hook_event_name: 'PreToolUse'});
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(parsed.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/enter_work/);
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toMatch(/execute_drive/);
  });

  test('silent allow when at least one active work exists', () => {
    seedRegistry(cwd, {
      active: {
        'F-aaaaaa': {
          featureId: 'F-aaaaaa',
          enteredAt: '2026-06-01T00:00:00.000Z',
          scope: {slug: 'demo', modules: []},
          personaId: 'specialists',
        },
      },
    });
    const result = runHook({cwd, hook_event_name: 'PreToolUse'});
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('silent allow when registry file is corrupt JSON (fail-open)', () => {
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'work-registry.json'), '{{{not valid json');
    const result = runHook({cwd, hook_event_name: 'PreToolUse'});
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('');
  });

  test('silent allow when stdin payload is not valid JSON (fail-open)', () => {
    // Send malformed stdin directly.
    const result = spawnSync('node', [HOOK_PATH], {
      input: 'not-a-json-payload',
      encoding: 'utf8',
      timeout: 10_000,
    });
    expect(result.status).toBe(0);
    expect((result.stdout ?? '').trim()).toBe('');
  });

  test('falls back to process.cwd() when payload omits cwd (defensive)', () => {
    // Payload without cwd → uses process.cwd() of the node process,
    // which is the test runner's cwd. cladding repo has no
    // .cladding/work-registry.json at the root, so this should
    // silent-allow (no registry → allow).
    const result = runHook({hook_event_name: 'PreToolUse'});
    expect(result.status).toBe(0);
  });
});
