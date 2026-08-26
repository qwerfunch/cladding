// Cladding · project-scoped setup and legacy-global migration tests.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  getCurrentCladdingVersion,
  getLastSetupVersion,
  renderSetupReport,
  runHostSetup,
} from '../../src/init/host-setup.js';
import {hostWireNotice} from '../../src/cli/init.js';

describe('project-scoped runHostSetup', () => {
  let home: string;
  let project: string;
  let pkgRoot: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'clad-home-'));
    // Seed every host's home marker so default detection selects all five
    // channels (AC-001: wire only detected hosts).
    for (const marker of ['.claude', '.codex', join('.gemini', 'config'), '.cursor', '.agents']) {
      mkdirSync(join(home, marker), {recursive: true});
    }
    project = mkdtempSync(join(tmpdir(), 'clad-project-'));
    pkgRoot = mkdtempSync(join(tmpdir(), 'clad-pkg-'));
    mkdirSync(join(pkgRoot, 'dist'), {recursive: true});
    mkdirSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'init'), {recursive: true});
    writeFileSync(join(pkgRoot, 'dist', 'clad.js'), 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
    writeFileSync(join(pkgRoot, 'package.json'), JSON.stringify({name: 'cladding', version: '0.9.0'}));
    writeFileSync(
      join(pkgRoot, 'plugins', 'codex', 'skills', 'init', 'SKILL.md'),
      '---\nname: init\ndescription: Use only when the user explicitly names Cladding and asks to initialize it.\n---\n\n# Cladding init\n',
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
    expect(existsSync(join(project, '.gemini', 'settings.json'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'mcp_config.json'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(project, '.cursor', 'cli.json'))).toBe(true);
    expect(existsSync(join(project, '.cladding', 'host', 'gemini-doctor-policy.toml'))).toBe(true);
    expect(existsSync(join(project, '.mcp.json'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.claude', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.gemini', 'skills'))).toBe(false);
    expect(readFileSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'), 'utf8'))
      .toContain('name: cladding-init');
    expect(existsSync(join(project, '.cursor', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    // Home gains ONLY the Antigravity machine-wide wire (agy reads no project
    // MCP config — verified live); every other host stays project-local.
    expect(existsSync(join(home, '.agents', 'skills'))).toBe(false);
    expect(existsSync(join(home, '.codex', 'config.toml'))).toBe(false);
    expect(existsSync(join(home, '.gemini', 'settings.json'))).toBe(false);
    const agyWire = join(home, '.gemini', 'config', 'plugins', 'cladding');
    expect(existsSync(join(agyWire, 'plugin.json'))).toBe(true);
    const agyMcp = JSON.parse(readFileSync(join(agyWire, 'mcp_config.json'), 'utf8'));
    expect(agyMcp.mcpServers.cladding.args).toEqual([join(pkgRoot, 'dist', 'clad.js'), 'serve']);
  });

  test('resolves the engine version from a Claude cache that has no package.json', () => {
    rmSync(join(pkgRoot, 'package.json'));
    mkdirSync(join(pkgRoot, '.claude-plugin'), {recursive: true});
    writeFileSync(
      join(pkgRoot, '.claude-plugin', 'plugin.json'),
      `${JSON.stringify({name: 'claude-code', version: '0.9.4'})}\n`,
      'utf8',
    );
    expect(getCurrentCladdingVersion(pkgRoot)).toBe('0.9.4');
  });

  test('default detection wires nothing on a machine with no supported host', async () => {
    const bareHome = mkdtempSync(join(tmpdir(), 'clad-barehome-'));
    try {
      const result = await runHostSetup({home: bareHome, projectRoot: project, pkgRoot, quiet: true, activate: false});
      expect(result.wiring.claude).toBe('skipped-not-selected');
      expect(result.wiring.codex).toBe('skipped-not-selected');
      expect(result.wiring.gemini).toBe('skipped-not-selected');
      expect(result.wiring.antigravity).toBe('skipped-not-selected');
      expect(result.wiring.cursor).toBe('skipped-not-selected');
      expect(existsSync(join(project, '.codex'))).toBe(false);
      expect(existsSync(join(project, '.cursor'))).toBe(false);
      expect(result.warnings.some((w) => w.step === 'hosts')).toBe(true);
      // The shared runtime still lands, so explicit wiring stays one command away.
      expect(existsSync(join(project, '.cladding', 'host', 'serve.cjs'))).toBe(true);
    } finally {
      rmSync(bareHome, {recursive: true, force: true});
    }
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
    const gemini = readFileSync(join(project, '.gemini', 'settings.json'), 'utf8');
    const cursor = readFileSync(join(project, '.cursor', 'mcp.json'), 'utf8');
    const cursorCli = readFileSync(join(project, '.cursor', 'cli.json'), 'utf8');
    const runtime = readFileSync(join(project, '.cladding', 'host', 'serve.cjs'), 'utf8');
    const geminiPolicy = readFileSync(
      join(project, '.cladding', 'host', 'gemini-doctor-policy.toml'),
      'utf8',
    );
    expect(codex).toContain('.cladding/host/serve.cjs');
    expect(codex).toContain('default_tools_approval_mode = "writes"');
    expect(gemini).toContain('.cladding/host/serve.cjs');
    expect(cursor).toContain('.cladding/host/serve.cjs');
    expect(cursorCli).toContain('Mcp(cladding:clad_list_features)');
    expect(cursorCli).toContain('Mcp(cladding:clad_get_feature)');
    expect(cursorCli).toContain('Mcp(cladding:clad_run_check)');
    expect(cursorCli).not.toContain('Mcp(cladding:*)');
    expect(JSON.parse(cursorCli).permissions.deny).toEqual([]);
    expect(codex).not.toContain(pkgRoot);
    expect(runtime).toContain(join(pkgRoot, 'dist', 'clad.js'));
    expect(geminiPolicy).toContain('toolAnnotations = { readOnlyHint = true }');
    expect(geminiPolicy).toContain('modes = ["plan"]');
    expect(geminiPolicy).toContain('toolName = "exit_plan_mode"');
    expect(geminiPolicy).toMatch(/mcpName = "cladding"[\s\S]*toolName = "\*"[\s\S]*decision = "deny"/);
    expect(geminiPolicy).not.toContain('yolo');
  });

  test('project runtime pins MCP and shell commands to the same engine', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    const runtime = join(project, '.cladding', 'host', 'serve.cjs');
    const mcp = spawnSync(process.execPath, [runtime], {cwd: project, encoding: 'utf8'});
    const cli = spawnSync(process.execPath, [runtime, 'check', '--strict'], {cwd: project, encoding: 'utf8'});

    expect(mcp.status).toBe(0);
    expect(mcp.stdout).toBe('["serve"]');
    expect(cli.status).toBe(0);
    expect(cli.stdout).toBe('["check","--strict"]');
  });

  test('is idempotent and stores setup status under the project', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, version: '0.9.0', quiet: true, activate: false});
    const second = await runHostSetup({home, projectRoot: project, pkgRoot, version: '0.9.0', quiet: true, activate: false});

    expect(second.wiring.runtime).toBe('unchanged');
    expect(second.wiring.codex).toBe('unchanged');
    expect(second.wiring.gemini).toBe('unchanged');
    expect(second.wiring.cursor).toBe('unchanged');
    expect(getLastSetupVersion(project)).toBe('0.9.0');
    expect(second.statusFile).toBe(join(resolve(project), '.cladding', 'setup-status.json'));
  });

  test('one-host setup limits the generated surfaces', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['codex'], quiet: true, activate: false});

    expect(existsSync(join(project, '.codex', 'config.toml'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.cursor'))).toBe(false);
    expect(existsSync(join(project, '.cladding', 'host', 'gemini-doctor-policy.toml'))).toBe(false);
    expect(existsSync(join(project, '.mcp.json'))).toBe(false);
  });

  test('Gemini-only setup writes the shared project skill and Gemini MCP settings only', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['gemini'], quiet: true, activate: false});

    expect(existsSync(join(project, '.gemini', 'settings.json'))).toBe(true);
    expect(existsSync(join(project, '.cladding', 'host', 'gemini-doctor-policy.toml'))).toBe(true);
    expect(existsSync(join(project, '.agents', 'skills', 'cladding-init', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.codex'))).toBe(false);
    expect(existsSync(join(project, '.cursor'))).toBe(false);
    expect(existsSync(join(project, '.mcp.json'))).toBe(false);
  });

  test('Gemini setup preserves unrelated settings and MCP servers', async () => {
    mkdirSync(join(project, '.gemini'), {recursive: true});
    writeFileSync(
      join(project, '.gemini', 'settings.json'),
      JSON.stringify({theme: 'system', mcpServers: {other: {command: 'other'}}}),
    );

    await runHostSetup({home, projectRoot: project, pkgRoot, hosts: ['gemini'], quiet: true, activate: false});

    const settings = JSON.parse(readFileSync(join(project, '.gemini', 'settings.json'), 'utf8')) as {
      theme?: string;
      mcpServers?: Record<string, {command?: string; args?: string[]}>;
    };
    expect(settings.theme).toBe('system');
    expect(settings.mcpServers?.other?.command).toBe('other');
    expect(settings.mcpServers?.cladding?.args).toEqual(['.cladding/host/serve.cjs']);
  });

  test('Gemini setup preserves a conflicting Cladding entry unless force is explicit', async () => {
    mkdirSync(join(project, '.gemini'), {recursive: true});
    const settingsPath = join(project, '.gemini', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({mcpServers: {cladding: {command: 'custom'}}}));

    const safe = await runHostSetup({
      home,
      projectRoot: project,
      pkgRoot,
      hosts: ['gemini'],
      quiet: true,
      activate: false,
    });
    expect(safe.wiring.gemini).toBe('skipped-different');
    expect(readFileSync(settingsPath, 'utf8')).toContain('custom');

    const forced = await runHostSetup({
      home,
      projectRoot: project,
      pkgRoot,
      hosts: ['gemini'],
      force: true,
      quiet: true,
      activate: false,
    });
    expect(['created', 'rewired']).toContain(forced.wiring.gemini);
    expect(readFileSync(settingsPath, 'utf8')).toContain('.cladding/host/serve.cjs');
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

  test('Cursor permissions preserve unrelated allow and deny entries', async () => {
    mkdirSync(join(project, '.cursor'), {recursive: true});
    writeFileSync(
      join(project, '.cursor', 'cli.json'),
      JSON.stringify({permissions: {allow: ['Shell(git)'], deny: ['Shell(rm)']}, theme: 'dark'}),
    );

    await runHostSetup({
      home,
      projectRoot: project,
      pkgRoot,
      hosts: ['cursor'],
      quiet: true,
      activate: false,
    });

    const config = JSON.parse(readFileSync(join(project, '.cursor', 'cli.json'), 'utf8')) as {
      permissions: {allow: string[]; deny: string[]};
      theme: string;
    };
    expect(config.theme).toBe('dark');
    expect(config.permissions.deny).toEqual(['Shell(rm)']);
    expect(config.permissions.allow).toEqual([
      'Shell(git)',
      'Mcp(cladding:clad_list_features)',
      'Mcp(cladding:clad_get_feature)',
      'Mcp(cladding:clad_run_check)',
    ]);
  });

  test('removes only provably-owned legacy global wires', async () => {
    mkdirSync(join(home, '.agents', 'skills'), {recursive: true});
    mkdirSync(join(home, '.gemini', 'config', 'plugins'), {recursive: true});
    mkdirSync(join(home, '.gemini', 'extensions'), {recursive: true});
    symlinkSync(join(pkgRoot, 'plugins', 'codex', 'skills', 'init'), join(home, '.agents', 'skills', 'cladding-init'));
    symlinkSync(pkgRoot, join(home, '.gemini', 'config', 'plugins', 'cladding'));
    symlinkSync(pkgRoot, join(home, '.gemini', 'extensions', 'cladding'));
    mkdirSync(join(home, '.codex'), {recursive: true});
    writeFileSync(
      join(home, '.codex', 'config.toml'),
      `[mcp_servers.other]\ncommand = "other"\n\n[mcp_servers.cladding]\ncommand = "node"\nargs = [${JSON.stringify(join(pkgRoot, 'dist', 'clad.js'))}, "serve"]\n`,
    );

    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});

    expect(result.legacyCleanup.codex_skills).toBe('removed');
    expect(result.legacyCleanup.gemini_extension).toBe('removed');
    expect(result.legacyCleanup.antigravity_plugin).toBe('removed');
    expect(result.legacyCleanup.codex_mcp).toBe('removed');
    expect(existsSync(join(home, '.agents', 'skills', 'cladding-init'))).toBe(false);
    expect(existsSync(join(home, '.gemini', 'extensions', 'cladding'))).toBe(false);
    expect(readFileSync(join(home, '.codex', 'config.toml'), 'utf8')).toContain('other');
  });

  test('delta-wires a host that appears after the first run, leaving wired ones untouched', async () => {
    rmSync(join(home, '.cursor'), {recursive: true, force: true});
    const first = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    expect(first.wiring.cursor).toBe('skipped-not-selected');
    expect(existsSync(join(project, '.cursor'))).toBe(false);

    mkdirSync(join(home, '.cursor'), {recursive: true});
    const second = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    expect(second.wiring.cursor).toBe('created');
    expect(second.wiring.codex).toBe('unchanged');
    expect(existsSync(join(project, '.cursor', 'mcp.json'))).toBe(true);
  });

  test('re-wires the project runtime when the engine root changes (upgrade path)', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    const pkgRoot2 = mkdtempSync(join(tmpdir(), 'clad-pkg2-'));
    try {
      mkdirSync(join(pkgRoot2, 'dist'), {recursive: true});
      mkdirSync(join(pkgRoot2, 'plugins', 'codex', 'skills', 'init'), {recursive: true});
      writeFileSync(join(pkgRoot2, 'dist', 'clad.js'), 'process.stdout.write("v2");\n');
      writeFileSync(join(pkgRoot2, 'package.json'), JSON.stringify({name: 'cladding', version: '0.9.1'}));
      writeFileSync(join(pkgRoot2, 'plugins', 'codex', 'skills', 'init', 'SKILL.md'), '---\nname: init\ndescription: x\n---\n');

      const result = await runHostSetup({home, projectRoot: project, pkgRoot: pkgRoot2, quiet: true, activate: false});
      expect(result.wiring.runtime).toBe('rewired');
      expect(readFileSync(join(project, '.cladding', 'host', 'serve.cjs'), 'utf8'))
        .toContain(join(pkgRoot2, 'dist', 'clad.js'));
    } finally {
      rmSync(pkgRoot2, {recursive: true, force: true});
    }
  });

  test('re-creates a deleted project runtime as a repair, no separate flag', async () => {
    await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    rmSync(join(project, '.cladding', 'host', 'serve.cjs'));
    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
    expect(result.wiring.runtime).toBe('created');
    expect(existsSync(join(project, '.cladding', 'host', 'serve.cjs'))).toBe(true);
  });

  test('hostWireNotice guides toward clad setup and surfaces version skew without blocking', () => {
    expect(hostWireNotice(null, '0.9.0')).toContain('clad setup');
    const skew = hostWireNotice('0.8.3', '0.9.0');
    expect(skew).toContain('0.8.3');
    expect(skew).toContain('0.9.0');
    expect(hostWireNotice('0.9.0', '0.9.0')).toBeNull();
  });

  test('codex legacy cleanup preserves user comments and formatting outside the cladding entry', async () => {
    mkdirSync(join(home, '.codex'), {recursive: true});
    const before = [
      '# precious top comment',
      'model = "gpt-x" # inline note',
      '',
      '[mcp_servers.other]',
      'command = "other"',
      '',
      '# cladding block below',
      '[mcp_servers.cladding]',
      'command = "node"',
      `args = [${JSON.stringify(join(pkgRoot, 'dist', 'clad.js'))}, "serve"]`,
      '',
    ].join('\n');
    writeFileSync(join(home, '.codex', 'config.toml'), before);

    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false, hosts: ['claude']});

    expect(result.legacyCleanup.codex_mcp).toBe('removed');
    const after = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
    expect(after).toContain('# precious top comment');
    expect(after).toContain('model = "gpt-x" # inline note');
    expect(after).toContain('[mcp_servers.other]');
    // The section is gone; user prose (even a comment mentioning cladding) stays.
    expect(after).not.toContain('[mcp_servers.cladding]');
    expect(after).not.toContain('dist/clad.js');
    expect(after).toContain('# cladding block below');
  });

  test('cursor legacy cleanup drops an emptied mcpServers object instead of leaving an orphan', async () => {
    mkdirSync(join(home, '.cursor'), {recursive: true});
    writeFileSync(join(home, '.cursor', 'mcp.json'), `${JSON.stringify({
      mcpServers: {cladding: {command: 'node', args: [join(pkgRoot, 'dist', 'clad.js'), 'serve']}},
    }, null, 2)}\n`);

    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false, hosts: ['claude']});

    expect(result.legacyCleanup.cursor_mcp).toBe('removed');
    const after = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'));
    expect(after.mcpServers).toBeUndefined();
  });

  test('a foreign real directory at the antigravity plugin path is preserved and reported', async () => {
    const dir = join(home, '.gemini', 'config', 'plugins', 'cladding');
    mkdirSync(dir, {recursive: true});
    writeFileSync(join(dir, 'mcp_config.json'), `${JSON.stringify({
      mcpServers: {cladding: {command: 'node', args: ['/somewhere/else/engine.js', 'serve']}},
    }, null, 2)}\n`);

    const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false, hosts: ['antigravity']});

    expect(result.legacyCleanup.antigravity_plugin).toBe('skipped-different');
    expect(result.wiring.antigravity).toBe('skipped-different');
    const kept = JSON.parse(readFileSync(join(dir, 'mcp_config.json'), 'utf8'));
    expect(kept.mcpServers.cladding.args[0]).toBe('/somewhere/else/engine.js');
  });

  test('preserves unowned global files with Cladding-like names', async () => {
    const custom = mkdtempSync(join(tmpdir(), 'custom-plugin-'));
    try {
      mkdirSync(join(home, '.agents', 'skills'), {recursive: true});
      mkdirSync(join(home, '.gemini', 'extensions'), {recursive: true});
      symlinkSync(custom, join(home, '.agents', 'skills', 'cladding-custom'));
      symlinkSync(custom, join(home, '.gemini', 'extensions', 'cladding'));
      const result = await runHostSetup({home, projectRoot: project, pkgRoot, quiet: true, activate: false});
      expect(result.legacyCleanup.codex_skills).toBe('skipped-different');
      expect(result.legacyCleanup.gemini_extension).toBe('skipped-different');
      expect(resolve(readlinkSync(join(home, '.agents', 'skills', 'cladding-custom')))).toBe(resolve(custom));
      expect(resolve(readlinkSync(join(home, '.gemini', 'extensions', 'cladding')))).toBe(resolve(custom));
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
