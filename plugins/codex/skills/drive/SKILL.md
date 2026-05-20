---
description: Run cladding's autonomous loop — iterate ready features, dispatch the specialist + reviewer personas through the active host adapter, run L1 gates, halt on HUMAN_REQUIRED or transport failure. Use only when the user explicitly asks for autonomous progress; the loop will modify files.
---

# Cladding drive

Run `clad drive` from the project root. The autonomous loop:

1. Pre-flight `adapter.healthCheck()` — fails fast on missing credentials or unreachable host.
2. For each ready feature (status `planned`, `depends_on` satisfied):
   - Specialist dispatch authors the implementation.
   - Apply mutations to the working tree.
   - L1 gates: Type / Lint / Arch.
   - Reviewer dispatch — `HUMAN_REQUIRED` halt if reviewer identity equals specialist (anti-self-cert barrier).
   - UAT requires a human-pass evidence entry; missing → `HUMAN_REQUIRED` halt.
3. Halt class is one of the 13 enumerated reasons (`ALL_FEATURES_DONE`, `MAX_ITERATIONS`, `WALL_CLOCK`, `BUDGET_EXCEEDED`, `BLOCKED_FEATURE`, `RETRY_THRESHOLD`, `GATE_NO_PROGRESS`, `HUMAN_REQUIRED`, `TRANSPORT_AUTH_FAILED`, `TRANSPORT_RATE_LIMITED`, `TRANSPORT_NETWORK`, `LLM_UNAVAILABLE`, `UNCAUGHT_ERROR`).

Budget flags: `--max-iterations`, `--max-wall-clock-ms`, `--max-retries`. `--cwd <path>` targets a project directory other than the current one. `--json` emits the raw Iron Core result; default is the plain Soft Shell summary.

```
clad drive
clad drive --cwd /path/to/project
clad drive --max-iterations 10
clad drive --json
```

**Heads-up**: `drive` modifies the working tree. The host adapter dispatches through MCP sampling when `clad serve` is the active MCP server; otherwise the Mock fallback keeps the loop testable without crossing a real LLM boundary.

After a drive session, run `clad doctor` over the same `--cwd` to confirm the LLM dispatcher behaved — any `sentinel_miss` events surface as a health summary so you can tell whether the loop ran with full LLM refinement or fell back to deterministic per-artifact.
