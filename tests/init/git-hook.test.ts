// Cladding · unit tests for src/init/git-hook.ts (Phase 2 ambient hook)

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {installPreCommitHook, renderPreCommitHook} from '../../src/init/git-hook.js';

describe('installPreCommitHook', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-hook-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });
  const hookPath = (): string => join(dir, '.git', 'hooks', 'pre-commit');

  test('no .git directory → skipped-no-git (not an error, no file written)', () => {
    const r = installPreCommitHook(dir, {version: '0.4.0'});
    expect(r.result).toBe('skipped-no-git');
    expect(existsSync(hookPath())).toBe(false);
  });

  test('creates an executable hook that runs `clad check --tier=pre-commit`', () => {
    mkdirSync(join(dir, '.git'), {recursive: true});
    const r = installPreCommitHook(dir, {version: '0.4.0'});
    expect(r.result).toBe('created');
    const body = readFileSync(hookPath(), 'utf8');
    expect(body).toContain('clad check --tier=pre-commit');
    expect(body).toContain('cladding pre-commit hook');
    expect(statSync(hookPath()).mode & 0o100).toBeTruthy(); // owner execute bit
  });

  test('idempotent — re-installing the same version is unchanged', () => {
    mkdirSync(join(dir, '.git'), {recursive: true});
    expect(installPreCommitHook(dir, {version: '0.4.0'}).result).toBe('created');
    expect(installPreCommitHook(dir, {version: '0.4.0'}).result).toBe('unchanged');
  });

  test('version change → updated in place (cladding owns its own hook)', () => {
    mkdirSync(join(dir, '.git'), {recursive: true});
    installPreCommitHook(dir, {version: '0.4.0'});
    const r = installPreCommitHook(dir, {version: '0.4.1'});
    expect(r.result).toBe('updated');
    expect(readFileSync(hookPath(), 'utf8')).toContain('v0.4.1');
  });

  test('foreign hook → skipped-foreign (not clobbered); --force overwrites', () => {
    mkdirSync(join(dir, '.git', 'hooks'), {recursive: true});
    writeFileSync(hookPath(), '#!/bin/sh\necho not-ours\n');
    expect(installPreCommitHook(dir, {version: '0.4.0'}).result).toBe('skipped-foreign');
    expect(readFileSync(hookPath(), 'utf8')).toContain('echo not-ours'); // preserved
    const forced = installPreCommitHook(dir, {version: '0.4.0', force: true});
    expect(forced.result).toBe('created');
    expect(readFileSync(hookPath(), 'utf8')).toContain('clad check --tier=pre-commit');
  });

  test('hook degrades gracefully when clad is absent (warns, exit 0 — does not brick commits)', () => {
    const body = renderPreCommitHook('0.4.0');
    expect(body.startsWith('#!/bin/sh')).toBe(true);
    expect(body).toContain('not found on PATH');
    expect(body).toContain('exit 0'); // missing tool must NOT block every commit
  });
});
