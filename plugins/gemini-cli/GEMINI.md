# Cladding — Ironclad reference implementation

This extension wires Gemini CLI to **cladding**, a multi-agent dev harness implementing the Ironclad standard.

## What you get when this extension is enabled

- **`/cladding:sync`** — validate `spec.yaml` against the Ironclad schema
- **`/cladding:check`** — run all 13 Iron Law stages + the drift detector suite
- **`/cladding:panel`** — feature × stage Integrity Panel (project-wide status board)
- **`/cladding:drive`** — autonomous loop (iterate features, dispatch specialists + reviewer)
- **`/cladding:init`** — scaffold a new cladding workspace
- **`/cladding:serve`** — boot the MCP server (usually auto-launched, not invoked directly)
- **Auto-launched MCP server** (`clad serve`) — exposes spec, drift, events, persona prompts as MCP tools / resources / prompts to Gemini

## The five personas

Cladding orchestrates work across five agent personas. When using `/cladding:drive` or asking Gemini to reason about Ironclad features, lean on these roles:

- **orchestrator** — workflow conductor. Sequences agents based on the 5 invocation principles; routes user intent to specialists.
- **librarian** — knowledge keeper. Owns the spec, the audit log, and the long-running context. Answers "where is X documented?"
- **reviewer** — anti-self-cert guard. Inspects implementations; the structural barrier that refuses self-authored evidence (F-049 AC-086).
- **observability** — telemetry interpreter. Reads `.cladding/events.log.jsonl` and `.cladding/audit.log.jsonl`; surfaces drift trends.
- **specialists** — implementers. Authors code / tests / docs for whatever feature is active. Modifies the working tree.

The full prompt body for each persona is exposed as an MCP prompt — Gemini can request `prompts/get` against the cladding MCP server to load any of them.

## Authentication

This extension uses your **Gemini CLI Google account login** (60 req/min · 1000/day free tier). Cladding's host adapter path requires no API key — F-049 AC-091 invariant. The `gemini` slot is reserved in `src/adapters/index.ts` `SDK_REGISTRY` but the SDK adapter body is not yet implemented; if you need direct-SDK dispatch (raised quotas, CI/CD batch), open a feature request before relying on it.

## Where to learn more

- Project: <https://github.com/qwerfunch/cladding>
- Ironclad standard: <https://github.com/qwerfunch/ironclad>
- License: MIT
