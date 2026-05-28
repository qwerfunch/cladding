---
description: REMOVED in v0.4.8 — `clad drive` external CLI command no longer exists. The drive (scenario-unit) transaction is now an MCP-only surface (`execute_drive` / `complete_drive` via `clad serve`). Host AIs call these MCP tools directly; users do not invoke a CLI verb for drive.
---

# Cladding drive — REMOVED (v0.4.8)

The `clad drive` CLI command was removed in v0.4.8 as part of the 0.5.0 work/drive transaction roadmap. The autonomous-loop entry point is now an **MCP-only** surface — host AIs reach for the tools below via the cladding MCP server (`clad serve`).

## MCP replacements

- **`execute_drive({scenarioId | intent})`** — opens a scenario-unit transaction. Loads the scenario, drops `done`/`archived` features, topologically sorts the rest by `depends_on`, auto-enters the first ready feature via `enter_work`, returns the ordered plan + first work entry.
- **`complete_drive({scenarioId})`** — seals the scenario. Partitions features into `passed` / `failed` / `pending`, emits `drive_completed` event.
- After `enter_work` is auto-called, the host AI iterates `complete_work` → `enter_work` (next feature) → `complete_work` for the remaining plan, then `complete_drive` at the end.

The runtime previously behind `clad drive` (`src/drive/loop.ts:runDriveLoop`) is preserved for unit-test coverage but is no longer reachable through any external surface — the autonomous loop now flows entirely through the MCP transaction tools.

## Why this changed

The previous `clad drive` was a subprocess-launched autonomous loop. v0.4.x landed the actual transaction logic behind MCP tools so host AIs can drive multi-feature scenarios without spawning a subprocess and parsing its output. The MCP transaction model is host-agnostic (works the same on Claude Code, Cursor, Codex, Gemini) and integrates with the four-layer defense (Layer-A trigger guidance, Layer-B MCP tool descriptions, Layer-C PreToolUse hook, Layer-D auditor) — see `docs/0.5.0-architecture.md`.

## For "I just want to run drive from my terminal"

This is no longer supported. The work/drive transaction model assumes a host AI driving the cladding MCP server. If you need to run the loop without a host AI for CI / benchmarking, invoke the runtime directly:

```bash
# Old (removed in 0.4.8):
# clad drive

# Replacement: invoke via your host AI's MCP client, asking for
# execute_drive({scenarioId: "S-…"}) — see docs/0.5.0-architecture.md
```

A `clad drive` CLI shim may return in 0.5.x if there is demand for a non-host-AI execution path; until then the MCP surface is canonical.
