// F-80d19d host setup — explicit `clad setup` command (replaces F-90d054 postinstall).
//
// Wires up to four host AI auto-discovery channels, one symlink per channel:
//   1. ~/.claude/plugins/cladding         → cladding pkg root
//   2. ~/.gemini/extensions/cladding      → cladding/plugins/gemini-cli
//   3. ~/.agents/skills/cladding-<verb>   → cladding/plugins/codex/skills/<verb>
//   4. ~/.codex/config.toml               → [mcp_servers.cladding] table merge
//
// One command handles six scenarios:
//   - first wire        — symlink absent → create
//   - update            — symlink target differs from current cladding root → re-wire
//   - delta host        — host AI newly installed since last setup → add wire
//   - repair            — symlink missing → create (same as first wire)
//   - no-op             — symlink target matches → skip
//   - conflict          — directory copy with manual changes → warn, --force required
//
// Detection — host AI is "installed" iff its home directory exists (~/.claude/, ~/.gemini/,
// ~/.agents/, ~/.codex/). Undetected hosts are skipped (no directories created).

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import {homedir, platform} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export type ChannelResult =
  | 'created'
  | 'unchanged'
  | 'rewired'
  | 'copied'
  | 'skipped-different'
  | 'skipped-not-installed'
  | 'failed';

export interface CodexSkillResult {
  readonly verb: string;
  readonly result: ChannelResult;
  readonly message?: string;
}

export interface SetupResult {
  readonly wiring: {
    readonly claude_plugin: ChannelResult;
    readonly gemini_extension: ChannelResult;
    readonly codex_skills: ReadonlyArray<CodexSkillResult>;
    readonly codex_mcp: ChannelResult;
    readonly cursor_mcp: ChannelResult;
  };
  readonly errors: ReadonlyArray<{step: string; message: string}>;
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
  readonly version?: string;
}

interface HostDetection {
  readonly claude: boolean;
  readonly gemini: boolean;
  readonly codex: boolean;
  readonly agents: boolean;
  readonly cursor: boolean;
}

interface SetupStatus {
  cladding_root: string;
  cladding_version: string;
  last_run: string;
  wiring: SetupResult['wiring'];
  errors: SetupResult['errors'];
}

const STATUS_FILENAME = 'setup-status.json';

function detectHosts(home: string): HostDetection {
  return {
    claude: existsSync(join(home, '.claude')),
    gemini: existsSync(join(home, '.gemini')),
    codex: existsSync(join(home, '.codex')),
    agents: existsSync(join(home, '.agents')),
    cursor: existsSync(join(home, '.cursor')),
  };
}

function ensureDir(p: string): void {
  mkdirSync(p, {recursive: true});
}

function resolveSymlink(linkPath: string): string | null {
  try {
    const target = readlinkSync(linkPath);
    return resolve(dirname(linkPath), target);
  } catch {
    return null;
  }
}

