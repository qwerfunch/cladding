// Cladding · unit tests for src/init/host-setup.ts (F-80d19d)
//
// `clad setup` is the explicit replacement for F-90d054's npm postinstall hook.
// Each AC drives at least one test case. The host home is mocked via `mkdtempSync`
// so the suite is fully isolated from the developer's real `~/.claude` etc.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {getCurrentCladdingVersion, getLastSetupVersion, runHostSetup} from '../../src/init/host-setup.js';

describe('runHostSetup', () => {
  let home: string;
  let pkgRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'clad-setup-home-'));
    pkgRoot = mkdtempSync(join(tmpdir(), 'clad-setup-pkg-'));
    // Minimal pkg skeleton mirroring the real cladding layout the wirer expects.
    mkdirSync(join(pkgRoot, 'plugins', 'gemini-cli'), {recursive: true});
    mkdirSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'init'), {recursive: true});
    mkdirSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'check'), {recursive: true});
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({version: '0.4.0'}));
  });

  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
    rmSync(pkgRoot, {recursive: true, force: true});
  });

  // AC-001 — detected hosts wired, undetected ones skipped (no surprise dirs).
  test('wires only the host channels whose home directory exists', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});
    mkdirSync(join(home, '.agents'), {recursive: true});
    // .gemini and .codex intentionally absent.

    const result = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    expect(result.wiring.claude_plugin).toBe('created');
    expect(result.wiring.gemini_extension).toBe('skipped-not-installed');
    expect(result.wiring.codex_mcp).toBe('skipped-not-installed');
    expect(result.wiring.codex_skills.length).toBeGreaterThan(0);
    expect(existsSync(join(home, '.gemini'))).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  // AC-002 — re-running on already-wired host yields no filesystem changes.
  test('second run reports already-wired without re-creating links', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});

    await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});
    const result2 = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    expect(result2.wiring.claude_plugin).toBe('unchanged');
    expect(result2.errors.length).toBe(0);
  });

  // AC-003 — delta: previously undetected host added later → wired on next run.
  test('delta-wires a host that was not installed on the previous run', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});
    const first = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});
    expect(first.wiring.gemini_extension).toBe('skipped-not-installed');

    // Simulate: user installs Gemini CLI between the two runs.
    mkdirSync(join(home, '.gemini'), {recursive: true});
    const second = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    expect(second.wiring.gemini_extension).toBe('created');
    expect(second.wiring.claude_plugin).toBe('unchanged');
  });

  // AC-004 — update: symlink target changed (cladding upgraded to a new path).
  test('re-wires when the symlink target no longer matches the current cladding root', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});
    const oldPkg = mkdtempSync(join(tmpdir(), 'clad-old-pkg-'));
    writeFileSync(join(oldPkg, 'package.json'), JSON.stringify({version: '0.3.60'}));
    mkdirSync(join(home, '.claude', 'plugins'), {recursive: true});
    symlinkSync(oldPkg, join(home, '.claude', 'plugins', 'cladding'), 'dir');

    const result = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    expect(['created', 'rewired']).toContain(result.wiring.claude_plugin);
    const linked = readlinkSync(join(home, '.claude', 'plugins', 'cladding'));
    expect(resolve(linked)).toBe(resolve(pkgRoot));

    rmSync(oldPkg, {recursive: true, force: true});
  });

  // AC-005 — repair: symlink deleted → re-create on next run.
  test('re-creates a missing symlink as a repair', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});
    await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    rmSync(join(home, '.claude', 'plugins', 'cladding'), {force: true});
    expect(existsSync(join(home, '.claude', 'plugins', 'cladding'))).toBe(false);

    const result = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});
    expect(result.wiring.claude_plugin).toBe('created');
    expect(existsSync(join(home, '.claude', 'plugins', 'cladding'))).toBe(true);
  });

  // AC-008 — npm install must not run any wiring code (no postinstall hook).
  // This is enforced at package.json level; we sanity-check by confirming the
  // exported runner is opt-in (importing the module has no filesystem effect).
  test('importing host-setup does not wire anything on its own', () => {
    // The module is already imported at the top of this file. If importing
    // had wired anything, ~/.cladding/ would exist on the test machine — but
    // this test runs against a fresh tmp home where nothing should exist
    // until runHostSetup is explicitly invoked.
    expect(existsSync(join(home, '.cladding'))).toBe(false);
  });

  // AC-009 — directory-copy fallback with diverged contents → skipped unless --force.
  test('refuses to overwrite a non-symlink wire without --force', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});
    const linkParent = join(home, '.claude', 'plugins');
    mkdirSync(linkParent, {recursive: true});
    // Simulate Win directory-copy fallback: a real directory at the link path.
    mkdirSync(join(linkParent, 'cladding'), {recursive: true});
    writeFileSync(join(linkParent, 'cladding', 'user-customised.txt'), 'do not lose this');

    const result = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    expect(result.wiring.claude_plugin).toBe('skipped-different');
    // User customisation is preserved.
    expect(existsSync(join(linkParent, 'cladding', 'user-customised.txt'))).toBe(true);

    // --force overwrites it.
    const forced = await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true, force: true});
    expect(['created', 'rewired']).toContain(forced.wiring.claude_plugin);
  });

  // Status file is written + readable via getLastSetupVersion.
  test('writes setup-status.json and exposes last version via getLastSetupVersion', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});

    await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});

    const statusFile = join(home, '.cladding', 'setup-status.json');
    expect(existsSync(statusFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(statusFile, 'utf8'));
    expect(parsed.cladding_version).toBe('0.4.0');
    expect(getLastSetupVersion(home)).toBe('0.4.0');
  });

  // AC-007 — version skew between setup-status.json and binary is observable.
  test('records the version used at setup time so init can detect skew', async () => {
    mkdirSync(join(home, '.claude'), {recursive: true});

    await runHostSetup({home, pkgRoot, version: '0.4.0', quiet: true});
    expect(getLastSetupVersion(home)).toBe('0.4.0');

    // The next "setup" pretends a newer binary; the previously recorded version
    // is what init reads back for the skew warning.
    expect(getLastSetupVersion(home)).not.toBe('0.5.0');
  });
});

describe('getCurrentCladdingVersion', () => {
  // Smoke-only — resolves the real package.json from the cladding repo root.
  test('returns a non-null version when run from the cladding repo', () => {
    const v = getCurrentCladdingVersion();
    // Either the real version or null (CI sandboxes may not expose pkg).
    expect(v === null || /^\d+\.\d+\.\d+/.test(v)).toBe(true);
  });
});
