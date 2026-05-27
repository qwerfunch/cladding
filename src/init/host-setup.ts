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

function wireChannel(target: string, link: string, opts: {force: boolean; isWin: boolean}): ChannelResult {
  if (existsSync(link)) {
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

function printReport(result: SetupResult, detection: HostDetection, opts: {quiet?: boolean}): void {
  if (opts.quiet) return;
  const lines: string[] = [];
  lines.push('cladding setup — wiring detected AI tools');
  lines.push('');
  lines.push(
    formatChannelLine(
      'Claude Code',
      detection.claude ? result.wiring.claude_plugin : 'skipped-not-installed',
    ),
  );
  lines.push(
    formatChannelLine(
      'Gemini CLI',
      detection.gemini ? result.wiring.gemini_extension : 'skipped-not-installed',
    ),
  );
  const skillsSummary = detection.agents
    ? summarizeSkills(result.wiring.codex_skills)
    : 'skipped-not-installed';
  lines.push(
    detection.agents
      ? `  ✓ ${'Codex skills'.padEnd(28)} → ${skillsSummary}`
      : formatChannelLine('Codex skills', 'skipped-not-installed'),
  );
  lines.push(
    formatChannelLine(
      'Codex MCP',
      detection.codex ? result.wiring.codex_mcp : 'skipped-not-installed',
    ),
  );
  lines.push('');
  const wiredCount = countWired(result.wiring, detection);
  const detectedCount = countDetected(detection);
  if (wiredCount === detectedCount && detectedCount > 0) {
    lines.push(`${wiredCount}/${detectedCount} detected channels wired. Status: ${result.statusFile}`);
  } else if (detectedCount === 0) {
    lines.push('AI 도구가 감지되지 않았습니다. Claude Code / Codex CLI / Gemini CLI 중 하나라도 설치 후 다시 실행하세요.');
  } else {
    lines.push(`${wiredCount}/${detectedCount} detected channels wired (some skipped/failed). Status: ${result.statusFile}`);
  }
  if (result.last_setup_version && result.last_setup_version !== result.cladding_version) {
    lines.push('');
    lines.push(`(version change detected: ${result.last_setup_version} → ${result.cladding_version})`);
  }
  lines.push('');
  lines.push('다음 단계:');
  lines.push('  1. AI 도구 (Claude Code / Codex / Gemini) 를 켭니다');
  lines.push('  2. 프로젝트 디렉토리로 이동');
  lines.push('  3. /cladding init "..." 입력 (LLM 안에서)');
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
    (detection.codex ? 1 : 0)
  );
}

function countWired(wiring: SetupResult['wiring'], detection: HostDetection): number {
  let n = 0;
  const wiredStates = new Set(['created', 'rewired', 'unchanged', 'copied']);
  if (detection.claude && wiredStates.has(wiring.claude_plugin)) n++;
  if (detection.gemini && wiredStates.has(wiring.gemini_extension)) n++;
  if (detection.agents && wiring.codex_skills.some((s) => wiredStates.has(s.result))) n++;
  if (detection.codex && wiredStates.has(wiring.codex_mcp)) n++;
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

  for (const state of [claude_plugin, gemini_extension, codex_mcp]) {
    if (state === 'failed') errors.push({step: state, message: 'wire failed'});
  }
  for (const s of codex_skills) {
    if (s.result === 'failed') errors.push({step: `codex_skill:${s.verb}`, message: s.message ?? 'wire failed'});
  }

  const result: SetupResult = {
    wiring: {claude_plugin, gemini_extension, codex_skills, codex_mcp},
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

  printReport(result, detection, {quiet: opts.quiet});
  return result;
}

function resolveDefaultPkgRoot(): string {
  // Resolves the cladding package root from this file's location:
  // src/init/host-setup.ts → cladding root is two levels up.
  // After build, dist/init/host-setup.js → also two levels up.
  // Use require.resolve fallback for safety.
  try {
    return resolve(__dirname, '..', '..');
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