function isSymlink(linkPath: string): boolean {
  try {
    const stat = lstatSync(linkPath);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Like existsSync but also returns true for dangling symlinks (existsSync follows targets). */
function pathExists(linkPath: string): boolean {
  try {
    lstatSync(linkPath);
    return true;
  } catch {
    return false;
  }
}

function wireChannel(target: string, link: string, opts: {force: boolean; isWin: boolean}): ChannelResult {
  if (pathExists(link)) {
    if (isSymlink(link)) {
      const existing = resolveSymlink(link);
      if (existing === target) return 'unchanged';
      // Symlink with different target → re-wire (safe, no user data loss)
      try {
        rmSync(link);
      } catch {
        return 'failed';
      }
      // fall through to create
    } else {
      // Directory copy or other — could contain user customizations
      if (!opts.force) return 'skipped-different';
      try {
        rmSync(link, {recursive: true, force: true});
      } catch {
        return 'failed';
      }
    }
  }
  ensureDir(dirname(link));
  try {
    symlinkSync(target, link, opts.isWin ? 'junction' : 'dir');
    return existsSync(link) ? (isSymlink(link) ? 'created' : 'created') : 'failed';
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (opts.isWin && (err.code === 'EPERM' || err.code === 'EACCES')) {
      try {
        cpSync(target, link, {recursive: true, dereference: true});
        return 'copied';
      } catch {
        return 'failed';
      }
    }
    return 'failed';
  }
}

function wireClaude(home: string, pkgRoot: string, opts: {force: boolean; isWin: boolean}): ChannelResult {
  return wireChannel(pkgRoot, join(home, '.claude', 'plugins', 'cladding'), opts);
}

function wireGemini(home: string, pkgRoot: string, opts: {force: boolean; isWin: boolean}): ChannelResult {
  return wireChannel(join(pkgRoot, 'plugins', 'gemini-cli'), join(home, '.gemini', 'extensions', 'cladding'), opts);
}

function wireCodexSkills(
  home: string,
  pkgRoot: string,
  opts: {force: boolean; isWin: boolean},
): CodexSkillResult[] {
  const out: CodexSkillResult[] = [];
  const codexSkillsDir = join(pkgRoot, 'plugins', 'codex', 'skills');
  if (!existsSync(codexSkillsDir)) return out;
  for (const verb of readdirSync(codexSkillsDir)) {
    const verbPath = join(codexSkillsDir, verb);
    try {
      if (!statSync(verbPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const linkPath = join(home, '.agents', 'skills', `cladding-${verb}`);
    try {
      const result = wireChannel(verbPath, linkPath, opts);
      out.push({verb, result});
    } catch (e: unknown) {
      const err = e as Error;
      out.push({verb, result: 'failed', message: err.message});
    }
  }
  return out;
}

function wireCursorMcp(home: string): ChannelResult {
  try {
    const cursorConfigPath = join(home, '.cursor', 'mcp.json');
    ensureDir(dirname(cursorConfigPath));
    const existing = existsSync(cursorConfigPath)
      ? (JSON.parse(readFileSync(cursorConfigPath, 'utf8')) as Record<string, unknown>)
      : {};
    if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
      existing.mcpServers = {};
    }
    const mcpServers = existing.mcpServers as Record<string, unknown>;
    const ourEntry = {
      command: 'clad',
      args: ['serve'],
    };
    const current = mcpServers.cladding as {command?: string; args?: unknown} | undefined;
    const isSame =
      current &&
      current.command === ourEntry.command &&
      JSON.stringify(current.args) === JSON.stringify(ourEntry.args);
    if (isSame) return 'unchanged';
    const hadCurrent = current != null;
    mcpServers.cladding = ourEntry;
    writeFileSync(cursorConfigPath, JSON.stringify(existing, null, 2));
    return hadCurrent ? 'rewired' : 'created';
  } catch {
    return 'failed';
  }
}

async function wireCodexMcp(home: string): Promise<ChannelResult> {
  try {
    const codexConfigPath = join(home, '.codex', 'config.toml');
    ensureDir(dirname(codexConfigPath));
    const {parse, stringify} = await import('smol-toml');
    const existing = existsSync(codexConfigPath)
      ? (parse(readFileSync(codexConfigPath, 'utf8')) as Record<string, unknown>)
      : {};
    if (!existing.mcp_servers || typeof existing.mcp_servers !== 'object') {
      existing.mcp_servers = {};
    }
    const mcpServers = existing.mcp_servers as Record<string, unknown>;
    const ourEntry = {
      command: 'clad',
      args: ['serve'],
      description: 'cladding MCP server (wired by `clad setup`)',
    };
    const current = mcpServers.cladding as {command?: string; args?: unknown} | undefined;
    const isSame =
      current &&
      current.command === ourEntry.command &&
      JSON.stringify(current.args) === JSON.stringify(ourEntry.args);
    if (isSame) return 'unchanged';
    const hadCurrent = current != null;
    mcpServers.cladding = ourEntry;
    writeFileSync(codexConfigPath, stringify(existing));
    return hadCurrent ? 'rewired' : 'created';
  } catch {
    return 'failed';
  }
}

function readLastSetupVersion(statusFile: string): string | null {
  try {
    const raw = readFileSync(statusFile, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SetupStatus>;
    return parsed.cladding_version ?? null;
  } catch {
    return null;
  }
}

function writeStatus(statusFile: string, status: SetupStatus): void {
  try {
    ensureDir(dirname(statusFile));
    writeFileSync(statusFile, JSON.stringify(status, null, 2));
  } catch {
    // status file is advisory; failure here is not user-visible.
  }
}

function formatChannelLine(name: string, result: ChannelResult, target?: string): string {
  const icon =
    result === 'created' || result === 'rewired' || result === 'copied' || result === 'unchanged'
      ? '✓'
      : result === 'skipped-not-installed'
      ? '-'
      : result === 'skipped-different'
      ? '⚠'
      : '✗';
  const label =
    result === 'created'
      ? 'wired'
      : result === 'rewired'
      ? 're-wired (updated)'
      : result === 'copied'
      ? 'wired (directory copy, Windows fallback)'
      : result === 'unchanged'
      ? 'already wired'
      : result === 'skipped-not-installed'
      ? 'not installed, skipped'
      : result === 'skipped-different'
      ? 'conflict — manual change detected, use --force'
      : 'failed';
  return `  ${icon} ${name.padEnd(28)} → ${label}${target ? ` (${target})` : ''}`;
}

const WIRED_STATES: ReadonlySet<ChannelResult> = new Set(['created', 'rewired', 'unchanged', 'copied']);

/** Check whether a binary exists in PATH using `which` (POSIX) or `where` (Win). */
function detectBinary(name: string): boolean {
  const cmd = platform() === 'win32' ? 'where' : 'which';
  const result = spawnSync(cmd, [name], {stdio: 'ignore'});
  return result.status === 0;
}

/** Run a non-interactive activation command, return true on success. */
function runActivation(command: string, args: readonly string[]): {ok: boolean; stderr: string} {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 30_000});
  return {ok: result.status === 0, stderr: result.stderr ?? ''};
}

interface ActivationResult {
  readonly attempted: boolean;
  readonly success: boolean;
  readonly stderr?: string;
}

function activateClaude(pluginPath: string): ActivationResult {
  if (!detectBinary('claude')) return {attempted: false, success: false};
  const add = runActivation('claude', ['plugin', 'marketplace', 'add', pluginPath, '--scope', 'user']);
  if (!add.ok) return {attempted: true, success: false, stderr: add.stderr};
  const install = runActivation('claude', ['plugin', 'install', 'claude-code@cladding', '--scope', 'user']);
  return {attempted: true, success: install.ok, stderr: install.stderr};
}

function activateGemini(extensionPath: string): ActivationResult {
  if (!detectBinary('gemini')) return {attempted: false, success: false};
  // Check if cladding extension is already installed/enabled — `gemini extensions
  // list` writes its output to stderr (verified against gemini 0.42.0), so we
  // grep both streams.
  const list = spawnSync('gemini', ['extensions', 'list'], {encoding: 'utf8', timeout: 10_000});
  const combined = (list.stdout ?? '') + (list.stderr ?? '');
  if (list.status === 0 && /\bcladding\b/.test(combined)) {
    return {attempted: true, success: true};
  }
  const link = runActivation('gemini', ['extensions', 'link', extensionPath]);
  return {attempted: true, success: link.ok, stderr: link.stderr};
}

interface ActivationContext {
  readonly claude?: ActivationResult;
  readonly gemini?: ActivationResult;
}

function pushActivationHint(
  lines: string[],
  channel: 'claude' | 'gemini' | 'codex-skills' | 'codex-mcp' | 'cursor',
  wired: boolean,
  activation?: ActivationContext,
): void {
  if (!wired) return;
  switch (channel) {
    case 'claude': {
      const a = activation?.claude;
      if (a?.attempted && a.success) {
        lines.push('     ↳ 활성화: ✓ claude plugin marketplace add + install 자동 완료 (Claude Code 재시작 시 적용)');
      } else if (a?.attempted && !a.success) {
        lines.push('     ↳ 활성화: ✗ 자동 시도 실패 — 수동:');
        lines.push('       `claude plugin marketplace add ~/.claude/plugins/cladding`');
        lines.push('       후 `claude plugin install claude-code@cladding --scope user`');
      } else {
        lines.push('     ↳ 활성화 (claude binary 없음): 수동:');
        lines.push('       `claude plugin marketplace add ~/.claude/plugins/cladding`');
        lines.push('       후 `claude plugin install claude-code@cladding --scope user`');
      }
      break;
    }
    case 'gemini': {
      const a = activation?.gemini;
      if (a?.attempted && a.success) {
        lines.push('     ↳ 활성화: ✓ gemini extensions link 자동 완료 (Gemini CLI 재시작 시 적용)');
      } else if (a?.attempted && !a.success) {
        lines.push('     ↳ 활성화: ✗ 자동 시도 실패 — 수동:');
        lines.push('       `gemini extensions link ~/.gemini/extensions/cladding`');
      } else {
        lines.push('     ↳ 활성화 (gemini binary 없음): 수동:');
        lines.push('       `gemini extensions link ~/.gemini/extensions/cladding`');
      }
      break;
    }
    case 'codex-skills':
      lines.push('     ↳ Codex CLI 가 ~/.agents/skills/ 자동 인식 (재시작 시 적용)');
      break;
    case 'codex-mcp':
      lines.push('     ↳ TOML entry 자체가 등록 — 별도 활성화 불필요');
      break;
    case 'cursor':
      lines.push('     ↳ ~/.cursor/mcp.json 자체가 등록 — Cursor 재시작 시 적용');
      break;
  }
}

function printReport(
  result: SetupResult,
  detection: HostDetection,
  activation: ActivationContext,
  opts: {quiet?: boolean},
): void {
  if (opts.quiet) return;
  const lines: string[] = [];
  lines.push('cladding setup — wiring detected AI tools');
  lines.push('');

  const claudeState = detection.claude ? result.wiring.claude_plugin : 'skipped-not-installed';
  lines.push(formatChannelLine('Claude Code', claudeState));
  pushActivationHint(lines, 'claude', WIRED_STATES.has(claudeState), activation);

  const geminiState = detection.gemini ? result.wiring.gemini_extension : 'skipped-not-installed';
  lines.push(formatChannelLine('Gemini CLI', geminiState));
  pushActivationHint(lines, 'gemini', WIRED_STATES.has(geminiState), activation);

  const skillsSummary = detection.agents
    ? summarizeSkills(result.wiring.codex_skills)
    : 'skipped-not-installed';
  lines.push(
    detection.agents
      ? `  ✓ ${'Codex skills'.padEnd(28)} → ${skillsSummary}`
      : formatChannelLine('Codex skills', 'skipped-not-installed'),
  );
  const skillsWired = detection.agents && result.wiring.codex_skills.some((s) => WIRED_STATES.has(s.result));
  pushActivationHint(lines, 'codex-skills', skillsWired);

  const codexMcpState = detection.codex ? result.wiring.codex_mcp : 'skipped-not-installed';
  lines.push(formatChannelLine('Codex MCP', codexMcpState));
  pushActivationHint(lines, 'codex-mcp', WIRED_STATES.has(codexMcpState));

  const cursorState = detection.cursor ? result.wiring.cursor_mcp : 'skipped-not-installed';
  lines.push(formatChannelLine('Cursor', cursorState));
  pushActivationHint(lines, 'cursor', WIRED_STATES.has(cursorState));

  lines.push('');
  const wiredCount = countWired(result.wiring, detection);
  const detectedCount = countDetected(detection);
  if (wiredCount === detectedCount && detectedCount > 0) {
    lines.push(`${wiredCount}/${detectedCount} detected channels wired. Status: ${result.statusFile}`);
  } else if (detectedCount === 0) {
    lines.push('AI 도구가 감지되지 않았습니다. Claude Code / Codex / Gemini CLI / Cursor 중 하나라도 설치 후 다시 실행하세요.');
  } else {
    lines.push(`${wiredCount}/${detectedCount} detected channels wired (some skipped/failed). Status: ${result.statusFile}`);
  }
  if (result.last_setup_version && result.last_setup_version !== result.cladding_version) {
    lines.push('');
    lines.push(`(version change detected: ${result.last_setup_version} → ${result.cladding_version})`);
  }
  lines.push('');
  lines.push('다음 단계:');
  lines.push('  1. AI 도구 (Claude Code / Codex / Gemini / Cursor) 를 재시작');
  lines.push('  2. 프로젝트 디렉토리로 이동');
  lines.push('  3. /cladding init "..." 입력 (LLM 안에서) 또는 `clad init "..."` (terminal)');
  lines.push('  4. 개발 시작 — cladding 이 매 commit 마다 spec ↔ 코드 동기 자동 검사');
  process.stdout.write(lines.join('\n') + '\n');
}

function summarizeSkills(skills: ReadonlyArray<CodexSkillResult>): string {
  if (skills.length === 0) return '0 verbs (skipped)';
  const counts = skills.reduce<Record<string, number>>((acc, s) => {
    acc[s.result] = (acc[s.result] ?? 0) + 1;
    return acc;
  }, {});
  const parts: string[] = [];
  if (counts.created) parts.push(`${counts.created} created`);
  if (counts.rewired) parts.push(`${counts.rewired} re-wired`);
  if (counts.unchanged) parts.push(`${counts.unchanged} already wired`);
  if (counts.copied) parts.push(`${counts.copied} copied`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts['skipped-different']) parts.push(`${counts['skipped-different']} conflict`);
  return `${skills.length} verb${skills.length === 1 ? '' : 's'} — ${parts.join(', ')}`;
}

function countDetected(detection: HostDetection): number {
  return (
    (detection.claude ? 1 : 0) +
    (detection.gemini ? 1 : 0) +
    (detection.agents ? 1 : 0) +
    (detection.codex ? 1 : 0) +
    (detection.cursor ? 1 : 0)
  );
}

function countWired(wiring: SetupResult['wiring'], detection: HostDetection): number {
  let n = 0;
  const wiredStates = new Set(['created', 'rewired', 'unchanged', 'copied']);
  if (detection.claude && wiredStates.has(wiring.claude_plugin)) n++;
  if (detection.gemini && wiredStates.has(wiring.gemini_extension)) n++;
  if (detection.agents && wiring.codex_skills.some((s) => wiredStates.has(s.result))) n++;
  if (detection.codex && wiredStates.has(wiring.codex_mcp)) n++;
  if (detection.cursor && wiredStates.has(wiring.cursor_mcp)) n++;
  return n;
}

/** Run the `clad setup` host wiring (install + update + delta + repair). */
export async function runHostSetup(opts: SetupOptions = {}): Promise<SetupResult> {
  const home = opts.home ?? homedir();
  const pkgRoot = opts.pkgRoot ?? resolveDefaultPkgRoot();
  const version = opts.version ?? readCladingVersion(pkgRoot);
  const isWin = platform() === 'win32';
  const force = opts.force ?? false;
  const statusFile = join(home, '.cladding', STATUS_FILENAME);

  const lastVersion = readLastSetupVersion(statusFile);
  const detection = detectHosts(home);
  const errors: Array<{step: string; message: string}> = [];

  const claude_plugin = detection.claude
    ? wireClaude(home, pkgRoot, {force, isWin})
    : 'skipped-not-installed';
  const gemini_extension = detection.gemini
    ? wireGemini(home, pkgRoot, {force, isWin})
    : 'skipped-not-installed';
  const codex_skills = detection.agents ? wireCodexSkills(home, pkgRoot, {force, isWin}) : [];
  const codex_mcp: ChannelResult = detection.codex
    ? await wireCodexMcp(home)
    : 'skipped-not-installed';
  const cursor_mcp: ChannelResult = detection.cursor
    ? wireCursorMcp(home)
    : 'skipped-not-installed';

  for (const state of [claude_plugin, gemini_extension, codex_mcp, cursor_mcp]) {
    if (state === 'failed') errors.push({step: state, message: 'wire failed'});
  }
  for (const s of codex_skills) {
    if (s.result === 'failed') errors.push({step: `codex_skill:${s.verb}`, message: s.message ?? 'wire failed'});
  }

  // Auto-activation — runs after symlink wire succeeds. Each host CLI command
  // is invoked non-interactively; failures fall back to stdout instructions.
  const activation: ActivationContext = {
    ...(WIRED_STATES.has(claude_plugin)
      ? {claude: activateClaude(join(home, '.claude', 'plugins', 'cladding'))}
      : {}),
    ...(WIRED_STATES.has(gemini_extension)
      ? {gemini: activateGemini(join(home, '.gemini', 'extensions', 'cladding'))}
      : {}),
  };

  const result: SetupResult = {
    wiring: {claude_plugin, gemini_extension, codex_skills, codex_mcp, cursor_mcp},
    errors,
    statusFile,
    cladding_root: pkgRoot,
    cladding_version: version,
    last_setup_version: lastVersion,
  };

  writeStatus(statusFile, {
    cladding_root: pkgRoot,
    cladding_version: version,
    last_run: new Date().toISOString(),
    wiring: result.wiring,
    errors,
  });

  printReport(result, detection, activation, {quiet: opts.quiet});
  return result;
}

function resolveDefaultPkgRoot(): string {
  // Resolves the cladding package root from this file's location.
  // ESM build outputs a single bundled dist/clad.js (see scripts/build.mjs),
  // so we walk up from that file's location until we find a package.json
  // whose name is "cladding". This is robust to bundlers, symlinks, and any
  // future restructuring of the dist/ output.
  try {
    const here = fileURLToPath(import.meta.url);
    let cur = dirname(here);
    for (let depth = 0; depth < 6; depth++) {
      const pkgPath = join(cur, 'package.json');
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {name?: string};
        if (pkg.name === 'cladding') return cur;
      } catch {
        // fallthrough
      }
      const parent = dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
    // Fallback: assume two levels up from this file (src/init/x.ts pattern).
    return resolve(dirname(here), '..', '..');
  } catch {
    return process.cwd();
  }
}

function readCladingVersion(pkgRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {version: string};
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

/** Read the version recorded by the last `clad setup` run, or null if never run. */
export function getLastSetupVersion(home: string = homedir()): string | null {
  return readLastSetupVersion(join(home, '.cladding', STATUS_FILENAME));
}

/** Read the current cladding binary's package.json version, or null if unreadable. */
export function getCurrentCladdingVersion(): string | null {
  try {
    const pkgRoot = resolveDefaultPkgRoot();
    const v = readCladingVersion(pkgRoot);
    return v === 'unknown' ? null : v;
  } catch {
    return null;
  }
}
