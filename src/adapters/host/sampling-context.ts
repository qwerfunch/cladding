// Cladding · Host adapter · Sampling context (v0.2.26, F-075)
//
// Lightweight module-level registry that lets `clad serve` advertise
// "a sampling-capable MCP server is connected now" to the host adapters
// (`generic-mcp`, `claude-code`). When the registry holds a server,
// the host adapters route LLM dispatch through McpSamplingTransport
// instead of falling back to MockTransport. When it's null, the host
// adapters keep the v0.2.0 mock behaviour.
//
// Architecture note: the registry is module-level (singleton) because
// a cladding process owns at most one stdio MCP server. The single
// instance is shared by every host adapter so the routing decision is
// uniform — you can't have `generic-mcp` on Sampling and `claude-code`
// on Mock in the same process. Multi-instance support is not on the
// roadmap and would require an explicit handle anyway.
//
// `clad serve` calls `setHostMcpServer(server)` after `buildServer`;
// the production CLI path does this in `runServeCommand`. Tests that
// don't go through `clad serve` either leave the registry empty (host
// adapters stay on Mock) or call setHostMcpServer manually.

import type {SamplingCapableServer} from './transport.js';

let registered: SamplingCapableServer | null = null;

/**
 * Registers a sampling-capable server (typically the underlying
 * `Server` of an `McpServer` returned by `buildServer`). Passing
 * `null` clears the registration, restoring the Mock fallback.
 *
 * Returns a disposer for symmetry with subscribeAudit — calling it
 * clears the registration only when the current value is still the
 * one that was registered, so two `clad serve` instances (which
 * shouldn't coexist in normal use) cannot accidentally clobber each
 * other.
 */
export function setHostMcpServer(server: SamplingCapableServer | null): () => void {
  const previous = registered;
  registered = server;
  return () => {
    if (registered === server) registered = previous;
  };
}

/**
 * Returns the currently-registered sampling-capable server, or
 * `null` when no `clad serve` is wired up.
 */
export function getHostMcpServer(): SamplingCapableServer | null {
  return registered;
}

/**
 * Test-only: clears the registration unconditionally.
 *
 * Production code should never call this — `setHostMcpServer(null)`
 * via the dispose callback is the correct path. Tests that swap a
 * stub server and then forget to dispose end up with cross-test
 * state, so this helper exists as a clean reset hook.
 */
export function clearHostMcpServerForTesting(): void {
  registered = null;
}
