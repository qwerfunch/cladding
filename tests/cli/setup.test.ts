// Cladding · project-scoped setup and legacy-global migration tests.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {getLastSetupVersion, renderSetupReport, runHostSetup} from '../../src/init/host-setup.js';

describe('project-scoped runHostSetup', () => {
  let home: string;
  let project: string;
  let pkgRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'clad-home-'));
    project = mkdtempSync(join(tmpdir(), 'clad-project-'));
    pkgRoot = mkdtempSync(join(tmpdir(), 'clad-pkg-'));
    mkdirSync(join(pkgRoot, 'dist'), {recursive: true});
    mkdirSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'init'), {recursive: true});
    writeFileSync(join(pkgRoot, 'dist', 'clad.js'), '#!/usr/bin/env node\n');
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({name: 'cladding', version: '0.9.0'}));
    writeFileSync(
      join(pkgRoot, 'plugins', 'codex', 'skills', 'init', 'SKILL.md'),
      '---\ndescription: Use only when the user explicitly names Cladding and asks to initialize it.\n---\n\n# Cladding init\n',
    );
  });

  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
    rmSync(project, {recursive: true, force: true});
    rmSync(pkgRoot, {recursive: true, force: true});
  });

  test('writes only project-local host discovery files', async () => {
    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    expect(result.errors).toEqual([]);
    expect(existsSync(join(project, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'mcp_config.json'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(project, '.mcp.json'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(home, '.agents'))).toBe(false);
    expect(existsSync(join(home, '.codex'))).toBe(false);
  });

  test('keeps machine-specific runtime state out of a Git worktree', async () => {
    mkdirSync(join(project, '.git', 'info'), {recursive: true});
    writeFileSync(join(project, '.git', 'info', 'exclude'), '# local excludes\n', 'utf8');

    await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    const exclude = readFileSync(join(project, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude).toContain('/.cladding/host/');
    expect(exclude).toContain('/.cladding/setup-status.json');
  });

  test('host configs use the portable project runtime rather than an npm absolute path', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    const codex = readFileSync(join(project, '.codex', 'config.toml'), 'utf8');
    const cursor = readFileSync(join(project, '.cursor', 'mcp.json'), 'utf8');
    const runtime = readFileSync(join(project, '.cladding', 'host', 'serve.cjs'), 'utf8');
    expect(codex).toContain('.cladding/host/serve.cjs');
    expect(cursor).toContain('.cladding/host/serve.cjs');
    expect(codex).not.toContain(pkgRoot);
    expect(runtime).toContain(join(pkgRoot, 'dist', 'clad.js'));
  });

  test('is idempotent and stores setup status under the project', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, version: '0.9.0', quiet: true, activate: false});
    const second = await runHostSetup({home, projectRoot: project, pkgRoot, version: '0.9.0', quiet: true, activate: false});

    expect(second.wiring.runtime).toBe('unchanged');
    expect(second.wiring.codex).toBe('unchanged');
    expect(second.wiring.cursor).toBe('unchanged');
    expect(getLastSetupVersion(project)).toBe('0.9.0');
    expect(second.statusFile).toBe(join(resolve(project), '.cladding', 'setup-status.json'));
  });

  test('one-host setup limits the generated surfaces', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['codex'], quiet: true, activate: false});

    expect(existsSync(join(project, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.cursor'))).toBe(false);
    expect(existsSync(join(project, '.mcp.json'))).toBe(false);
  });

  test('preserves a conflicting user MCP entry unless force is explicit', async () => {
    mkdirSync(join(project, '.cursor'), {recursive: true});
    writeFileSync(join(project, '.cursor', 'mcp.json'), JSON.stringify({mcpServers: {cladding: {command: 'custom'}}}));

    const safe = await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['cursor'], quiet: true, activate: false});
    expect(safe.wiring.cursor).toBe('skipped-different');
    expect(readFileSync(join(project, '.cursor', 'mcp.json'), 'utf8')).toContain('custom');

    const forced = await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['cursor'], force: true, quiet: true, activate: false});
    expect(['created', 'rewired']).toContain(forced.wiring.cursor);
    expect(readFileSync(join(project, '.cursor', 'mcp.json'), 'utf8')).toContain('.cladding/host/serve.cjs');
  });

  test('removes only provably-owned legacy global wires', async () => {
    mkdirSync(join(home, '.agents', 'skills'), {recursive: true});
    mkdirSync(join(home, '.gemini', 'config', 'plugins'), {recursive: true});
    symlinkSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'init'), join(home, '.agents', 'skills', 'cladding-init'));
    symlinkSync(pkgRoot, join(home, '.gemini', 'config', 'plugins', 'cladding'));
    mkdirSync(join(home, '.codex'), {recursive: true});
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      `[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.cladding]\ncommand = "node"\nargs = [${JSON.stringify(join(pkgRoot, 'dist', 'clad.js'))}, "serve"]\n`,
    );

    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    expect(result.legacyCleanup.codex_skills).toBe('removed');
    expect(result.legacyCleanup.antigravity_plugin).toBe('removed');
    expect(result.legacyCleanup.codex_mcp).toBe('removed');
    expect(existsSync(join(home, '.agents', 'skills', 'cladding-init'))).toBe(false);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain('other');
  });

  test('preserves unowned global files with Cladding-like names', async () => {
    const custom = mkdtempSync(join(tmpdir(), 'custom-plugin-'));
    try {
      mkdirSync(join(home, '.agents', 'skills'), {recursive: true});
      symlinkSync(custom, join(home, '.agents', 'skills', 'cladding-custom'));
      const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
      expect(result.legacyCleanup.codex_skills).toBe('skipped-different');
      expect(resolve(readlinkSync(join(home, '.agents', 'skills', 'cladding-custom')))).toBe(resolve(custom));
    } finally {
      rmSync(custom, {recursive: true, force: true});
    }
  });

  test('report explains the project boundary and normal post-init development', async () => {
    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    const report = renderSetupReport(result);
    expect(report).toContain('project activation');
    expect(report).toContain('Start a new AI session in this project directory');
    expect(report).toContain('After initialization, develop normally in natural language');
  });
});
