---
title: Multi-provider agent dispatch — roadmap
audience: cladding maintainers · external contributors adding a new host/sdk adapter
applies_to: adapters/* (planned v0.2.0)
related_spec: spec/features/F-049.yaml
---

# Multi-provider agent dispatch

LLM access today splits into two modes. cladding treats both as first-class but defaults to the one that does not require users to manage API keys.

## Two modes

| Mode | Who calls the LLM | API key | Examples | cladding adapter directory |
|---|---|---|---|---|
| **Host-bound (default)** | the host environment | not required | Claude Code (Claude Max/Pro subscription), Cursor, Continue, Cline, ChatGPT plugin, Gemini Code Assist | `src/adapters/host/*` |
| **Stand-alone SDK (option)** | cladding directly | required (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`) | CLI · CI · headless automation | `src/adapters/sdk/*` |

cladding's v0.1.0 already runs as host-bound (the Claude Code subagent invokes Claude through the user's subscription; cladding code imports zero SDKs). The v0.2.0 work codifies that pattern as the `claude-code` host adapter and adds neighbours.

## Default selection

When no configuration is supplied, cladding picks an adapter in this order:

1. `CLADDING_AGENT_MODE` + `CLADDING_AGENT_NAME` environment variables — explicit override wins.
2. `.cladding/config.yaml` `agent.mode` + `agent.name` — project-level pin.
3. Auto-detect — runtime environment signals (e.g. `CLAUDECODE` env var, Cursor's bridge variables) pick the matching host adapter.
4. Fallback — `host` mode + `generic-mcp` adapter (MCP server present in the runtime).

cladding never reads an SDK API key unless `agent.mode = sdk` is explicitly chosen.

## Adapter contract

Every adapter implements one TypeScript interface (planned shape — final form ships with v0.2.0):

```typescript
export interface AgentAdapter {
  readonly mode: 'host' | 'sdk';
  readonly name: string;                                    // e.g. 'claude-code', 'anthropic'
  readonly capabilities: ReadonlySet<Capability>;           // see agents/*.md frontmatter
  invokeAgent(persona: PersonaSpec, ctx: AgentContext): Promise<AgentResult>;
  healthCheck(): Promise<HealthStatus>;
}
```

The `AgentResult` and the audit-log evidence shape are invariant across adapters. Parity tests prove this on every release (see F-049 AC-090).

## Adapter matrix

| Name | Mode | Status | API key | Notes |
|---|---|---|---|---|
| `claude-code` | host | **live (v0.2.26)** — routes through `McpSamplingTransport` when `clad serve` is registered, falls back to Mock otherwise | not required | Real LLM call goes through the connected MCP client via `server.createMessage` sampling. Auto-detects Claude Code via `CLAUDECODE` env var. |
| `generic-mcp` | host | **live (v0.2.26)** — same routing as `claude-code`, `mcp-sampling:generic-mcp` identity tag | not required | Works in any MCP-aware client (Cursor · Continue · Cline · …) once `clad serve` is connected. |
| `claude-anthropic` | sdk | **live (v0.2.20)** | `ANTHROPIC_API_KEY` | Direct Anthropic SDK call (`@anthropic-ai/sdk`). For CI / headless automation. |
| `openai` | sdk | reserved | `OPENAI_API_KEY` | Slot exists in `SDK_REGISTRY`; not implemented yet. |
| `gemini` | sdk | reserved | `GOOGLE_API_KEY` | Slot exists in `SDK_REGISTRY`; not implemented yet. |

v0.2.26 closes the host-mode loop: `clad serve` boots the MCP server, `setHostMcpServer` registers it, and both host adapters route LLM dispatch through `McpSamplingTransport` automatically. Standalone `clad drive` (no `clad serve`) keeps the Mock fallback so unit-test paths are unchanged.

## How to add a new adapter

1. Pick a directory: `src/adapters/host/<name>.ts` or `src/adapters/sdk/<name>.ts`.
2. Implement `AgentAdapter`. The `invokeAgent` body translates `PersonaSpec` (parsed from `src/agents/<name>.md`) plus `AgentContext` (current feature shard + tagged guardrails) into whatever the underlying transport expects.
3. Register the adapter in `src/adapters/index.ts` under the right mode.
4. Add a row to the adapter matrix above and to F-049 if you're introducing a new failure mode (AC-088 covers `host-unavailable`, `auth`, `rate-limit`, `network`, `context-window`, `safety-filter`; new modes need a new bullet).
5. Add a fixture under `tests/adapters/<your-mode>-parity.test.ts` that runs the synthetic single-feature project through your adapter and asserts identical `AgentResult` shape vs. an existing adapter.

## Known limits per adapter

- **Host adapters** depend on the host exposing a usable agent-invocation API. Cursor and Continue do today; future hosts may not — list the unsupported runtimes in this section as you learn them.
- **SDK adapters** carry the usual SDK quirks (rate limits, context windows, safety filters). The `AC-088` failure-class list grows here, not in cladding.

## Transport architectural decision (resolved in v0.2.19 → v0.2.26)

The two host adapters originally shipped as **mock implementations** that satisfied the `AgentAdapter` contract without crossing a real LLM boundary. The v0.2.19 → v0.2.26 cycle replaced the mock body with a real one. This section keeps the original "why mock" framing as historical context — `claude-code` and `generic-mcp` are now **real** behind the same contract.

### The mismatch

Cladding's `clad` CLI is a **single-shot process**. Every invocation parses arguments, runs to completion, exits. The host's agent-invocation machinery — Claude Code's Task/Agent tools, Cursor's agent API, an MCP transport — is **session-bound**: it lives inside a long-running editor/agent session and is not reachable from a separate process. So a short-running `clad drive` cannot directly call those session-bound APIs.

Three plausible bridges, and why two of them don't fit cladding's current shape:

| Bridge | Sketch | Why it (does not) work |
|---|---|---|
| Direct SDK call (Anthropic / OpenAI / Gemini) | `clad drive` reads `*_API_KEY` and calls the SDK | Breaks F-049 AC-091 (host adapters require no API key); breaks the host-bound default policy v0.1.2 baked in. SDK adapters stay opt-in. |
| Slash command output | `clad drive` prints a "do this" instruction and the host's user runs it | Surrenders autonomy back to the user. Cladding's drive loop becomes a glorified `panel`, not an autonomous orchestrator. |
| Two-process bridge | Cladding runs as a server, the host calls in | Fits — but requires picking how cladding becomes a server. See below. |

### The two server options for v0.3.0

| Option | Sketch | Notes |
|---|---|---|
| **MCP server mode (`clad serve`)** | A new long-running verb that exposes cladding's stages / drive loop / audit-log tools over the Model Context Protocol. Any MCP-aware host (Claude Code, Cursor, Continue, Cline, …) connects and calls those tools. The host's LLM does the work; cladding records the result. | Already aligns with `generic-mcp` adapter. One server implementation covers every MCP client. Adds a Node dependency on `@modelcontextprotocol/sdk`. The user starts `clad serve` once per session; the host points its MCP config at cladding's stdio. |
| **Claude Code plugin mode** | Cladding ships a real Claude Code plugin (its own `commands/`, `hooks/`, `src/agents/`) so it runs inside the host's session and can call Task/Agent tools directly. | Tighter integration with Claude Code specifically, looser fit with Cursor/Cline/Continue. Requires real plugin manifest, not the metadata file `.claude-plugin/plugin.json` currently is. |

The architectural decision was **MCP server mode is preferred** because it makes the same code work across every MCP-aware host — one server, many hosts. That decision is now implemented:

- **v0.2.24 (F-073)** — `clad serve` stdio MCP server, read surface (tools / resources / persona prompts).
- **v0.2.25 (F-074)** — `McpSamplingTransport` + audit-log live notification (`notifications/resources/updated` for `cladding://audit`).
- **v0.2.26 (F-075)** — Host adapter routing via `sampling-context`. `clad serve` registers itself; both host adapters route LLM dispatch through MCP sampling automatically when registered, Mock fallback otherwise.

The Claude Code plugin path is no longer a separate transport branch — Claude Code is just one MCP client that talks to `clad serve`. The same plumbing covers Cursor, Continue, Cline, and any future MCP-aware host.

### What every v0.2.x release contributed

| Version | Contribution |
|---|---|
| v0.2.19 (F-068) | Transport interface extraction — adapter and body split, swap-point ready. |
| v0.2.20 (F-069) | `AnthropicTransport` — first real-LLM dispatch (SDK path). |
| v0.2.21 (F-070) | Drive-loop integration test against `AnthropicTransport`. |
| v0.2.22 (F-071) | Transport-specific halt classes (`TRANSPORT_AUTH_FAILED` / `_RATE_LIMITED` / `_NETWORK`). |
| v0.2.23 (F-072) | Pre-flight health check at drive loop start. |
| v0.2.24 (F-073) | `clad serve` MCP server scaffold — read surface. |
| v0.2.25 (F-074) | `McpSamplingTransport` + live audit notification. |
| v0.2.26 (F-075) | Host adapter routing; bundle minified to ~1.1 MB; SECURITY.md MCP invariants. |

## Out of scope (until external dogfood signals it)

- Cost-aware adapter selection (smallest-model fallback). Tempting but speculative until production usage tells us the rate-limit pattern.
- Streaming responses. The current `AgentResult` is a complete struct; streaming would change the audit-log shape and trip parity.
- Multi-adapter ensemble (call two providers, pick the better answer). Defeats the deterministic-evidence claim.

## Source of truth

`spec/features/F-049.yaml` ACs 085 / 088 / 089 / 090 / 091 are the normative contract for this layer. Whenever this page disagrees with that yaml, the yaml wins — and one of the two should be patched in the same commit.
