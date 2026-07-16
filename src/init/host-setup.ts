// F-80d19d / F-0f4dd6 — explicit, project-scoped host setup.
//
// Installing the CLI globally must not make Cladding visible to every AI
// session on the machine. `clad setup` therefore writes only project-local
// discovery files. A small ignored launcher carries the machine-specific
// package path; the checked-in host configs remain portable.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {homedir, platform} from 'node:os';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export type ChannelResult =
  | 'created'
  | 'unchanged'
  | 'rewired'
  | 'removed'
  | 'skipped-different'
  | 'skipped-not-installed'
  | 'manual-required'
  | 'failed';

export type SetupHost = 'claude' | 'codex' | 'gemini' | 'antigravity' | 'cursor';

export interface HostDetection {
  readonly claude: boolean;
  readonly gemini: boolean;
  readonly antigravity: boolean;
  readonly codex: boolean;
  readonly agents: boolean;
  readonly cursor: boolean;
}

export interface SetupResult {
  readonly projectRoot: string;
  readonly wiring: {
    readonly runtime: ChannelResult;
    readonly shared_init_skill: ChannelResult;
    readonly claude: ChannelResult;
    readonly codex: ChannelResult;
    readonly gemini: ChannelResult;
    readonly antigravity: ChannelResult;
    readonly cursor: ChannelResult;
  };
  readonly legacyCleanup: {
    readonly claude_plugin: ChannelResult;
    readonly gemini_extension: ChannelResult;
    readonly antigravity_plugin: ChannelResult;
    readonly codex_skills: ChannelResult;
    readonly codex_mcp: ChannelResult;
    readonly cursor_mcp: ChannelResult;
  };
  readonly errors: ReadonlyArray<{step: string; message: string}>;
  readonly warnings: ReadonlyArray<{step: string; message: string}>;
  readonly statusFile: string;
  readonly cladding_root: string;
  readonly cladding_version: string;
  readonly last_setup_version: string | null;
}

export interface SetupOptions {
  readonly force?: boolean;
  readonly quiet?: boolean;
  readonly home?: string;
  readonly pkgRoot?: string;
  readonly projectRoot?: string;
  readonly version?: string;
  readonly hosts?: readonly SetupHost[];
  /** Host CLI cleanup is disabled by tests so no developer configuration is touched. */
  readonly activate?: boolean;
}

interface SetupStatus {
  readonly project_root: string;
  readonly cladding_root: string;
  readonly cladding_version: string;
  readonly last_run: string;
}

const STATUS_FILENAME = 'setup-status.json';
const RUNTIME_RELATIVE = join('.cladding', 'host', 'serve.cjs');
/**
 * Project-local Gemini policy used only by the explicitly consented read-only host smoke.
 *
 * @see spec/features/host-smoke-matrix-5283985e.yaml AC-4a71e2
 */
export const GEMINI_DOCTOR_POLICY_RELATIVE = '.cladding/host/gemini-doctor-policy.toml';
const ALL_HOSTS: readonly SetupHost[] = ['claude', 'codex', 'gemini', 'antigravity', 'cursor'];
const CURSOR_READONLY_MCP_PERMISSIONS = [
  'Mcp(cladding:clad_list_features)',
  'Mcp(cladding:clad_get_feature)',
  'Mcp(cladding:clad_run_check)',
] as const;

