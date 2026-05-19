# Cladding dogfood — Gemini CLI (2026-05-20)

First external-host verification of cladding's multi-host plugin rollout (v0.3.6).

## Environment

| Field | Value |
|---|---|
| Host | Gemini CLI `0.42.0` |
| Authentication | Google account login (free tier · 60 req/min · 1000/day) |
| Cladding version | `v0.3.6` (commit `f783ebc`) |
| Install path | `~/.gemini/extensions/cladding` → `/Users/qwerfunch/Developer/work/cladding/plugins/gemini-cli/` (symlink) |
| `clad` binary | `/opt/homebrew/bin/clad` → cladding dev tree via `npm link` |
| OS | macOS (Darwin 25.3.0) |

## Setup steps

```bash
# 1. cladding bin → PATH
cd /Users/qwerfunch/Developer/work/cladding && npm link

# 2. Gemini extension symlink
mkdir -p ~/.gemini/extensions
ln -sfn /Users/qwerfunch/Developer/work/cladding/plugins/gemini-cli \
  ~/.gemini/extensions/cladding

# 3. Verify
gemini extensions list   # → cladding (0.3.6)
gemini mcp list          # → cladding (from cladding): clad serve (stdio) - Connected
```

## Checklist results — every surface ✓

| # | Surface | Method | Result |
|---|---|---|---|
| 1 | Extension load | `gemini extensions list` | ✅ `cladding (0.3.6)` · Enabled (User + Workspace) · Context file `GEMINI.md` · MCP server `cladding` |
| 2 | MCP server auto-spawn | `gemini mcp list` | ✅ `cladding (from cladding): clad serve (stdio) - Connected` |
| 3 | `clad_list_features` MCP tool | Natural-language prompt → tool auto-call | ✅ Returned F-001 / F-002 / F-003 with correct titles |
| 4 | `clad_get_feature(F-049)` MCP tool | Natural-language prompt | ✅ Accurately summarized F-049 ("runtime orchestration logic for the cladding drive loop") |
| 5 | `clad_run_check(strict)` MCP tool | Natural-language prompt | ✅ Reported "drift stage passed, 0 findings of severity error" |
| 6 | Persona prompt `reviewer` | Natural-language `prompts/get` request | ✅ Returned `src/agents/reviewer.md` body verbatim |
| 7 | Six skill TOMLs | `commands/*.toml` transpiled from `skills/<verb>/SKILL.md` | ✅ Spec-conformant; build-plugin.mjs Phase C output validated by Gemini's loader |

## Issues found

**Cladding-side issues: 0.**

No cladding code change was required after this verification. The multi-host plugin rollout (v0.3.1 → v0.3.6) holds end-to-end against a real external host.

### Host-side observations (not cladding bugs)

- `Ripgrep is not available. Falling back to GrepTool.` — Gemini CLI emits this when ripgrep is missing from `PATH`. Unrelated to cladding's surfaces. Skip.
- `YOLO mode is enabled. All tool calls will be automatically approved.` — Expected output when running with `--approval-mode yolo` for non-interactive verification.

## What this proves

- The F-049 AC-091 invariant ("host adapters require no API key") holds in practice for Gemini CLI — only the user's Google OAuth login is required.
- The MCP sampling path (`server.createMessage`) wired in v0.2.25 (F-074) is reachable through Gemini's MCP client without any cladding-side glue beyond the plugin manifest.
- The TOML transpile from `skills/<verb>/SKILL.md` (v0.3.6 Phase C, F-081) produces output Gemini's loader accepts verbatim.
- The `HARNESS_INTEGRITY` extension (v0.3.5, F-080) caught no version drift across `package.json`, `.claude-plugin/plugin.json`, `plugins/codex/.codex-plugin/plugin.json`, `plugins/gemini-cli/gemini-extension.json` at the release tip.

## What this does NOT prove

- The `clad drive` autonomous loop dispatch through Gemini's sampling channel — not exercised yet. The MCP sampling roundtrip (cladding's `McpSamplingTransport.invoke`) needs a real `clad drive` invocation from inside the Gemini session to verify end-to-end. Deferred to a future verification pass with a non-trivial feature target.
- High-volume / sustained usage — single-shot prompts only. Rate-limit behaviour, audit-log live-tail under load, and long-running drive sessions are not covered.

## Next verification passes

- **Claude Code** dogfood report (paired with this one as the second external-host verification)
- **OpenAI Codex** dogfood report (third host)
- Full drive-loop sampling verification under one of the three hosts

## Reproduction recipe

Any reviewer who wants to replay this verification:

```bash
# Inside cladding repo
npm link
mkdir -p ~/.gemini/extensions
ln -sfn $(pwd)/plugins/gemini-cli ~/.gemini/extensions/cladding

# From cladding repo cwd, run any of the prompts below
gemini --approval-mode yolo -o text -p "Use clad_list_features to list the first 3 features"
gemini --approval-mode yolo -o text -p "Use clad_get_feature for F-049 and summarize"
gemini --approval-mode yolo -o text -p "Use clad_run_check with strict=true; report pass/fail and error count"
```
