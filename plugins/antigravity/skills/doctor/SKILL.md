---
description: Summarise .cladding/events.log.jsonl — sentinel-miss frequency by phase × cause × fallback plus the top missed sentinels. Use when the user asks whether their LLM dispatcher (MCP sampling host, Anthropic SDK, …) is healthy, when scan / drive results look thinner than expected, or as a one-shot triage before tuning model / max_tokens / temperature. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding doctor

Run `clad doctor` from the project root. The verb is observability — it never mutates the working tree.

- `--cwd <path>` — read events from a project directory other than the current one (default cwd).
- `--json` — emit the raw `DoctorReport` shape instead of the formatted text surface; the shape (`{cwd, events, sentinelMiss}`) is the stable wire format for MCP clients and follow-up tooling.

The text surface prints:

1. One pulse line with total events and total sentinel-miss count (`pass` when zero misses, `note` otherwise).
2. An event-type breakdown line (one `<type>=<count>` token per non-zero `EventType`).
3. When sentinel-miss events exist:
   - `by phase` / `by cause` / `by fallback` aggregates from the v0.3.39 telemetry payload.
   - Top-5 missed sentinels (`CONVENTIONS_MD` / `ARCHITECTURE_YAML` / `SCENARIO_FLOWS` / `CAPABILITIES_YAML` / `WHY` / `WHAT` / `PURPOSE`) sorted by count desc, name asc.
   - Last 3 unique dispatcher error strings (most recent first; errors are truncated to 200 chars at the emit site).
   - A one-line tuning hint.

## Exit codes

- `0` — events.log was either missing (greenfield) or readable. A greenfield workspace prints a friendly note and exits 0; a healthy host with zero misses also exits 0 with a `pass` line.
- `1` — `events.log.jsonl` exists but cannot be parsed as JSONL (corrupt telemetry).

## When to run

- After `clad init --scan` to confirm the scan refinement ran with full LLM coverage (no `sentinel_miss` events).
- After `clad run` to confirm the autonomous loop received refined replies from the configured host.
- Periodically in CI to track miss rate across sampling-policy changes.
- Before reporting "the LLM seems off" to a host (Claude Code / Cursor / Continue) — the breakdown tells you whether the issue is dispatcher transport (`cause: dispatcher_error`) or model output quality (`cause: blank_section`).

```
clad doctor
clad doctor --cwd /path/to/project
clad doctor --json
```

Configured-no-LLM runs (no MCP host, no `ANTHROPIC_API_KEY`, or `--no-llm` flag on `clad init`) do not emit `sentinel_miss` — those are deliberate offline runs, not misses. A doctor pass with zero events on a workspace that never reached the LLM path is therefore expected, not a problem.
