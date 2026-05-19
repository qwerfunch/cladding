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
// v0.2.19 ships only the MockTransport. v0.2.25 (F-074) adds
// {@link McpSamplingTransport} — the real body that delegates the
// LLM call to a connected MCP client via the SDK's `createMessage`
// sampling request. The host adapter swaps Mock ↔ Sampling based
// on whether `clad serve` is wired up; the AgentAdapter contract
// stays invariant.
//
// @see src/adapters/types.ts — the AgentAdapter contract this layer underlies.
// @see docs/multi-provider-roadmap.md — Transport architectural decision.
// @see spec/features/F-049.yaml — original adapter contract.
// @see spec/features/F-068.yaml — this extraction.
// @see spec/features/F-074.yaml — McpSamplingTransport contract.

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

/**
 * Minimal sampling-capable view of an MCP server. The full
 * `@modelcontextprotocol/sdk` `Server` class satisfies this shape;
 * tests inject a stub matching the same surface, which keeps the
 * Transport unit-testable without booting the SDK.
 *
 * See `Server.createMessage` in the SDK — the runtime forwards the
 * request to the connected MCP client over the wire and returns the
 * client's sampling response.
 */
export interface SamplingCapableServer {
  // `messages` is intentionally a mutable array, not ReadonlyArray —
  // function-parameter types are contravariant, so a real
  // `@modelcontextprotocol/sdk` Server (which only accepts mutable
  // arrays) wouldn't satisfy a ReadonlyArray-typed interface. The
  // wider mutable shape is the assignment-compatible one.
  createMessage(params: {
    messages: Array<{
      role: 'user' | 'assistant';
      content: {type: 'text'; text: string};
    }>;
    systemPrompt?: string;
    maxTokens: number;
  }): Promise<{
    model: string;
    stopReason?: string;
    role: 'user' | 'assistant';
    content: {type: 'text'; text: string} | {type: string; [k: string]: unknown};
  }>;
}

/** Options for {@link McpSamplingTransport}. */
export interface McpSamplingTransportOptions {
  /**
   * Maximum tokens the host's sampling call may return. Defaults to
   * 4096 — same default as `AnthropicTransport` so a feature behaves
   * the same regardless of which real transport is active.
   */
  readonly maxTokens?: number;
  /** Stable id surfaced in identity / telemetry. Defaults to `mcp-sampling:host`. */
  readonly id?: string;
}

/**
 * Real-host Transport that delegates the LLM call to the connected
 * MCP client via the SDK's `createMessage` sampling request.
 *
 * Architectural placement: cladding boots `clad serve` as the MCP
 * server; a sampling-capable client (Claude Code, Cursor, Continue,
 * …) connects over stdio. When the drive loop needs to run a
 * persona, this transport asks the server to round-trip a sampling
 * request to that client, then maps the client's reply back to an
 * AgentResult shape. The drive loop never sees the MCP layer — it
 * still calls `adapter.invokeAgent(persona, ctx)` and receives an
 * AgentResult.
 *
 * Mutations are NOT inferred from the reply in v0.2.25 — structured
 * mutations land once the tool-use protocol is wired up. v0.2.25's
 * contribution is proving the dispatch path end-to-end through the
 * MCP server boundary.
 */
export class McpSamplingTransport implements Transport {
  readonly id: string;
  private readonly server: SamplingCapableServer;
  private readonly maxTokens: number;

  constructor(server: SamplingCapableServer, opts: McpSamplingTransportOptions = {}) {
    this.server = server;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.id = opts.id ?? 'mcp-sampling:host';
  }

  async invoke(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult> {
    const userMessage = buildSamplingUserMessage(ctx);
    const reply = await this.server.createMessage({
      messages: [{role: 'user', content: {type: 'text', text: userMessage}}],
      systemPrompt: persona.body,
      maxTokens: this.maxTokens,
    });
    const replyText = extractSamplingText(reply.content);
    return {
      identity: {
        author: 'llm',
        name: `${this.id}:${persona.id}`,
        timestamp: new Date().toISOString(),
      },
      summary: replyText.slice(0, 200),
      mutations: [],
      notes: `model=${reply.model} stop=${reply.stopReason ?? 'unknown'}`,
    };
  }

  ready(): Promise<HealthStatus> {
    // The server boundary itself does not let us probe the client's
    // sampling capability without sending a sampling request. The
    // first invoke() will surface a transport error if the client
    // refuses, classifiable via classifyTransportError.
    return Promise.resolve({ready: true});
  }
}

function buildSamplingUserMessage(ctx: AgentContext): string {
  const guardrails =
    ctx.guardrails.length > 0
      ? `\n\nGuardrails:\n${ctx.guardrails.map((g) => `- ${g}`).join('\n')}`
      : '';
  return [
    `Feature: ${ctx.featureId}`,
    '',
    'Feature shard (YAML):',
    ctx.featureShard,
    guardrails,
  ].join('\n');
}

function extractSamplingText(
  content: {type: 'text'; text: string} | {type: string; [k: string]: unknown},
): string {
  if (content.type === 'text' && typeof (content as {text?: string}).text === 'string') {
    return (content as {text: string}).text.trim();
  }
  return '';
}
