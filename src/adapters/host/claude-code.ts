// Cladding · Host adapter · Claude Code
//
// Dispatches a persona invocation through the Claude Code agentic
// session that hosts cladding. As of v0.2.19, this file composes a
// {@link Transport} rather than inlining the dispatch body — the
// adapter and the transport are now separable layers.
//
// v0.2.19 still ships the mock body (via MockTransport). v0.2.20
// swaps the MockTransport instance for a real Claude Code subagent
// dispatch transport without touching this adapter object's
// identity, capabilities, or contract.
//
// @see src/adapters/host/transport.ts — Transport interface + MockTransport.
// @see src/adapters/types.ts — the AgentAdapter contract.
// @see docs/multi-provider-roadmap.md — Transport architectural decision.
// @see spec/features/F-049.yaml AC-091 — host adapters require no API key.
// @see spec/features/F-068.yaml AC-184 — Transport interface extraction.

import process from 'node:process';

import type {AgentAdapter, Capability} from '../types.js';
import {getHostMcpServer} from './sampling-context.js';
import {McpSamplingTransport, MockTransport, type Transport} from './transport.js';

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
 * Mock fallback used when no MCP server is registered through
 * `setHostMcpServer`. Kept as a module-level singleton so the
 * (rare) Mock path stays allocation-free.
 */
const mockFallback: Transport = new MockTransport({
  hostName: 'claude-code',
  readyWhen: isClaudeCodeRuntime,
  notReadyReason: 'not running inside a Claude Code session',
});

/**
 * Cache for the active McpSamplingTransport so repeated dispatches
 * inside one `clad serve` session don't re-allocate. Reset when the
 * registered server identity changes (e.g., test swap).
 */
let cachedSamplingTransport: McpSamplingTransport | null = null;
let cachedSamplingServer: ReturnType<typeof getHostMcpServer> = null;

/**
 * Picks the active transport: McpSamplingTransport when `clad serve`
 * has registered a sampling-capable server, otherwise the Mock
 * fallback. Decision runs per-invoke so a server registered after
 * the adapter object was first imported still routes correctly.
 */
function activeTransport(): Transport {
  const server = getHostMcpServer();
  if (!server) {
    cachedSamplingTransport = null;
    cachedSamplingServer = null;
    return mockFallback;
  }
  if (cachedSamplingServer !== server) {
    cachedSamplingServer = server;
    cachedSamplingTransport = new McpSamplingTransport(server, {
      id: 'mcp-sampling:claude-code',
    });
  }
  // cachedSamplingTransport is set whenever cachedSamplingServer is.
  return cachedSamplingTransport as McpSamplingTransport;
}

export const claudeCodeAdapter: AgentAdapter = {
  mode: 'host',
  name: 'claude-code',
  capabilities: CAPABILITIES,
  invokeAgent: (persona, ctx) => activeTransport().invoke(persona, ctx),
  healthCheck: () => activeTransport().ready(),
};