function ensureDir(path: string): void {
  mkdirSync(path, {recursive: true});
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function writeIfChanged(path: string, body: string): ChannelResult {
  const previous = readText(path);
  if (previous === body) return 'unchanged';
  ensureDir(dirname(path));
  writeFileSync(path, body, 'utf8');
  return previous == null ? 'created' : 'rewired';
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function resolvedSymlink(path: string): string | null {
  try {
    return resolve(dirname(path), readlinkSync(path));
  } catch {
    return null;
  }
}

function pathInside(path: string, root: string): boolean {
  const delta = relative(resolve(root), resolve(path));
  return delta === '' || (!delta.startsWith('..') && !isAbsolute(delta));
}

function knownRoots(home: string, pkgRoot: string): string[] {
  const roots = [resolve(pkgRoot)];
  const legacy = readText(join(home, '.cladding', STATUS_FILENAME));
  if (legacy) {
    try {
      const parsed = JSON.parse(legacy) as {cladding_root?: unknown};
      if (typeof parsed.cladding_root === 'string') roots.push(resolve(parsed.cladding_root));
    } catch {
      // A malformed advisory status file cannot establish ownership.
    }
  }
  return [...new Set(roots)];
}

function removeOwnedSymlink(path: string, roots: readonly string[]): ChannelResult {
  if (!existsSync(path) && !isSymlink(path)) return 'unchanged';
  if (!isSymlink(path)) return 'skipped-different';
  const target = resolvedSymlink(path);
  if (!target || !roots.some((root) => pathInside(target, root))) return 'skipped-different';
  try {
    rmSync(path, {force: true});
    return 'removed';
  } catch {
    return 'failed';
  }
}

function removeOwnedCodexSkills(home: string, roots: readonly string[]): ChannelResult {
  const skillsRoot = join(home, '.agents', 'skills');
  if (!existsSync(skillsRoot)) return 'unchanged';
  let removed = 0;
  let conflicts = 0;
  for (const name of readdirSync(skillsRoot)) {
    if (!name.startsWith('cladding-')) continue;
    const result = removeOwnedSymlink(join(skillsRoot, name), roots);
    if (result === 'removed') removed++;
    if (result === 'skipped-different') conflicts++;
  }
  if (conflicts > 0) return 'skipped-different';
  return removed > 0 ? 'removed' : 'unchanged';
}

function isKnownLaunch(value: unknown, roots: readonly string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  const entry = value as {command?: unknown; args?: unknown; description?: unknown};
  const args = Array.isArray(entry.args) ? entry.args : [];
  if (entry.command === 'clad' && args[0] === 'serve') return true;
  if (typeof entry.description === 'string' && entry.description.includes('wired by `clad setup`')) return true;
  if (typeof entry.description === 'string' && entry.description.includes('project-scoped by `clad setup`')) return true;
  if (entry.command === 'node' && args[0] === RUNTIME_RELATIVE) return true;
  return entry.command === 'node' && typeof args[0] === 'string' && roots.some((root) => pathInside(args[0] as string, root));
}

/**
 * Deletes the `[mcp_servers.cladding]` section from the raw TOML text without
 * re-serializing the document, so the user's comments, ordering, and formatting
 * everywhere else survive. Returns null when the section boundaries cannot be
 * identified textually (caller falls back to the lossy stringify path).
 */
function spliceTomlSection(raw: string, header: string): string | null {
  const lines = raw.split('\n');
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith('[') && !t.startsWith('#')) {
      end = i;
      break;
    }
  }
  // Also drop blank lines directly above the removed section so no gap pile-up.
  let cut = start;
  while (cut > 0 && lines[cut - 1].trim() === '') cut--;
  return [...lines.slice(0, cut), ...lines.slice(end)].join('\n');
}

async function removeOwnedCodexMcp(home: string, roots: readonly string[]): Promise<ChannelResult> {
  const path = join(home, '.codex', 'config.toml');
  const raw = readText(path);
  if (raw == null) return 'unchanged';
  try {
    const {parse, stringify} = await import('smol-toml');
    const doc = parse(raw) as Record<string, unknown>;
    const servers = doc.mcp_servers as Record<string, unknown> | undefined;
    if (!servers?.cladding) return 'unchanged';
    if (!isKnownLaunch(servers.cladding, roots)) return 'skipped-different';
    delete servers.cladding;
    if (Object.keys(servers).length === 0) delete doc.mcp_servers;
    // Prefer a text-level splice (preserves the user's comments/format across
    // the rest of the file); verify by parsing before trusting it, and fall
    // back to the canonical re-serialization only when the splice is unsound.
    const spliced = spliceTomlSection(raw, '[mcp_servers.cladding]');
    if (spliced != null) {
      try {
        if (JSON.stringify(parse(spliced)) === JSON.stringify(doc)) {
          writeFileSync(path, spliced, 'utf8');
          return 'removed';
        }
      } catch {
        // fall through to the stringify path
      }
    }
    writeFileSync(path, stringify(doc), 'utf8');
    return 'removed';
  } catch {
    return 'failed';
  }
}

