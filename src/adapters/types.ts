// Cladding · Agent adapter contract
//
// The two-mode model from F-049 / v0.1.2: agent dispatch travels
// either through a host (Claude Code subagent · Cursor agent ·
// Continue · Cline · generic MCP) — which keeps using the user's
// existing subscription and asks for no API key — or through a
// stand-alone SDK adapter (Anthropic / OpenAI / Gemini) when the
// caller explicitly opts in via `agent.mode = sdk`.
//
// Every adapter implements the same shape. drive/agent.ts dispatches
// to the active adapter; drive/loop.ts is unaware of which one ran.
// Parity tests (tests/adapters/*-parity.test.ts) prove the evidence
// schema and halt enum stay invariant across adapters.
//
// @see spec/features/F-049.yaml AC-085 / AC-088 / AC-089 / AC-090 /
//      AC-091 — the normative contract this interface implements.
// @see docs/multi-provider-roadmap.md — host vs sdk model overview.
// @see ironclad-design/14-agent-orchestration.md — 5-agent topology.

import type {Identity} from '../hitl/identity.js';

/** Which dispatch mode an adapter runs in. */
export type AdapterMode = 'host' | 'sdk';

/** Capabilities the adapter exposes — mirrors agents/*.md frontmatter. */
export type Capability = 'read' | 'write' | 'edit' | 'exec' | 'dispatch';

/**
 * Persona definition the runtime hands to the adapter.
 *
 * The body is the prose prompt loaded from `agents/<name>.md`; the
 * adapter is responsible for shaping it for its specific LLM/host
 * transport. The capabilities array constrains what the persona is
 * allowed to do (mirrors the `capabilities:` frontmatter the
 * persona file declares).
 */
export interface PersonaSpec {
  /** Persona id matching `agents/<id>.md` (orchestrator · librarian · …). */
  readonly id: string;
  /** Free-form role + responsibilities, lifted from the persona file. */
  readonly body: string;
  /** Provider-agnostic capability set this persona is authorised to use. */
  readonly capabilities: ReadonlySet<Capability>;
}

/**
 * Per-invocation context. Keeps the payload minimal — only the
 * current feature shard plus its tagged guardrails — so cost stays
 * O(1) per call (F-049 AC-085).
 */
export interface AgentContext {
  /** F-NNN id of the feature the loop is currently authoring. */
  readonly featureId: string;
  /** YAML text of the feature shard (`spec/features/F-NNN.yaml`). */
  readonly featureShard: string;
  /** Guardrail snippets to inject (Architecture rules, code style, etc.). */
  readonly guardrails: readonly string[];
  /** Working directory the agent should treat as project root. */
  readonly cwd: string;
}

/** What the adapter returns after one persona dispatch. */
export interface AgentResult {
  /** Identity of the actor that produced this output. */
  readonly identity: Identity;
  /**
   * Free-form summary of what the agent did this turn. The drive
   * loop records this in the audit log as evidence `content`.
   */
  readonly summary: string;
  /**
   * Files the agent created or modified during the turn. The drive
   * loop replays these to the working tree.
   */
  readonly mutations: readonly AgentMutation[];
  /**
   * Optional structured note the agent wants downstream loop steps
   * (or a future reviewer) to see — never user-facing.
   */
  readonly notes?: string;
}

/** A single file create / edit / delete the adapter reports. */
export interface AgentMutation {
  readonly path: string;
  readonly kind: 'create' | 'edit' | 'delete';
  /** New contents for create/edit; ignored for delete. */
  readonly contents?: string;
}

/** Status returned by `healthCheck()`. */
export interface HealthStatus {
  readonly ready: boolean;
  /** Human-readable reason when `ready=false`. */
  readonly reason?: string;
}

/**
 * The contract every adapter (host or sdk) implements.
 *
 * Conformance:
 * - `invokeAgent` must be idempotent on identical (persona, ctx) —
 *   the deterministic-evidence requirement (F-049 AC-090).
 * - Errors during invocation should be thrown so the drive loop can
 *   emit `LLM_UNAVAILABLE` with the underlying error class.
 * - Host adapters must not read any `*_API_KEY` env var (F-049
 *   AC-091). SDK adapters read their respective env var only.
 */
export interface AgentAdapter {
  readonly mode: AdapterMode;
  /** Short adapter id — `claude-code`, `generic-mcp`, `anthropic`, … */
  readonly name: string;
  /** Capabilities this transport supports — bounded by host or SDK. */
  readonly capabilities: ReadonlySet<Capability>;
  invokeAgent(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult>;
  healthCheck(): Promise<HealthStatus>;
}
