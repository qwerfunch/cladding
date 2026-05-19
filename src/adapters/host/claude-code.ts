// Cladding · Host adapter · Claude Code
//
// Dispatches a persona invocation through the Claude Code agentic
// session that hosts cladding. Cladding's CLI is a single-shot
// process; Claude Code's Task / Agent tools live inside a long-
// running session and are not reachable from a separate process.
// The architectural decision for the real transport is recorded in
// `docs/multi-provider-roadmap.md` ("Transport architectural
// decision"): cladding ships an MCP server mode (`clad serve`) in
// v0.3.0 so any MCP-aware host — including Claude Code — can call
// cladding's tools from inside its session.
//
// This file ships the **mock stage**: the adapter conforms to the
// interface (so drive/agent.ts can be written + tested against it),
// but `invokeAgent` returns a deterministic stub result instead of
// crossing the host boundary. v0.3.0 replaces the stub body with
// a Claude Code subagent dispatch over the MCP server; the
// surrounding code (selector, drive loop, parity test) is stable
// across that change.
//
// @see adapters/types.ts — the AgentAdapter contract.
// @see docs/multi-provider-roadmap.md — Transport architectural
//      decision (the MCP-server-mode plan that unlocks the real body).
// @see spec/features/F-049.yaml AC-091 — host adapters require no API key.

import type {
  AgentAdapter,
  AgentContext,
  AgentResult,
  Capability,
  HealthStatus,
  PersonaSpec,
} from '../types.js';

const CAPABILITIES: ReadonlySet<Capability> = new Set<Capability>([
  'read',
  'write',
  'edit',
  'exec',
  'dispatch',
]);

/**
 * Returns true when the runtime looks like a Claude Code session.
 *
 * Claude Code sets `CLAUDECODE=1` and a few other environment
 * variables (`CLAUDE_CODE_*`). The auto-detector in
 * `adapters/index.ts` reads this to pick this adapter by default
 * when no explicit config exists.
 */
export function isClaudeCodeRuntime(): boolean {
  return process.env.CLAUDECODE === '1' || Boolean(process.env.CLAUDE_CODE_SESSION_ID);
}

/**
 * Builds a deterministic mock {@link AgentResult} for a (persona,
 * context) pair. The real adapter will replace this body with a
 * Claude Code subagent dispatch; the mock keeps the rest of the
 * runtime testable in the meantime.
 */
function mockResult(persona: PersonaSpec, ctx: AgentContext): AgentResult {
  return {
    identity: {
      author: 'llm',
      name: `claude-code:${persona.id}`,
      timestamp: new Date().toISOString(),
    },
    summary: `[mock claude-code] persona=${persona.id} feature=${ctx.featureId}`,
    mutations: [],
    notes: 'mock stage — real Claude Code subagent dispatch lands in v0.3.0 via MCP server mode',
  };
}

export const claudeCodeAdapter: AgentAdapter = {
  mode: 'host',
  name: 'claude-code',
  capabilities: CAPABILITIES,
  invokeAgent(persona, ctx) {
    return Promise.resolve(mockResult(persona, ctx));
  },
  healthCheck(): Promise<HealthStatus> {
    if (isClaudeCodeRuntime()) {
      return Promise.resolve({ready: true});
    }
    return Promise.resolve({
      ready: false,
      reason: 'not running inside a Claude Code session',
    });
  },
};
