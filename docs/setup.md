<!-- Cladding · Tier C · reference · Refreshed by: manual -->

# Setup details — host wiring, MCP, and upgrading

The README covers the setup command and the natural-language request that follows it. This page is
the detail behind them: where each host is wired, how the MCP server works, and how to upgrade.

## Where `clad setup` connects (4 hosts · 5 wire points)

| Host (when detected) | Wired location | Auto-activation |
|---|---|---|
| Claude Code (`~/.claude/`) | `~/.claude/plugins/cladding` | `claude plugin marketplace add` + `install` |
| Codex CLI skills (`~/.agents/`) | `~/.agents/skills/cladding-*` | (auto on Codex restart) |
| Codex CLI MCP server (`~/.codex/`) | `[mcp_servers.cladding]` in `~/.codex/config.toml` | (TOML entry itself) |
| Gemini CLI (`~/.gemini/`) | `~/.gemini/extensions/cladding` | `gemini extensions link` |
| Cursor (`~/.cursor/`) | `mcpServers.cladding` in `~/.cursor/mcp.json` | (JSON entry itself) |

`clad setup` invokes each host's activation command automatically when the `claude` / `gemini`
binaries are on PATH. It is safe to re-run after an upgrade or after installing a new AI tool.

**Verification level (honesty note).** Claude Code is fully verified through real-usage
campaigns (including real-time intervention). Codex · Gemini CLI wire automatically; their behavior isn't verified yet. Cursor wires automatically, but real-usage verification is still pending —
to be updated as it lands. (The machine-readable claim lives in the README's `clad:host-claims`
fence, which `HOST_CLAIM_DRIFT` polices against `docs/dogfood/matrix.md`.)

## About the MCP server

All 4 hosts wire cladding as an MCP server — only the wire *location* differs. MCP is not
something you invoke directly and there is no manual connect step. A host may provide an `/mcp`
diagnostic view, but normal use starts by asking the AI to apply Cladding to the open project.

| Host | Primary request | Optional explicit invocation |
|---|---|---|
| Claude Code | `Apply Cladding to this project` | `/cladding:init` |
| Codex | `Apply Cladding to this project` | Type `$cladding`, then choose `init (cladding)` |
| Gemini CLI | `Apply Cladding to this project` | `/cladding:init` |
| Cursor | `Apply Cladding to this project` | Natural language routes through the connected onboarding tool |

## Upgrading

```bash
npm update -g cladding     # 1. install the new version
cd <your project>          # 2. once per project
clad update                # 3. bring it in line with the new version
```

Your code · `spec.yaml` · docs are left untouched, so it is safe. If the newer version is
stricter and has something to flag, it just **points it out** — it won't block or fix anything.
