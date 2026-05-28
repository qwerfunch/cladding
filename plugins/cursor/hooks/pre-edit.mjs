#!/usr/bin/env node
// cladding · Cursor IDE pre-edit hook (0.4.9, F-89406c Layer-C)
//
// Mirrors plugins/claude-code/hooks/pre-tool-use.mjs — same
// `.cladding/work-registry.json` check, same fail-open semantics
// for missing/corrupt registry and malformed stdin. Cursor's hook
// system (v1.7+, ~/.cursor/hooks.json) exposes several events that
// roughly correspond to Claude Code's PreToolUse(Edit|Write):
//   - beforeShellExecution
//   - beforeMCPExecution
//   - afterFileEdit (post-hoc — useful for the Layer-D auditor)
//   - stop (turn end — also useful for Layer-D)
//
// This script targets the closest-to-PreToolUse event Cursor offers;
// it uses the universal `exit 2 + stderr message` deny pattern
// because Cursor's exact JSON contract for hook responses is being
// formalised. Auto-wire via `clad setup` (~/.cursor/hooks.json
// merge) lands in a follow-up patch once cursor docs settle.

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

const cwd = payload?.cwd ?? payload?.workspaceRoot ?? payload?.projectRoot ?? process.cwd();
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
