// Cladding · unit tests for Codex + Cursor Layer-C hook scripts (0.4.9)
//
// Both scripts use the universal `exit 2 + stderr message` deny
// pattern (Claude Code uses exit 0 + JSON — separate test file). Same
// fail-open semantics for missing/corrupt registry + malformed stdin.

import {spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

const CODEX_HOOK = join(process.cwd(), 'plugins', 'codex', 'hooks', 'pre-tool-use.mjs');
const CURSOR_HOOK = join(process.cwd(), 'plugins', 'cursor', 'hooks', 'pre-edit.mjs');

function runHook(hookPath: string, payload: object): {stdout: string; stderr: string; status: number | null} {
  const result = spawnSync('node', [hookPath], {
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

const cases = [
  {label: 'codex (pre-tool-use)', hook: CODEX_HOOK, payloadCwdKey: 'cwd'},
  {label: 'cursor (pre-edit)', hook: CURSOR_HOOK, payloadCwdKey: 'cwd'},
] as const;

for (const {label, hook, payloadCwdKey} of cases) {
  describe(`${label} hook`, () => {
    let cwd: string;
    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), 'clad-multi-hook-'));
    });
    afterEach(() => {
      rmSync(cwd, {recursive: true, force: true});
    });

    test('silent allow when no registry file', () => {
      const result = runHook(hook, {[payloadCwdKey]: cwd});
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('deny (exit 2 + stderr) when registry has zero active transactions', () => {
      seedRegistry(cwd, {active: {}});
      const result = runHook(hook, {[payloadCwdKey]: cwd});
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/enter_work/);
      expect(result.stderr).toMatch(/execute_drive/);
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
      const result = runHook(hook, {[payloadCwdKey]: cwd});
      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
    });

    test('silent allow when registry file is corrupt JSON (fail-open)', () => {
      mkdirSync(join(cwd, '.cladding'), {recursive: true});
      writeFileSync(join(cwd, '.cladding', 'work-registry.json'), '{{{not valid');
      const result = runHook(hook, {[payloadCwdKey]: cwd});
      expect(result.status).toBe(0);
    });

    test('silent allow when stdin payload is not valid JSON (fail-open)', () => {
      const result = spawnSync('node', [hook], {
        input: 'not-a-json',
        encoding: 'utf8',
        timeout: 10_000,
      });
      expect(result.status).toBe(0);
    });

    test('silent allow when payload is an empty body (no cwd)', () => {
      const result = runHook(hook, {});
      // process.cwd() = cladding repo root; no .cladding/work-registry.json
      // at the repo root → silent allow.
      expect(result.status).toBe(0);
    });
  });
}
