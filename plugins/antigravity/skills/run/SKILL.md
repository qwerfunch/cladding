---
description: Run cladding's autonomous loop — iterate ready features, dispatch the developer + reviewer personas through the active host adapter, run L1 gates, halt on HUMAN_REQUIRED or transport failure. Use only when the user explicitly asks for autonomous progress; the loop will modify files. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding run (formerly `drive`)

Run `clad run` from the project root. The autonomous loop:

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
clad run
clad run --cwd /path/to/project
clad run --max-iterations 10
clad run --json
```

**Heads-up — `run` needs a real LLM, and is for unattended/headless use only.** The host AI (Claude Code, Cursor, …) drives work *naturally in-session*; `clad run` is the entry point for the **opposite** case — autonomous, no-human-in-the-loop progress (CI/cron/SDK). Two requirements:

- **A real dispatch must be available**: either run inside `clad serve` (MCP sampling) or use SDK mode (`agent.mode = sdk` + an API key). With **neither**, the loop falls back to the **Mock transport** and produces empty module *stubs*, not real implementations — yet still reports a normal halt. Treat a standalone `clad run` with no MCP server and no SDK key as **not doing real work**; verify with `clad doctor` afterward (a deterministic/Mock run is a red flag, not success).
- `run` modifies the working tree.

> Known gap (tracked): standalone `run` on the Mock fallback should hard-fail with `LLM_UNAVAILABLE` rather than silently stubbing. That change reconciles the adapter `healthCheck` parity contract (F-049 AC-089, which currently treats the Mock fallback as "ready") and is a deliberate follow-up, not yet shipped.

After a run session, run `clad doctor` over the same `--cwd` to confirm the LLM dispatcher behaved — any `sentinel_miss` events surface as a health summary so you can tell whether the loop ran with full LLM refinement or fell back to deterministic per-artifact.
