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
 * Default transport for the claude-code adapter. v0.2.19 ships
 * MockTransport here; v0.2.20 will introduce a `ClaudeCodeTransport`
 * real body and select it when the runtime is detected.
 */
const defaultTransport: Transport = new MockTransport({
  hostName: 'claude-code',
  readyWhen: isClaudeCodeRuntime,
  notReadyReason: 'not running inside a Claude Code session',
});

export const claudeCodeAdapter: AgentAdapter = {
  mode: 'host',
  name: 'claude-code',
  capabilities: CAPABILITIES,
  invokeAgent: (persona, ctx) => defaultTransport.invoke(persona, ctx),
  healthCheck: () => defaultTransport.ready(),
};
