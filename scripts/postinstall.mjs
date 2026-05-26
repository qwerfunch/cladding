#!/usr/bin/env node
// F-90d054 host wiring postinstall hook.
//
// Creates four host AI auto-discovery channels:
//   1. ~/.claude/plugins/cladding         (symlink → cladding pkg root)
//   2. ~/.gemini/extensions/cladding      (symlink → cladding/plugins/gemini-cli)
//   3. ~/.agents/skills/cladding-<verb>   (symlinks × N → cladding/plugins/codex/skills/<verb>)
//   4. ~/.codex/config.toml               ([mcp_servers.cladding] table merged)
//
// Idempotent. Failures are non-fatal — `clad init` retries any skipped step.
// Disable with CLADDING_SKIP_POSTINSTALL=1 (CI, sandboxed builds, etc).

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.CLADDING_SKIP_POSTINSTALL === '1' || process.env.CI === 'true') {
  process.exit(0);
}

const HOME = homedir();
const IS_WIN = platform() === 'win32';
const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_FILE = join(HOME, '.cladding', 'postinstall-status.json');

const status = {
  cladding_root: PKG_ROOT,
  last_run: new Date().toISOString(),
  wiring: {},
  errors: [],
};

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function resolveSymlink(linkPath) {
  // Returns the absolute target of an existing symlink, or null if not a symlink.
  try {
    const target = readlinkSync(linkPath);
    return resolve(dirname(linkPath), target);
  } catch {
    return null;
  }
}

function symlinkOrFallback(target, link) {
  // Returns one of: 'unchanged' | 'created' | 'copied' | 'skipped-different'.
  if (existsSync(link)) {
    const existing = resolveSymlink(link);
    if (existing === target) return 'unchanged';
    return 'skipped-different';
  }
  ensureDir(dirname(link));
  try {
    symlinkSync(target, link, IS_WIN ? 'junction' : 'dir');
    return 'created';
  } catch (e) {
    // Windows non-admin fallback: directory copy.
    if (IS_WIN && (e.code === 'EPERM' || e.code === 'EACCES')) {
      cpSync(target, link, { recursive: true, dereference: true });
      return 'copied';
    }
    throw e;
  }
}

// ── 1. Claude Code global plugin ──────────────────────────────────────────
try {
  status.wiring.claude_plugin = symlinkOrFallback(
    PKG_ROOT,
    join(HOME, '.claude', 'plugins', 'cladding')
  );
} catch (e) {
  status.wiring.claude_plugin = 'failed';
  status.errors.push({ step: 'claude_plugin', message: e.message });
}

// ── 2. Gemini CLI extension ───────────────────────────────────────────────
try {
  status.wiring.gemini_extension = symlinkOrFallback(
    join(PKG_ROOT, 'plugins', 'gemini-cli'),
    join(HOME, '.gemini', 'extensions', 'cladding')
  );
} catch (e) {
  status.wiring.gemini_extension = 'failed';
  status.errors.push({ step: 'gemini_extension', message: e.message });
}

// ── 3. Codex skills (per-verb symlinks) ───────────────────────────────────
const codexSkillsDir = join(PKG_ROOT, 'plugins', 'codex', 'skills');
status.wiring.codex_skills = [];
if (existsSync(codexSkillsDir)) {
  for (const verb of readdirSync(codexSkillsDir)) {
    const verbPath = join(codexSkillsDir, verb);
    try {
      if (!statSync(verbPath).isDirectory()) continue;
    } catch {
      continue;
    }
    const linkPath = join(HOME, '.agents', 'skills', `cladding-${verb}`);
    try {
      const result = symlinkOrFallback(verbPath, linkPath);
      status.wiring.codex_skills.push({ verb, result });
    } catch (e) {
      status.wiring.codex_skills.push({ verb, result: 'failed', message: e.message });
      status.errors.push({ step: `codex_skill:${verb}`, message: e.message });
    }
  }
}

// ── 4. Codex MCP config.toml merge ────────────────────────────────────────
try {
  const codexConfigPath = join(HOME, '.codex', 'config.toml');
  ensureDir(dirname(codexConfigPath));

  const { parse, stringify } = await import('smol-toml');

  const existing = existsSync(codexConfigPath)
    ? parse(readFileSync(codexConfigPath, 'utf8'))
    : {};

  if (!existing.mcp_servers || typeof existing.mcp_servers !== 'object') {
    existing.mcp_servers = {};
  }

  const ourEntry = {
    command: 'clad',
    args: ['serve'],
    description: 'cladding MCP server (auto-wired by postinstall)',
  };

  const current = existing.mcp_servers.cladding;
  const isSame =
    current &&
    current.command === ourEntry.command &&
    JSON.stringify(current.args) === JSON.stringify(ourEntry.args);

  if (isSame) {
    status.wiring.codex_mcp = 'unchanged';
  } else {
    existing.mcp_servers.cladding = ourEntry;
    writeFileSync(codexConfigPath, stringify(existing));
    status.wiring.codex_mcp = current ? 'updated' : 'created';
  }
} catch (e) {
  status.wiring.codex_mcp = 'failed';
  status.errors.push({ step: 'codex_mcp', message: e.message });
}

// ── Write status file (consumed by `clad init` fallback retry) ────────────
try {
  ensureDir(dirname(STATUS_FILE));
  writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
} catch {
  // status file is advisory; failure here is not user-visible.
}

// Silent success, brief message on failure.
if (status.errors.length > 0) {
  console.error(
    `[cladding] postinstall completed with ${status.errors.length} warning(s). \`clad init\` will retry on next run.`
  );
}
