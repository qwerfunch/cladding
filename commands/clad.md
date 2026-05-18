---
description: Invoke the cladding CLI — run a stage, the drift suite, the spec validator, the minimap, the intent router, or the token benchmark.
---

# /cladding:clad

Wrapper for the local `clad` binary (see `bin/clad` and `cli/clad.ts`). Forwards every argument unchanged. Use this slash command instead of typing `node bin/clad` from a Claude Code session.

## Verbs

| verb | what it does |
|---|---|
| `init` | scaffold a cladding workspace (v0.2 placeholder) |
| `work <verb>` | run a single stage or natural-language intent |
| `drive [goal]` | autonomous loop (v0.2 placeholder) |
| `sync` | validate `spec.yaml` against `spec/schema.json` |
| `check` | run every Iron Law stage + drift suite |
| `minimap` | render the feature × stage Territory Minimap |
| `route <prompt>` | classify a free-form prompt to a verb |
| `benchmark <F-NNN>` | naive vs optimized spec token comparison |

## Examples

```
/cladding:clad check
/cladding:clad minimap
/cladding:clad route "기능 만들어줘"
/cladding:clad benchmark F-008
```

## Iron-law gate

`clad check` returns the worst exit code across the 13 stages. `2` means *skipped* (no fail). `1` means at least one stage actually failed. `0` means every stage cleared or skipped clean.

## Anti-self-cert reminder (stage_4 only)

`stage_4.1` and `stage_4.2` consult `.cladding/audit.log.jsonl`. An AC backed only by tool / LLM evidence cannot clear stage_4 — by design (`hitl/anti-self-cert.ts`). The fix is for a human to record `kind: pass` evidence with `identity.author: human`.
