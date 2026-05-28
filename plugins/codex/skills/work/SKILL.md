---
description: REMOVED in v0.4.8 — `clad work` external CLI command no longer exists. The work transaction is now an MCP-only surface (`enter_work` / `complete_work` / `abandon_work` via `clad serve`). Host AIs call these MCP tools directly; users do not invoke a CLI verb for work.
---

# Cladding work — REMOVED (v0.4.8)

The `clad work` CLI command was removed in v0.4.8 as part of the 0.5.0 work/drive transaction roadmap. Single-feature work is now an **MCP-only** surface — host AIs (Claude Code, Cursor, Codex, Gemini) reach for the tools below via the cladding MCP server (`clad serve`).

## MCP replacements

- **`enter_work({featureId, intent?})`** — opens a transaction. Transitions the feature `planned → in_progress`, registers the active work, returns the specialists persona prompt + scoped module list. Host AI adopts the persona for the next turn.
- **`complete_work({featureId, evidence?})`** — closes the transaction with the full L1 iron-law gate (drift + type + lint + arch). On pass: `in_progress → done`. On fail: status stays `in_progress`, retry after fixing.
- **`abandon_work({featureId, reason})`** — cancels without changing status (resume later).

See `docs/0.5.0-architecture.md` for the four-layer defense, persona-dispatch option-1 design, and the implicit-close lifecycle.

## Why this changed

The CLI `clad work` was a v0.2.x stub that never had a real implementation. v0.4.x landed the actual transaction logic behind MCP tools so it is host-AI-callable across every host cladding supports — without the host needing to invoke a subprocess and parse output. See the 0.4.3 / 0.4.5 / 0.4.6 / 0.4.7 CHANGELOG entries (or the consolidated 0.5.0 release notes once cut).
