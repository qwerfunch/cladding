#!/usr/bin/env node
// cladding · Codex CLI PreToolUse hook (0.4.9, F-89406c Layer-C)
//
// Mirrors plugins/claude-code/hooks/pre-tool-use.mjs — same
// `.cladding/work-registry.json` check, same fail-open semantics for
// missing/corrupt registry and malformed stdin. Diverges from the
// Claude Code version only in the deny-response shape: this script
// uses the universal `exit 2 + stderr message` pattern that every
// known host hook system surfaces back to the user, because Codex
// CLI's exact `hookSpecificOutput` JSON contract is still being
// formalised and a stderr-based deny works regardless.
//
// Wire-up: this script is shipped inside the cladding npm package
// under plugins/codex/hooks/. The maintainer can register it as a
// PreToolUse hook in their Codex CLI config; auto-wire via
// `clad setup` lands in a follow-up patch (gated on Codex's hook
// manifest location stabilising).

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

let payload;
try {
  const raw = await readStdin();
  payload = raw.trim() ? JSON.parse(raw) : {};
} catch {
  process.exit(0); // malformed stdin → fail-open
}

const cwd = payload?.cwd ?? payload?.workingDirectory ?? process.cwd();
const registryPath = join(cwd, '.cladding', 'work-registry.json');

if (!existsSync(registryPath)) process.exit(0); // cladding not initialised → allow

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8'));
} catch {
  process.exit(0); // corrupt registry → fail-open
}

const activeIds = Object.keys(registry?.active ?? {});
if (activeIds.length > 0) process.exit(0); // open transaction → allow

process.stderr.write(
  'cladding: no active work transaction. Call enter_work({featureId}) — or execute_drive({scenarioId | intent}) for a multi-feature bundle — before any Edit / Write tool. See AGENTS.md / CLAUDE.md trigger guidance (F-8880ee) for details.\n',
);
process.exit(2);