function removeOwnedCursorMcp(home: string, roots: readonly string[]): ChannelResult {
  const path = join(home, '.cursor', 'mcp.json');
  const raw = readText(path);
  if (raw == null) return 'unchanged';
  try {
    const doc = JSON.parse(raw) as Record<string, unknown>;
    const servers = doc.mcpServers as Record<string, unknown> | undefined;
    if (!servers?.cladding) return 'unchanged';
    if (!isKnownLaunch(servers.cladding, roots)) return 'skipped-different';
    delete servers.cladding;
    if (Object.keys(servers).length === 0) delete doc.mcpServers;
    writeFileSync(path, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    return 'removed';
  } catch {
    return 'failed';
  }
}

/**
 * Antigravity (agy 1.1.x) reads MCP config ONLY from machine-wide locations
 * (`~/.gemini/config/mcp_config.json` or `~/.gemini/config/plugins/<name>/`),
 * never from the project — verified live in the 0.9.0 E2E campaign. It does
 * spawn MCP servers with the session's working directory, so one machine-wide
 * wire pointing at the engine stays project-aware. This is the one deliberate
 * exception to project-local activation, and the setup report says so.
 */
function wireAntigravityGlobal(home: string, pkgRoot: string, force: boolean): ChannelResult {
  const dir = join(home, '.gemini', 'config', 'plugins', 'cladding');
  // An unowned legacy symlink survived cleanup — never write through it.
  if (isSymlink(dir)) return 'skipped-different';
  const launch = {command: 'node', args: [join(pkgRoot, 'dist', 'clad.js'), 'serve']};
  const mcp = mergeJsonMcp(join(dir, 'mcp_config.json'), launch, force);
  if (mcp === 'skipped-different' || mcp === 'failed') return mcp;
  const manifest = `${JSON.stringify({
    $schema: 'https://antigravity.google/schemas/v1/plugin.json',
    name: 'cladding',
    description: 'Spec-driven verification and onboarding for Antigravity CLI (machine-wide MCP wire; the project is resolved from each session’s working directory).',
  }, null, 2)}\n`;
  return combine([mcp, writeIfChanged(join(dir, 'plugin.json'), manifest)]);
}

/**
 * Legacy-cleanup gate for `~/.gemini/config/plugins/cladding`: the pre-0.9.0
 * install left a SYMLINK here (owned → removed); 0.9.0 setup writes a REAL
 * directory as the managed Antigravity wire (recognized launch → kept). A real
 * directory with an unrecognized launch is foreign and is never removed.
 */
function cleanupAntigravityPlugin(home: string, roots: readonly string[]): ChannelResult {
  const dir = join(home, '.gemini', 'config', 'plugins', 'cladding');
  if (isSymlink(dir)) return removeOwnedSymlink(dir, roots);
  const cfg = readText(join(dir, 'mcp_config.json'));
  if (cfg == null) return 'unchanged';
  try {
    const servers = (JSON.parse(cfg) as {mcpServers?: Record<string, unknown>}).mcpServers;
    if (servers?.cladding && !isKnownLaunch(servers.cladding, roots)) return 'skipped-different';
    return 'unchanged';
  } catch {
    return 'skipped-different';
  }
}

function detectBinary(name: string): boolean {
  const command = platform() === 'win32' ? 'where' : 'which';
  return spawnSync(command, [name], {stdio: 'ignore'}).status === 0;
}

function cleanupClaudeUserPlugin(enabled: boolean): ChannelResult {
  if (!enabled || !detectBinary('claude')) return 'manual-required';
  const result = spawnSync(
    'claude',
    ['plugin', 'uninstall', 'claude-code@cladding', '--scope', 'user', '--keep-data'],
    {encoding: 'utf8', timeout: 30_000, shell: platform() === 'win32'},
  );
  if (result.status === 0) return 'removed';
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  return /not installed|not found/i.test(combined) ? 'unchanged' : 'manual-required';
}

function runtimeBody(pkgRoot: string): string {
  const engine = join(pkgRoot, 'dist', 'clad.js');
  return [
    "'use strict';",
    "const {spawn} = require('node:child_process');",
    `const engine = ${JSON.stringify(engine)};`,
    "const requested = process.argv.slice(2);",
    "const args = requested.length > 0 ? requested : ['serve'];",
    "const child = spawn(process.execPath, [engine, ...args], {cwd: process.cwd(), stdio: 'inherit'});",
    "for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));",
    "child.on('error', (error) => { console.error(`cladding project launcher: ${error.message}`); process.exitCode = 1; });",
    "child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });",
    '',
  ].join('\n');
}

/** Allow only the annotated read-only doctor surfaces while Gemini is in Plan Mode. */
function geminiDoctorPolicyBody(): string {
  return [
    '[[rule]]',
    'mcpName = "cladding"',
    'toolName = "*"',
    'decision = "deny"',
    'priority = 100',
    'modes = ["plan"]',
    'interactive = false',
    '',
    '[[rule]]',
    'mcpName = "cladding"',
    'toolName = ["clad_list_features", "clad_get_feature", "clad_run_check"]',
    'toolAnnotations = { readOnlyHint = true }',
    'decision = "allow"',
    'priority = 200',
    'modes = ["plan"]',
    'interactive = false',
    '',
    '[[rule]]',
    'toolName = "exit_plan_mode"',
    'decision = "deny"',
    'priority = 200',
    'modes = ["plan"]',
    'interactive = false',
    '',
  ].join('\n');
}

/** Keep machine-specific setup state out of a Git worktree without editing the shared .gitignore. */
function ignoreLocalRuntime(projectRoot: string): void {
  const exclude = join(projectRoot, '.git', 'info', 'exclude');
  if (!existsSync(dirname(exclude))) return;
  const entries = ['/.cladding/host/', '/.cladding/setup-status.json'];
  const current = readText(exclude) ?? '';
  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (missing.length === 0) return;
  const separator = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
  writeFileSync(exclude, `${current}${separator}${missing.join('\n')}\n`, 'utf8');
}

/** Retained for callers that need the direct engine launch shape. */
export function resolveServeLaunch(pkgRoot: string): {command: string; args: string[]} {
  const engine = join(pkgRoot, 'dist', 'clad.js');
  return existsSync(engine) ? {command: 'node', args: [engine, 'serve']} : {command: 'clad', args: ['serve']};
}

function mcpLaunch(): {command: string; args: string[]} {
  return {command: 'node', args: [RUNTIME_RELATIVE]};
}

function copyManagedSkill(source: string, destination: string, force: boolean): ChannelResult {
  if (!existsSync(source)) return 'failed';
  const sourceBody = readText(join(source, 'SKILL.md'));
  if (sourceBody == null || !sourceBody.startsWith('---\n')) return 'failed';
  const destinationName = basename(destination);
  const expected = /^name:\s*.*$/m.test(sourceBody)
    ? sourceBody.replace(/^name:\s*.*$/m, `name: ${destinationName}`)
    : sourceBody.replace(/^---\n/, `---\nname: ${destinationName}\n`);
  if (existsSync(destination)) {
    const current = readText(join(destination, 'SKILL.md'));
    if (current === expected) return 'unchanged';
    if (!force && current != null && !current.includes('# Cladding init')) return 'skipped-different';
    rmSync(destination, {recursive: true, force: true});
  }
  ensureDir(dirname(destination));
  cpSync(source, destination, {recursive: true, dereference: true});
  writeFileSync(join(destination, 'SKILL.md'), expected, 'utf8');
  return 'created';
}

function mergeJsonMcp(path: string, launch: {command: string; args: string[]}, force: boolean): ChannelResult {
  try {
    const raw = readText(path);
    const doc = raw == null ? {} : (JSON.parse(raw) as Record<string, unknown>);
    if (!doc.mcpServers || typeof doc.mcpServers !== 'object') doc.mcpServers = {};
    const servers = doc.mcpServers as Record<string, unknown>;
    const current = servers.cladding;
    const next = {command: launch.command, args: launch.args};
    if (JSON.stringify(current) === JSON.stringify(next)) return 'unchanged';
    if (current && !force && !isKnownLaunch(current, [])) return 'skipped-different';
    servers.cladding = next;
    return writeIfChanged(path, `${JSON.stringify(doc, null, 2)}\n`);
  } catch {
    return 'failed';
  }
}

/** Allow only Cladding's read-only doctor tools in project-local Cursor CLI sessions. */
function mergeCursorCliPermissions(path: string): ChannelResult {
  try {
    const raw = readText(path);
    const doc = raw == null ? {} : (JSON.parse(raw) as Record<string, unknown>);
    const currentPermissions = doc.permissions;
    if (
      currentPermissions !== undefined &&
      (typeof currentPermissions !== 'object' || currentPermissions === null || Array.isArray(currentPermissions))
    ) {
      return 'skipped-different';
    }
    const permissions = (currentPermissions ?? {}) as Record<string, unknown>;
    const currentAllow = permissions.allow;
    if (
      currentAllow !== undefined &&
      (!Array.isArray(currentAllow) || currentAllow.some((entry) => typeof entry !== 'string'))
    ) {
      return 'skipped-different';
    }
    const currentDeny = permissions.deny;
    if (
      currentDeny !== undefined &&
      (!Array.isArray(currentDeny) || currentDeny.some((entry) => typeof entry !== 'string'))
    ) {
      return 'skipped-different';
    }
    const allow = (currentAllow ?? []) as string[];
    const deny = (currentDeny ?? []) as string[];
    const nextAllow = [...allow];
    for (const permission of CURSOR_READONLY_MCP_PERMISSIONS) {
      if (!nextAllow.includes(permission)) nextAllow.push(permission);
    }
    if (nextAllow.length === allow.length && currentDeny !== undefined) return 'unchanged';
    permissions.allow = nextAllow;
    permissions.deny = deny;
    doc.permissions = permissions;
    return writeIfChanged(path, `${JSON.stringify(doc, null, 2)}\n`);
  } catch {
    return 'failed';
  }
}

async function mergeCodexMcp(path: string, launch: {command: string; args: string[]}, force: boolean): Promise<ChannelResult> {
  try {
    const {parse, stringify} = await import('smol-toml');
    const raw = readText(path);
    const doc = raw == null ? {} : (parse(raw) as Record<string, unknown>);
    if (!doc.mcp_servers || typeof doc.mcp_servers !== 'object') doc.mcp_servers = {};
    const servers = doc.mcp_servers as Record<string, unknown>;
    const current = servers.cladding;
    const next = {
      command: launch.command,
      args: launch.args,
      description: 'cladding MCP server (project-scoped by `clad setup`)',
      default_tools_approval_mode: 'writes',
    };
    if (JSON.stringify(current) === JSON.stringify(next)) return 'unchanged';
    if (current && !force && !isKnownLaunch(current, [])) return 'skipped-different';
    servers.cladding = next;
    return writeIfChanged(path, stringify(doc));
  } catch {
    return 'failed';
  }
}

function writeCursorBootstrap(projectRoot: string): ChannelResult {
  const body = [
    '---',
    'description: Cladding bootstrap boundary',
    'alwaysApply: true',
    '---',
    '',
    'Cladding is available only in this project. Do not initialize or invoke Cladding for ordinary work.',
    'Use the cladding-init skill only when the user explicitly names Cladding and asks to initialize, adopt, or refresh it.',
    '',
  ].join('\n');
  return writeIfChanged(join(projectRoot, '.cursor', 'rules', 'cladding-bootstrap.mdc'), body);
}

function combine(results: readonly ChannelResult[]): ChannelResult {
  if (results.includes('failed')) return 'failed';
  if (results.includes('skipped-different')) return 'skipped-different';
  if (results.includes('manual-required')) return 'manual-required';
  if (results.includes('removed')) return 'removed';
  if (results.includes('rewired')) return 'rewired';
  if (results.includes('created')) return 'created';
  return 'unchanged';
}

function readLastSetupVersion(statusFile: string): string | null {
  try {
    return (JSON.parse(readFileSync(statusFile, 'utf8')) as SetupStatus).cladding_version ?? null;
  } catch {
    return null;
  }
}

function collectIssue(
  result: ChannelResult,
  step: string,
  errors: Array<{step: string; message: string}>,
  warnings: Array<{step: string; message: string}>,
): void {
  if (result === 'failed') errors.push({step, message: 'project wiring failed'});
  if (result === 'skipped-different') warnings.push({step, message: 'existing non-Cladding configuration was preserved; use --force to replace only the cladding entry'});
  if (result === 'manual-required') warnings.push({step, message: 'run `claude plugin uninstall claude-code@cladding --scope user --keep-data` to remove the legacy user plugin'});
}

/** Wire Cladding only into one project and remove provably-owned legacy globals. */
export async function runHostSetup(opts: SetupOptions = {}): Promise<SetupResult> {
  const home = opts.home ?? homedir();
  const projectRoot = resolve(opts.projectRoot ?? process.cwd());
  const pkgRoot = opts.pkgRoot ?? resolveDefaultPkgRoot();
  const version = opts.version ?? readCladdingVersion(pkgRoot);
  // Default to the hosts actually present on this machine (spec AC-001:
  // "wire only the detected channels"); `--host all` forces every channel.
  const detected = detectHosts(home);
  const hosts = new Set(opts.hosts ?? ALL_HOSTS.filter((h) => detected[h]));
  const force = opts.force ?? false;
  const statusFile = join(projectRoot, '.cladding', STATUS_FILENAME);
  const lastVersion = readLastSetupVersion(statusFile);
  const errors: Array<{step: string; message: string}> = [];
  const warnings: Array<{step: string; message: string}> = [];

  ensureDir(projectRoot);
  ignoreLocalRuntime(projectRoot);
  const runtimeParts: ChannelResult[] = [
    writeIfChanged(join(projectRoot, RUNTIME_RELATIVE), runtimeBody(pkgRoot)),
  ];
  if (hosts.has('gemini')) {
    runtimeParts.push(
      writeIfChanged(join(projectRoot, GEMINI_DOCTOR_POLICY_RELATIVE), geminiDoctorPolicyBody()),
    );
  }
  const runtime = combine(runtimeParts);
  const initSource = join(pkgRoot, 'plugins', 'codex', 'skills', 'init');
  const sharedSkill = hosts.has('codex') || hosts.has('gemini') || hosts.has('antigravity')
    ? copyManagedSkill(initSource, join(projectRoot, '.agents', 'skills', 'cladding-init'), force)
    : 'unchanged';
  const launch = mcpLaunch();

  // Legacy cleanup runs BEFORE wiring: the antigravity channel writes a
  // machine-wide dir at the same path the pre-0.9.0 symlink occupied, and a
  // merge through a still-present symlink would write into the legacy package.
  const roots = knownRoots(home, pkgRoot);
  const claudePluginLink = removeOwnedSymlink(join(home, '.claude', 'plugins', 'cladding'), roots);
  const claudePluginInstall = claudePluginLink === 'removed'
    ? cleanupClaudeUserPlugin(opts.activate ?? true)
    : 'unchanged';
  const legacyCleanup = {
    claude_plugin: combine([claudePluginLink, claudePluginInstall]),
    gemini_extension: removeOwnedSymlink(join(home, '.gemini', 'extensions', 'cladding'), roots),
    antigravity_plugin: cleanupAntigravityPlugin(home, roots),
    codex_skills: removeOwnedCodexSkills(home, roots),
    codex_mcp: await removeOwnedCodexMcp(home, roots),
    cursor_mcp: removeOwnedCursorMcp(home, roots),
  } as const;

  const codex = hosts.has('codex')
    ? await mergeCodexMcp(join(projectRoot, '.codex', 'config.toml'), launch, force)
    : 'skipped-not-installed';
  const gemini = hosts.has('gemini')
    ? mergeJsonMcp(join(projectRoot, '.gemini', 'settings.json'), launch, force)
    : 'skipped-not-installed';
  const antigravity = hosts.has('antigravity')
    ? combine([
        // Forward-compat project file (agy 1.1.x does not read it yet) …
        mergeJsonMcp(join(projectRoot, '.agents', 'mcp_config.json'), launch, force),
        // … plus the machine-wide wire agy actually loads (see wireAntigravityGlobal).
        wireAntigravityGlobal(home, pkgRoot, force),
      ])
    : 'skipped-not-installed';
  const claude = hosts.has('claude')
    ? combine([
        copyManagedSkill(initSource, join(projectRoot, '.claude', 'skills', 'cladding-init'), force),
        mergeJsonMcp(join(projectRoot, '.mcp.json'), launch, force),
      ])
    : 'skipped-not-installed';
  const cursor = hosts.has('cursor')
    ? combine([
        copyManagedSkill(initSource, join(projectRoot, '.cursor', 'skills', 'cladding-init'), force),
        mergeJsonMcp(join(projectRoot, '.cursor', 'mcp.json'), launch, force),
        mergeCursorCliPermissions(join(projectRoot, '.cursor', 'cli.json')),
        writeCursorBootstrap(projectRoot),
      ])
    : 'skipped-not-installed';

  const wiring = {runtime, shared_init_skill: sharedSkill, claude, codex, gemini, antigravity, cursor};
  if (hosts.size === 0) {
    warnings.push({
      step: 'hosts',
      message: 'no supported AI host detected on this machine — only the shared runtime was written; use `clad setup --host <name|all>` to wire explicitly',
    });
  }
  for (const [step, state] of Object.entries(wiring)) collectIssue(state, step, errors, warnings);
  for (const [step, state] of Object.entries(legacyCleanup)) collectIssue(state, `legacy:${step}`, errors, warnings);

  ensureDir(dirname(statusFile));
  writeFileSync(statusFile, `${JSON.stringify({
    project_root: projectRoot,
    cladding_root: pkgRoot,
    cladding_version: version,
    last_run: new Date().toISOString(),
  }, null, 2)}\n`, 'utf8');

  const result: SetupResult = {
    projectRoot,
    wiring,
    legacyCleanup,
    errors,
    warnings,
    statusFile,
    cladding_root: pkgRoot,
    cladding_version: version,
    last_setup_version: lastVersion,
  };
  if (!opts.quiet) process.stdout.write(`${renderSetupReport(result)}\n`);
  return result;
}

function stateLabel(state: ChannelResult): string {
  switch (state) {
    case 'created': return 'wired';
    case 'rewired': return 'updated';
    case 'unchanged': return 'already ready';
    case 'removed': return 'legacy global removed';
    case 'skipped-not-installed': return 'not selected';
    case 'skipped-different': return 'preserved conflict';
    case 'manual-required': return 'manual cleanup required';
    default: return 'failed';
  }
}

/** Render a host-neutral setup summary without exposing internal package paths. */
export function renderSetupReport(result: SetupResult, _detection?: HostDetection): string {
  void _detection;
  const lines = [
    `cladding setup — project activation: ${result.projectRoot}`,
    '',
    `  Claude Code  → ${stateLabel(result.wiring.claude)}`,
    `  Codex        → ${stateLabel(result.wiring.codex)}`,
    `  Gemini CLI   → ${stateLabel(result.wiring.gemini)}`,
    `  Antigravity  → ${stateLabel(result.wiring.antigravity)}`,
    `  Cursor       → ${stateLabel(result.wiring.cursor)}`,
  ];
  if (result.wiring.antigravity === 'created' || result.wiring.antigravity === 'rewired') {
    lines.push('', '  Note: Antigravity reads MCP config machine-wide only, so its wire lives in ~/.gemini/config/plugins/cladding (each session still resolves the project from its working directory).');
  }
  const cleaned = Object.values(result.legacyCleanup).filter((state) => state === 'removed').length;
  if (cleaned > 0) lines.push('', `Removed ${cleaned} legacy global Cladding wire(s).`);
  for (const warning of result.warnings) lines.push(`  ! ${warning.step}: ${warning.message}`);
  lines.push(
    '',
    'Next steps:',
    '  1. Start a new AI session in this project directory',
    '  2. Ask: "Apply Cladding to this project"',
    '  3. Review the preview and reply with its exact approval phrase',
    '  4. After initialization, develop normally in natural language',
  );
  return lines.join('\n');
}

function resolveDefaultPkgRoot(): string {
  const here = fileURLToPath(import.meta.url);
  let current = dirname(here);
  for (let depth = 0; depth < 7; depth++) {
    try {
      const pkg = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {name?: string};
      if (pkg.name === 'cladding') return current;
    } catch {
      // Continue towards the filesystem root.
    }
    current = dirname(current);
  }
  return resolve(dirname(here), '..');
}

function readCladdingVersion(pkgRoot: string): string {
  try {
    return (JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {version?: string}).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getCurrentCladdingVersion(): string | null {
  const version = readCladdingVersion(resolveDefaultPkgRoot());
  return version === 'unknown' ? null : version;
}

export function getLastSetupVersion(projectRoot: string = process.cwd()): string | null {
  return readLastSetupVersion(join(resolve(projectRoot), '.cladding', STATUS_FILENAME));
}

/** Exported for diagnostics and tests; setup writes all selected hosts regardless of installation. */
export function detectHosts(home: string = homedir()): HostDetection {
  return {
    claude: existsSync(join(home, '.claude')),
    gemini: existsSync(join(home, '.gemini')),
    antigravity: existsSync(join(home, '.gemini', 'config')) || existsSync(join(home, '.gemini', 'antigravity-cli')),
    codex: existsSync(join(home, '.codex')),
    agents: existsSync(join(home, '.agents')),
    cursor: existsSync(join(home, '.cursor')),
  };
}

/** Test-only sanity helper used to ensure copied skill roots contain directories. */
export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
