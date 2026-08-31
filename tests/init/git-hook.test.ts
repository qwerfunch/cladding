// Cladding · unit tests for src/init/git-hook.ts (Phase 2 ambient hook)

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {installPreCommitHook, renderPreCommitHook, installGitHook} from '../../src/init/git-hook.js';
import {runInit, scaffoldCiWorkflow} from '../../src/cli/init.js';

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

describe('clad init --with-hook', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-init-hook-'));
    mkdirSync(join(dir, '.git'), {recursive: true});
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-af96b1/AC-003] opt-in init installs idempotent cladding hooks without overwriting a foreign hook', async () => {
    await runInit({cwd: dir, noLlm: true, withHook: true});
    const preCommit = join(dir, '.git', 'hooks', 'pre-commit');
    const prePush = join(dir, '.git', 'hooks', 'pre-push');
    expect(readFileSync(preCommit, 'utf8')).toContain('clad check --tier=pre-commit');
    expect(readFileSync(prePush, 'utf8')).toContain('clad check --tier=pre-push --strict');

    const initial = readFileSync(preCommit, 'utf8');
    await runInit({cwd: dir, noLlm: true, withHook: true});
    expect(readFileSync(preCommit, 'utf8')).toBe(initial);

    writeFileSync(prePush, '#!/bin/sh\n# user-owned\nexit 0\n');
    await runInit({cwd: dir, noLlm: true, withHook: true});
    expect(readFileSync(prePush, 'utf8')).toContain('user-owned');
  });
});

// ─── F-16746b — pre-push hook + kind-generalized installer ───

describe('installGitHook pre-push (F-16746b)', () => {
  test('renders a strict pre-push hook and installs it alongside pre-commit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-prepush-'));
    try {
      mkdirSync(join(dir, '.git'), {recursive: true});
      const r = installGitHook('pre-push', dir, {version: '0.6.0'});
      expect(r.result).toBe('created');
      const body = readFileSync(join(dir, '.git', 'hooks', 'pre-push'), 'utf8');
      expect(body).toContain('check --tier=pre-push --strict');
      expect(body).toContain('cladding pre-push hook');
      // idempotent
      expect(installGitHook('pre-push', dir, {version: '0.6.0'}).result).toBe('unchanged');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('a foreign pre-push hook is never overwritten without force', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-prepush-foreign-'));
    try {
      mkdirSync(join(dir, '.git', 'hooks'), {recursive: true});
      writeFileSync(join(dir, '.git', 'hooks', 'pre-push'), '#!/bin/sh\n# user hook\nexit 0\n');
      expect(installGitHook('pre-push', dir).result).toBe('skipped-foreign');
      expect(readFileSync(join(dir, '.git', 'hooks', 'pre-push'), 'utf8')).toContain('user hook');
      expect(installGitHook('pre-push', dir, {force: true}).result).toBe('created');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

describe('scaffoldCiWorkflow (F-16746b)', () => {
  test('[covers:F-16746b/AC-a3152c] CI stays authoritative when a generated hook documents its one-time local bypass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-ci-'));
    try {
      expect(scaffoldCiWorkflow(dir, '0.9.3')).toBe('created');
      const p = join(dir, '.github', 'workflows', 'cladding.yml');
      const body = readFileSync(p, 'utf8');
      expect(body).toContain('npx --yes cladding@0.9 check');
      expect(body).toContain('check --tier=pre-push --strict --json');
      expect(body).toContain('fetch-depth: 0');
      mkdirSync(join(dir, '.git'), {recursive: true});
      expect(installGitHook('pre-push', dir, {version: '0.9.3'}).result).toBe('created');
      const hook = readFileSync(join(dir, '.git', 'hooks', 'pre-push'), 'utf8');
      expect(hook).toContain('git push --no-verify');
      expect(hook).toContain('authoritative CI gate still runs');
      writeFileSync(p, '# user-owned\n');
      expect(scaffoldCiWorkflow(dir, null)).toBe('exists');
      expect(readFileSync(p, 'utf8')).toBe('# user-owned\n');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('does not scaffold an unpinned workflow when the runtime version is unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-ci-no-version-'));
    try {
      expect(scaffoldCiWorkflow(dir, null)).toBe('version-unavailable');
      expect(existsSync(join(dir, '.github', 'workflows', 'cladding.yml'))).toBe(false);
      expect(scaffoldCiWorkflow(dir, 'not-semver')).toBe('version-unavailable');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
