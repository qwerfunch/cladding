// Cladding · agents · capability-to-tool maps (0.4.11 PR-B)
//
// Provider-agnostic capability strings (read / write / edit / exec /
// dispatch) come from persona frontmatter via PersonaSpec.capabilities.
// Each host expresses tool gating differently:
//
//   - Claude Code & Cursor:  named tool allowlist (Read, Glob, Grep,
//                            Write, Edit, Bash, Task, ...)
//   - Codex:                 MCP server allowlist + sandbox_mode enum
//   - Gemini:                frontmatter `allowed_tools` (Claude-style
//                            but snake_case field name)
//   - Antigravity:           Claude-style tool allowlist
//   - Generic:               no enforcement (host-self-inject path)
//
// This file is the single source-of-truth for those mappings; both
// translateCapabilities() and the build-plugin.mjs Phase E emitters
// will eventually consume from here (Phase E currently mirrors the
// frontmatter `tools` field verbatim — capability-derived emission
// is a 0.5.x cleanup tracked separately).

import type {Capability} from '../adapters/types.js';

/**
 * Per-capability tool tokens for Claude-Code-style hosts (Claude Code,
 * Cursor, Antigravity). Tools the host AI does NOT have in its allowlist
 * become tool_use errors at dispatch time.
 *
 * `read` deliberately includes Glob + Grep — those are the discovery
 * primitives every read-only persona (reviewer, observability) needs.
 * Bash is gated behind `exec` so personas without exec can't shell out.
 */
export const CLAUDE_STYLE_TOOLS: Readonly<Record<Capability, readonly string[]>> = {
  read: ['Read', 'Glob', 'Grep'],
  write: ['Write'],
  edit: ['Edit'],
  exec: ['Bash'],
  // dispatch = sub-agent fan-out. Only the orchestrator persona declares
  // this capability today; the Task tool is what Claude Code uses for it.
  dispatch: ['Task'],
};

/**
 * Per-capability tool tokens for Gemini's allowed_tools frontmatter
 * field. Gemini uses snake_case tool names that differ from Claude's:
 *   Read → ReadFile, Glob → Glob (unchanged), Grep → Grep, Write →
 *   WriteFile, Edit → EditFile, Bash → Shell, Task → SubAgent.
 *
 * Source: Gemini CLI 0.5.x sub-agent docs (April 2026 preview).
 */
export const GEMINI_TOOLS: Readonly<Record<Capability, readonly string[]>> = {
  read: ['ReadFile', 'Glob', 'Grep'],
  write: ['WriteFile'],
  edit: ['EditFile'],
  exec: ['Shell'],
  dispatch: ['SubAgent'],
};

/**
 * Codex sandbox mode derived from the capability set. Codex does not
 * gate per-tool — it gates the whole sandbox: read-only / workspace-write
 * / danger-full-access. The mapping favours least-privilege:
 *   - exec capability + write/edit  → workspace-write (still no escape to host fs)
 *   - exec capability alone          → workspace-write (exec implies the sandbox needs write for tooling output)
 *   - write or edit capability       → workspace-write
 *   - read only                      → read-only
 *
 * danger-full-access is never emitted automatically — a persona must
 * declare hostHints.sandbox_mode = 'danger-full-access' explicitly,
 * which translateCapabilities passes through verbatim.
 */
export function deriveCodexSandbox(
  capabilities: ReadonlySet<Capability>,
): 'read-only' | 'workspace-write' | 'danger-full-access' {
  if (capabilities.has('write') || capabilities.has('edit') || capabilities.has('exec')) {
    return 'workspace-write';
  }
  return 'read-only';
}

/**
 * Codex MCP server allowlist. Every cladding-managed persona at minimum
 * needs the cladding MCP server (spec / work / drive transaction tools).
 * Future personas may declare additional servers via hostHints (PR-C
 * scope).
 *
 * 0.4.11 default: ['cladding'] for every persona. The capability set
 * is not consulted here yet — Codex restricts at sandbox level, not
 * MCP-tool level, so a fine-grained per-capability MCP allowlist would
 * be redundant. PR-C may revisit when per-persona MCP scoping lands.
 */
export function deriveCodexMcpServers(_capabilities: ReadonlySet<Capability>): readonly string[] {
  return ['cladding'];
}
