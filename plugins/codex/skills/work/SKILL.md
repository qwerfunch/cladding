---
description: Stage entry-point — run a single Iron Law stage by name or a free-form intent. The verb is reserved-but-unimplemented; it declines honestly with exitCode 2 (never reports success for work it did not do). Full intent handling lands in a later cycle. Use when documenting the intended surface, not for production work.
---

# Cladding work

Run `clad work [verb]` from the project root. The handler is reserved-but-unimplemented and **declines honestly** — it never reports success for work it did not do:

- No argument → prints `· work  specify a stage or natural-language intent` and exits `2`.
- Any argument → prints `↓ work <arg>  not implemented — …` and exits `2` (skipped / not-applicable). No stage runner is dispatched, no spec is loaded, no working-tree mutation happens.

```
clad work             # exit 2, asks for an argument
clad work stage_1.1   # exit 2, declines (not implemented)
clad work "scan the codebase and surface architecture drift"  # exit 2, declines
```

## Why the stub stays

The verb is reserved for the future intent-routing entry point that combines `clad route <prompt>` (intent classification) with the per-stage runner dispatch (currently called directly via `clad check`, `clad drive`, …). Shipping the verb as a stub now keeps the CLI registry stable so:

- Documentation (this file, `commands/clad.md`, plugin manifests) references the verb without breakage.
- Plugin distributions (`plugins/codex/skills/work.md`, `plugins/gemini-cli/commands/work.md`) carry the placeholder.
- A later cycle can swap in the real handler without renaming the verb.

## For production work today

Use the concrete verbs instead:

- A specific stage → `clad check --internal` then read the failing stage code, or invoke the stage runner directly (e.g. `npm run stage:drift`).
- A natural-language intent → `clad route <prompt>` to see which verb the router resolves to, then run that verb directly.
- An autonomous loop over the spec → the **host-delegated path** (run `clad serve` and let your AI host loop the per-feature cadence) — this is the supported, exercised route. (`clad drive` is an experimental headless loop that needs a real LLM transport and is not auto-invoked.)

The orchestrator persona (`src/agents/orchestrator.md`) does intent routing inside a Claude Code session; `clad work` is reserved for the CLI surface of the same routing once the implementation lands.
