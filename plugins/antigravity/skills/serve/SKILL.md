---
description: Boot cladding as an MCP server over stdio. Use only when the user wants to expose cladding's tools, resources, and persona prompts to a separate MCP client. Most users don't run this directly — the plugin's .mcp.json launches it automatically. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding serve

Run `clad serve` from the project root. Boots an MCP server over stdio that exposes:

- **Tools**: `clad_list_features`, `clad_get_feature`, `clad_run_check`, `clad_get_events`.
- **Resources**: `cladding://spec`, `cladding://events`, `cladding://audit`.
- **Prompts**: 5 personas (orchestrator, planner, reviewer, observability, developer).
- **Live audit notifications**: `notifications/resources/updated` fires for `cladding://audit` whenever a new evidence entry lands — a subscribed client can live-tail the audit log without polling.

Registers itself in cladding's sampling context so the host adapters (`generic-mcp`, `claude-code`) route LLM dispatch through `McpSamplingTransport` instead of the Mock fallback.

```
clad serve --cwd /path/to/project
```

**Most users don't run this directly.** Cladding's plugin manifest (`.mcp.json`) launches `clad serve` automatically when the plugin is enabled. Invoke this skill only for debugging the MCP server in isolation.
