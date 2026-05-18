// Cladding · Host adapter · Claude Code
//
// Dispatches a persona invocation through the Claude Code agentic
// session that hosts cladding. Cladding's CLI is a single-shot
// process, so the real Task / Agent tool invocation will be wired
// in the third v0.2.0 PR — that wiring needs Claude Code to expose
// a child-process or MCP entry point that cladding can call back
// into.
//
// This file ships the **mock stage**: the adapter conforms to the
// interface (so drive/agent.ts can be written + tested against it),
// but `invokeAgent` returns a deterministic stub result instead of
// crossing the host boundary. The third PR replaces the stub body;
// the surrounding code (selector, drive loop, parity test) is
// stable.
//
// @see adapters/types.ts — the AgentAdapter contract.
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
    notes: 'mock stage — real Claude Code subagent dispatch lands in the next v0.2.0 PR',
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
