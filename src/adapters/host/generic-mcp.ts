// Cladding · Host adapter · generic MCP
//
// Dispatches a persona invocation through whatever MCP-aware host
// is running cladding (Cursor · Continue · Cline · any other client
// that speaks the Model Context Protocol). Like the claude-code
// adapter, this file ships the **mock stage**: interface-conformant,
// deterministic stub body. Real MCP roundtrip lands in v0.3.0 once
// the `clad serve` MCP server mode is in place — see
// `docs/multi-provider-roadmap.md` ("Transport architectural
// decision") for the plan. The interface this file conforms to is
// stable across that change; only the body of `invokeAgent` swaps.
//
// @see adapters/types.ts — the AgentAdapter contract.
// @see https://modelcontextprotocol.io/ — the upstream MCP spec.
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
 * Returns true when an MCP host is detectable.
 *
 * MCP clients commonly expose `MCP_SERVER_*` or `MCP_TRANSPORT` in
 * the spawned subprocess. The auto-detector treats this as the
 * fallback when no more-specific host is present.
 */
export function isMcpRuntime(): boolean {
  return Boolean(process.env.MCP_TRANSPORT || process.env.MCP_SERVER_NAME);
}

/**
 * Builds a deterministic mock {@link AgentResult} for a (persona,
 * context) pair. Same shape as the claude-code mock so the parity
 * test can prove the schema is adapter-invariant.
 */
function mockResult(persona: PersonaSpec, ctx: AgentContext): AgentResult {
  return {
    identity: {
      author: 'llm',
      name: `generic-mcp:${persona.id}`,
      timestamp: new Date().toISOString(),
    },
    summary: `[mock generic-mcp] persona=${persona.id} feature=${ctx.featureId}`,
    mutations: [],
    notes: 'mock stage — real MCP dispatch lands in v0.3.0 via the cladding MCP server',
  };
}

export const genericMcpAdapter: AgentAdapter = {
  mode: 'host',
  name: 'generic-mcp',
  capabilities: CAPABILITIES,
  invokeAgent(persona, ctx) {
    return Promise.resolve(mockResult(persona, ctx));
  },
  healthCheck(): Promise<HealthStatus> {
    if (isMcpRuntime()) {
      return Promise.resolve({ready: true});
    }
    return Promise.resolve({
      ready: false,
      reason: 'no MCP transport detected on the current process',
    });
  },
};
