---
description: Invoke the cladding CLI — run a stage, the drift suite, the spec validator, the panel, the intent router, or the token benchmark.
---

# /cladding:clad

Wrapper for the local `clad` binary (see `bin/clad` and `src/cli/clad.ts`). Forwards every argument unchanged. Use this slash command instead of typing `node bin/clad` from a Claude Code session.

## Verbs

| verb | what it does |
|---|---|
| `init` | scaffold a cladding workspace — spec.yaml seed + .cladding/ + .gitignore. `--name <name>` overrides cwd basename. `--force` overwrites existing spec.yaml. Idempotent by default. |
| `work <verb>` | run a single stage or natural-language intent |
| `drive [goal]` | autonomous loop (v0.2 placeholder) |
| `sync` | validate `spec.yaml` against `src/spec/schema.json` |
| `check` | run every Iron Law stage + drift suite |
| `panel` | render the feature × stage Integrity Panel |
| `route <prompt>` | classify a free-form prompt to a verb (deterministic, no LLM) |
| `benchmark <F-NNN>` | naive vs optimized spec token comparison |

## Examples

```
/cladding:clad check
/cladding:clad panel
/cladding:clad route "기능 만들어줘"
/cladding:clad benchmark F-008
```

## Iron-law gate

`clad check` returns the worst exit code across the 13 stages. `2` means *skipped* (no fail). `1` means at least one stage actually failed. `0` means every stage cleared or skipped clean.

## `route` semantics — what `unknown` means

`clad route` is deterministic: regex rules per language, no LLM call (per `ironclad-design/03-ux-routing.md` P-11). High-precision over high-recall — only clear matches resolve to a verb; everything else returns `unknown`.

`unknown` is **not an error**. It signals *"this prompt is not one of cladding's five Iron Core verbs — the host AI tool's natural-language layer should handle it."* Examples that intentionally route to `unknown`:

- Planning intents (`"기획 세워줘"`, `"plan it"`, `"로드맵 그려줘"`) — planning is librarian-territory, not a CLI verb. `drive` is for *executing* an already-defined plan, not *making* one.
- Vague phrases (`"좀 해줘"`, `"어떻게든 마무리"`, `"전부 다 끝내줘"`) — too ambiguous to map without context.

For language coverage and how to add a new language, see `src/router/intent.ts`.

## Output language policy (Soft Shell vs Iron Core)

User-facing output is business language by default: feature titles (`"Login flow"`) instead of `F-NNN`, stage names (`Drift`, `UAT`) instead of `stage_X.Y`, plain sentences instead of internal enum values. Pass `--internal` (`check`, `panel`) or `--json` (`drive`) when you need the Iron Core view — for cross-referencing the audit log, for forensic work, or for piping into another tool. The audit log itself always keeps the internal ids. See `ironclad-design/03-ux-routing.md` §1.2 and `docs/ux-routing-coverage.md` for the applied-status report.

## Anti-self-cert reminder (stage_4 only)

`stage_4.1` and `stage_4.2` consult `.cladding/audit.log.jsonl`. An AC backed only by tool / LLM evidence cannot clear stage_4 — by design (`src/hitl/anti-self-cert.ts`). The fix is for a human to record `kind: pass` evidence with `identity.author: human`.
