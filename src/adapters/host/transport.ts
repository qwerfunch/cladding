// Cladding · Host adapter · Transport layer
//
// v0.2.19 (F-068) splits the host adapters into two layers:
//   1. The AgentAdapter (`AgentAdapter` contract) — what drive/agent.ts
//      sees. Its `invokeAgent` and `healthCheck` are thin wrappers.
//   2. The Transport (this file) — the body that actually crosses
//      the host boundary. The body is the part that has to swap
//      between "mock" (deterministic stub) and "real" (MCP server
//      roundtrip or subagent dispatch) without touching the
//      adapter contract or the surrounding selector / drive loop.
//
// v0.2.19 ships only the MockTransport. v0.2.20 replaces selected
// adapters' Mock with a real Transport implementation. Because the
// adapter is the same object both times, every code path that
// dispatches through `selectAdapter(cwd)` automatically picks up
// the real body — no caller change required.
//
// @see src/adapters/types.ts — the AgentAdapter contract this layer underlies.
// @see docs/multi-provider-roadmap.md — Transport architectural decision.
// @see spec/features/F-049.yaml — original adapter contract.
// @see spec/features/F-068.yaml — this extraction.

import type {AgentContext, AgentResult, HealthStatus, PersonaSpec} from '../types.js';

/**
 * Body of an adapter — the part that actually crosses the host
 * boundary. v0.2.19 ships {@link MockTransport} only; v0.2.20 adds
 * `ClaudeCodeTransport` and `McpTransport` real bodies.
 *
 * Stable contract — adapters that compose a Transport never have to
 * change when the body swaps from mock to real. The selector,
 * drive loop, and parity tests all stay on the AgentAdapter
 * contract; only the Transport instance inside each adapter changes.
 */
export interface Transport {
  /** Stable id for telemetry / logs (e.g. `mock:claude-code`). */
  readonly id: string;
  /**
   * Invoke the persona in the host context. The body is allowed to
   * be a network roundtrip, a deterministic stub, or anything in
   * between — the AgentAdapter caller only sees an AgentResult.
   */
  invoke(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult>;
  /**
   * Returns `{ready: true}` when the transport is wired up enough
   * to dispatch. Mock transports return `ready: true` when the
   * runtime they target is detected; real transports may also probe
   * the network / SDK availability.
   */
  ready(): Promise<HealthStatus>;
}

/** Options for {@link MockTransport}. */
export interface MockTransportOptions {
  /** Host display name — surfaces as `mock:<hostName>` in identity. */
  readonly hostName: string;
  /** Predicate that decides whether `ready()` returns `true`. */
  readonly readyWhen: () => boolean;
  /** Reason returned when the predicate is false. */
  readonly notReadyReason: string;
}

/**
 * Deterministic stub transport. Returns an AgentResult with no
 * mutations and a fixed summary string. v0.2.0..v0.2.19 used this
 * body inline inside each adapter; v0.2.19 extracted it so the same
 * code path can be replaced surgically by a real Transport in
 * v0.2.20.
 *
 * Why this is OK to ship: the surrounding code (`drive/agent.ts`,
 * `drive/loop.ts`, the selector) doesn't care whether the result is
 * real or mock — it only checks the AgentResult shape + the
 * reviewer-identity barrier (F-049 AC-086). The mock satisfies the
 * contract while keeping the loop testable end-to-end.
 */
export class MockTransport implements Transport {
  readonly id: string;
  private readonly readyWhen: () => boolean;
  private readonly notReadyReason: string;

  constructor(opts: MockTransportOptions) {
    this.id = `mock:${opts.hostName}`;
    this.readyWhen = opts.readyWhen;
    this.notReadyReason = opts.notReadyReason;
  }

  invoke(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult> {
    return Promise.resolve({
      identity: {
        author: 'llm',
        name: `${this.id}:${persona.id}`,
        timestamp: new Date().toISOString(),
      },
      summary: `[${this.id}] persona=${persona.id} feature=${ctx.featureId}`,
      mutations: [],
      notes: `${this.id} stage — real transport lands in v0.3.0`,
    });
  }

  ready(): Promise<HealthStatus> {
    if (this.readyWhen()) return Promise.resolve({ready: true});
    return Promise.resolve({ready: false, reason: this.notReadyReason});
  }
}
