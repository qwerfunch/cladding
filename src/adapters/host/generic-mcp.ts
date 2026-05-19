// Cladding · Host adapter · generic MCP
//
// Dispatches a persona invocation through whatever MCP-aware host
// is running cladding (Cursor · Continue · Cline · any MCP client).
// As of v0.2.19, this file composes a {@link Transport} rather than
// inlining the dispatch body.
//
// v0.2.19 still ships the mock body via MockTransport. v0.2.20 swaps
// the MockTransport instance for a real MCP roundtrip transport
// once `clad serve` MCP server mode is in place.
//
// @see src/adapters/host/transport.ts — Transport interface + MockTransport.
// @see src/adapters/types.ts — the AgentAdapter contract.
// @see https://modelcontextprotocol.io/ — the upstream MCP spec.
// @see docs/multi-provider-roadmap.md — Transport architectural decision.
// @see spec/features/F-049.yaml AC-091 — host adapters require no API key.
// @see spec/features/F-068.yaml — Transport interface extraction.

import process from 'node:process';

import type {AgentAdapter, Capability} from '../types.js';
import {MockTransport, type Transport} from './transport.js';

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

const defaultTransport: Transport = new MockTransport({
  hostName: 'generic-mcp',
  readyWhen: isMcpRuntime,
  notReadyReason: 'no MCP runtime detected (MCP_TRANSPORT / MCP_SERVER_NAME unset)',
});

export const genericMcpAdapter: AgentAdapter = {
  mode: 'host',
  name: 'generic-mcp',
  capabilities: CAPABILITIES,
  invokeAgent: (persona, ctx) => defaultTransport.invoke(persona, ctx),
  healthCheck: () => defaultTransport.ready(),
};
