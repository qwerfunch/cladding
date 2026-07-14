---
description: Classify a natural-language prompt to one of cladding's verbs. Use when the user describes work in their own words and you want to see which built-in verb cladding's intent classifier would pick — primarily a debugging tool for the orchestrator persona and for verifying the router's coverage after adding new verbs. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding route

Run `clad route <prompt>` from anywhere — the verb is read-only and does not require a workspace. It calls `classifyIntent(prompt)` from `src/router/intent.js` and emits the resolved verb name as a Pulse note. Exit code is `0` on a confident match and `1` when the intent resolves to `unknown`.

```
clad route "scan my codebase and write the conventions doc"
clad route "is the LLM host healthy?"
clad route "I'm stuck, what's next?"
```

The verb is the smallest surface that exercises the router in isolation. Production callers typically reach the router indirectly through the orchestrator persona (`src/agents/orchestrator.md`) or through `clad_route` over MCP.

## When to use

- Debugging why a natural-language prompt routed (or failed to route) to the verb you expected.
- Confirming a new verb's intent patterns are reachable after adding them to `src/router/intent.js`.
- Smoke-testing the router during local development before publishing a plugin update.

The classifier is intentionally conservative — when no rule matches strongly enough, the result is `unknown` and the verb exits `1` so callers can fall back to an explicit verb lookup instead of guessing.

## Out of scope

- This verb is **not** the entry point for "do the work" — for that the user picks a concrete verb (`init`, `sync`, `check`, `drive`, …) directly, or the orchestrator persona does the routing inside a Claude Code session.
- Free-form prompts that span multiple verbs (`"sync then check then drive"`) collapse to whichever single verb best matches; the router does not split intent.
