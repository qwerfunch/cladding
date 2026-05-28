// Cladding · agents · per-host capability translator (0.4.11 PR-B)
//
// Translates a PersonaSpec's provider-agnostic capabilities (read /
// write / edit / exec / dispatch) into the host's native tool-gating
// shape. Consumed by:
//   - src/work/transaction.ts:enterWork — embeds the envelope in
//     EnterWorkResult.capabilityEnvelope so the host AI's sub-agent
//     dispatch carries the right tool allowlist
//   - scripts/build-plugin.mjs Phase E (later PR) — emits capability-
//     derived tool lists into each host's sub-agent manifest
//
// Per-host shape:
//
//   Claude Code / Cursor / Antigravity:
//     {host, tools: string[], permissionMode?, maxTurns?}
//
//   Codex:
//     {host: 'codex', mcpServers: string[], sandboxMode, maxTurns?}
//
//   Gemini:
//     {host: 'gemini', allowedTools: string[], maxTurns?}
//
//   Generic (Tier 3):
//     {host: 'generic'} — no enforcement; host-self-inject path
//
// hostHints fields take precedence when present:
//   - persona.hostHints.sandbox_mode → overrides derivation for Codex
//   - persona.hostHints.permissionMode → emitted as Claude Code
//     permissionMode (ignored by other hosts)
//   - persona.hostHints.maxTurns → emitted on every host that supports it

import type {Capability, PersonaSpec} from '../adapters/types.js';
import {
  CLAUDE_STYLE_TOOLS,
  GEMINI_TOOLS,
  deriveCodexMcpServers,
  deriveCodexSandbox,
} from './capability-map.js';
import type {HostName} from './host-detect.js';

/** Host-specific dispatch envelope returned by translateCapabilities. */
export type CapabilityEnvelope =
  | {
      readonly host: 'claude-code';
      readonly tools: readonly string[];
      readonly permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'dontAsk';
      readonly maxTurns?: number;
    }
  | {
      readonly host: 'cursor';
      readonly tools: readonly string[];
      readonly maxTurns?: number;
    }
  | {
      readonly host: 'antigravity';
      readonly tools: readonly string[];
      readonly maxTurns?: number;
    }
  | {
      readonly host: 'codex';
      readonly mcpServers: readonly string[];
      readonly sandboxMode: 'read-only' | 'workspace-write' | 'danger-full-access';
      readonly maxTurns?: number;
    }
  | {
      readonly host: 'gemini';
      readonly allowedTools: readonly string[];
      readonly maxTurns?: number;
    }
  | {
      readonly host: 'generic';
    };

/**
 * Translates a persona's capability set into the host's native tool /
 * sandbox gating shape. Pure function — same inputs always produce
 * same outputs, no I/O.
 *
 * For Tier 3 (generic) the envelope is intentionally empty — the host
 * AI runs in self-inject mode and there is no native enforcement layer
 * to populate. PR-B's dispatch_drift auditor warns when a Tier 1 host
 * receives self-inject mode (the inverse situation).
 */
export function translateCapabilities(persona: PersonaSpec, host: HostName): CapabilityEnvelope {
  const caps = persona.capabilities;
  const hints = persona.hostHints;

  switch (host) {
    case 'claude-code':
      return stripUndefined({
        host: 'claude-code' as const,
        tools: collectClaudeStyle(caps),
        permissionMode: hints?.permissionMode,
        maxTurns: hints?.maxTurns,
      });
    case 'cursor':
      return stripUndefined({
        host: 'cursor' as const,
        tools: collectClaudeStyle(caps),
        maxTurns: hints?.maxTurns,
      });
    case 'antigravity':
      return stripUndefined({
        host: 'antigravity' as const,
        tools: collectClaudeStyle(caps),
        maxTurns: hints?.maxTurns,
      });
    case 'codex':
      return stripUndefined({
        host: 'codex' as const,
        mcpServers: deriveCodexMcpServers(caps),
        // Explicit hostHints.sandbox_mode wins over derivation — lets
        // a persona declare 'danger-full-access' on purpose.
        sandboxMode: hints?.sandbox_mode ?? deriveCodexSandbox(caps),
        maxTurns: hints?.maxTurns,
      });
    case 'gemini':
      return stripUndefined({
        host: 'gemini' as const,
        allowedTools: collectGemini(caps),
        maxTurns: hints?.maxTurns,
      });
    case 'generic':
    default:
      return {host: 'generic'};
  }
}

/** Builds the deduplicated Claude-style tool list for the given capability set. */
function collectClaudeStyle(caps: ReadonlySet<Capability>): readonly string[] {
  return collectTools(caps, CLAUDE_STYLE_TOOLS);
}

/** Builds the deduplicated Gemini allowed_tools list for the given capability set. */
function collectGemini(caps: ReadonlySet<Capability>): readonly string[] {
  return collectTools(caps, GEMINI_TOOLS);
}

function collectTools(
  caps: ReadonlySet<Capability>,
  table: Readonly<Record<Capability, readonly string[]>>,
): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cap of caps) {
    for (const tool of table[cap] ?? []) {
      if (!seen.has(tool)) {
        seen.add(tool);
        out.push(tool);
      }
    }
  }
  return out;
}

/**
 * Removes keys whose value is undefined so the envelope JSON-serialises
 * cleanly (host adapters that JSON.stringify the envelope shouldn't see
 * `"permissionMode": undefined` in the output).
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}
