# Cladding dogfood — Claude Code (2026-05-20)

Second external-host verification of cladding's multi-host plugin rollout (v0.3.6).
Pairs with `gemini-cli-2026-05-20.md` as the cross-host evidence set.

## Environment

| Field | Value |
|---|---|
| Host | Claude Code `2.1.145` |
| Authentication | Claude Pro / Max subscription (no API key) |
| Cladding version | `v0.3.6` (commit `f783ebc`) plus the v0.3.7 dogfood patch on develop |
| Install path | `--plugin-dir /Users/qwerfunch/Developer/work/cladding` (dev-mode load — marketplace listing pending) |
| `clad` binary | `/opt/homebrew/bin/clad` → cladding dev tree via `npm link` |
| OS | macOS (Darwin 25.3.0) |

## Setup steps

```bash
# 1. cladding bin → PATH (same as for any host)
cd /Users/qwerfunch/Developer/work/cladding && npm link

# 2. Claude Code loads the plugin via --plugin-dir flag at session start.
# No symlink into a global directory is needed for dev-mode load.

# 3. Verify the plugin's MCP server is callable via --print mode
echo "..." | claude --plugin-dir /Users/qwerfunch/Developer/work/cladding \
  --print --allowedTools mcp__cladding__clad_list_features
```

The `--allowedTools mcp__cladding__<tool>` flag is required in headless mode because Claude Code's auto-mode classifier blocks `--dangerously-skip-permissions`. The Claude Code MCP tool naming convention is `mcp__<server>__<tool>` (server `cladding`, tool `clad_list_features` → `mcp__cladding__clad_list_features`).

## Checklist results — every surface ✓

| # | Surface | Method | Result |
|---|---|---|---|
| 1 | Plugin load via `--plugin-dir` | `claude --plugin-dir /path/to/cladding` | ✅ Plugin loaded from `.claude-plugin/plugin.json` + `.mcp.json` |
| 2 | MCP server auto-spawn | `clad serve` invoked by Claude Code's MCP wiring | ✅ Stdio handshake succeeded — tool calls round-tripped |
| 3 | `clad_list_features` MCP tool | `echo "..." \| claude --print --allowedTools mcp__cladding__clad_list_features` | ✅ Returned F-001 / F-002 / F-003 with correct titles |
| 4 | `clad_get_feature(F-049)` MCP tool | `--allowedTools mcp__cladding__clad_get_feature` | ✅ Accurately summarized F-049 ("loads five personas · enforces reviewer barrier · UAT halt · keeps contracts invariant across adapters") |
| 5 | `clad_run_check(strict)` MCP tool | `--allowedTools mcp__cladding__clad_run_check` | ✅ Reported "Drift stage: passed. Severity-error findings: 0." |
| 6 | `clad_get_events` MCP tool | `--allowedTools mcp__cladding__clad_get_events` | ✅ Returned the correct shape (`{"events":[],"note":"no events log yet"}`) when the log was absent |

## Issues found

**Cladding-side issues: 0.**

No cladding code change was required after this verification.

### Host-side observations (not cladding bugs)

- **Auto-mode classifier blocks `--dangerously-skip-permissions`** in non-interactive headless runs. Workaround: `--allowedTools mcp__cladding__<tool>` per cladding tool. This is a Claude Code safety policy, not a cladding bug, but the reproduction recipe documents the workaround so future verifications avoid the pitfall.
- **Prompt argument and `--allowedTools` parse interaction** — passing the prompt positionally after `--allowedTools` caused the tool list to swallow the prompt ("Input must be provided either through stdin or as a prompt argument when using --print"). Workaround: pipe the prompt via stdin (`echo "..." | claude ...`).

## What this proves

- The F-049 AC-091 invariant ("host adapters require no API key") holds in practice for Claude Code — the Pro/Max subscription path was used, no `ANTHROPIC_API_KEY` set on the system for this verification.
- The MCP sampling path wired in v0.2.25 (F-074) is reachable through Claude Code's MCP client without any cladding-side glue beyond `.claude-plugin/plugin.json` + `.mcp.json`.
- The `--plugin-dir` dev-mode load path works against cladding's repo as-is — no install step beyond `npm link` for the `clad` binary and the `--plugin-dir` flag itself.
- Cross-host parity: the same four MCP tools (`clad_list_features`, `clad_get_feature`, `clad_run_check`, `clad_get_events`) round-trip on both Gemini CLI (v0.3.7 report) and Claude Code with the same observable output shape — proves `clad serve` is genuinely host-agnostic.

## What this does NOT prove

- Skills (`/cladding:sync`, `/cladding:check`, ...) invocation through Claude Code's slash-command surface — only the MCP tool path was exercised. Plugin-side skills are present and listed by Claude Code's `/plugin` browser, but a full session-level skill invocation under marketplace install is queued for the post-marketplace verification pass.
- The `clad drive` autonomous loop dispatch through Claude Code's sampling channel — same scope boundary as the Gemini report.
- Marketplace install path — cladding's listing in `anthropics/claude-plugins-official` is still pending review (memory: `marketplace_timing`). Once approved, the same checklist needs to run again on `/plugin install harness-boot@harness-boot` instead of `--plugin-dir`.

## Codex CLI — deferred

OpenAI Codex CLI was not installed on the verifier's machine at this time (`which codex` → not found). The Codex dogfood report is deferred to a follow-up pass once the Codex CLI is set up. The cladding-side artifacts that the Codex pass would exercise (`plugins/codex/.codex-plugin/plugin.json`, `plugins/codex/.mcp.json`, 11 skills) are present and `HARNESS_INTEGRITY` (F-080) validates their schema + version consistency on every `clad check --strict`. So the cladding side is verification-ready; only the host-side execution waits on installation.

## Reproduction recipe

Any reviewer who wants to replay this verification:

```bash
# Inside cladding repo
npm link

# Run each MCP tool individually. Prompt MUST come via stdin because
# --allowedTools is a nargs+ flag that otherwise swallows it.
echo "Use clad_list_features to list the first 3 features" | \
  claude --plugin-dir $(pwd) --print --allowedTools mcp__cladding__clad_list_features

echo "Use clad_get_feature for F-049 and summarize" | \
  claude --plugin-dir $(pwd) --print --allowedTools mcp__cladding__clad_get_feature

echo "Use clad_run_check with strict=true; report pass/fail and error count" | \
  claude --plugin-dir $(pwd) --print --allowedTools mcp__cladding__clad_run_check

echo "Use clad_get_events to fetch the last 5 events; report entry count" | \
  claude --plugin-dir $(pwd) --print --allowedTools mcp__cladding__clad_get_events
```
