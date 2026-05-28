#!/usr/bin/env node
// cladding · Claude Code PreToolUse hook (0.4.7, F-89406c Layer-C)
//
// Reads .cladding/work-registry.json. Denies the Edit / Write tool
// call when no work transaction is open — host AI must call
// enter_work or execute_drive first. Allows otherwise.
//
// Silent (exit 0 with no output) when:
//   - the registry file is absent (cladding not initialised in this
//     cwd → this hook is opt-in per-project, registry presence is the
//     activation signal),
//   - stdin payload is malformed (best-effort fail-open),
//   - the registry file is corrupt (fail-open rather than block
//     every Edit/Write across the user's projects).
//
// The Layer-C hook is the strongest enforcement in the four-layer
// defense (A: trigger guidance / B: MCP tool descriptions / C: this
// hook / D: post-hoc auditor). It is also the most host-specific —
// the same wire-up for Codex / Cursor / Gemini lands in 0.4.8+.

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
  payload = JSON.parse(raw);
} catch {
  process.exit(0); // malformed payload → silent allow
}

const cwd = payload?.cwd ?? process.cwd();
const registryPath = join(cwd, '.cladding', 'work-registry.json');

if (!existsSync(registryPath)) process.exit(0); // cladding not initialised → silent allow

let registry;
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8'));
} catch {
  process.exit(0); // corrupt registry → fail-open
}

const activeIds = Object.keys(registry?.active ?? {});
if (activeIds.length > 0) process.exit(0); // open transaction → allow

const response = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
      'cladding: no active work transaction. Call enter_work({featureId}) — or execute_drive({scenarioId | intent}) for a multi-feature bundle — before any Edit / Write tool. See AGENTS.md / CLAUDE.md trigger guidance (F-8880ee) for details.',
  },
};
process.stdout.write(JSON.stringify(response));
process.exit(0);
