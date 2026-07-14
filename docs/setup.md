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
| Antigravity (`agy`) | `~/.gemini/config/plugins/cladding` | (auto on AGY restart) |
| Cursor (`~/.cursor/`) | `mcpServers.cladding` in `~/.cursor/mcp.json` | (JSON entry itself) |

`clad setup` invokes Claude Code's activation command when `claude` is on PATH. Antigravity
auto-discovers its wired plugin directory after restart. It is safe to re-run after an upgrade or
after installing a new AI tool.

**Verification level (honesty note).** Claude Code is fully verified through real-usage
campaigns (including real-time intervention). Codex onboarding is live-verified for idea,
planning-document, existing-project, and uninitialized control cases. Antigravity 1.1.0 is also
live-verified for all three onboarding cases plus the uninitialized control case. Cursor Agent
`2026.07.09-a3815c0` is live-verified for the same four cases through its headless CLI and global
MCP configuration. (The machine-readable claim lives in the README's `clad:host-claims`
fence, which `HOST_CLAIM_DRIFT` polices against `docs/dogfood/matrix.md`.)

## About the MCP server

All 4 hosts wire cladding as an MCP server — only the wire *location* differs. MCP is not
something you invoke directly and there is no manual connect step. A host may provide an `/mcp`
diagnostic view, but normal use starts by asking the AI to apply Cladding to the open project.

Every host follows the same portable onboarding protocol under the surface: Cladding first returns
a read-only, bounded project briefing; the host's own model drafts structured onboarding data; then
Cladding validates and writes it. Follow-up answers use the same prepare/apply split. This requires
only standard MCP tool calls—not server-side sampling—and prevents incomplete, stale, or replayed
drafts from partially changing the project.

Initialization never writes immediately from the first natural-language request. The host previews
the planned file operations and shows a one-time approval phrase; only a separate user reply that
exactly repeats that phrase authorizes the write step. Questions, paraphrases, merely opening a
project, asking about Cladding, or running `clad setup` are not consent.

| Host | Primary request | Optional explicit invocation |
|---|---|---|
| Claude Code | `Apply Cladding to this project` | `/cladding:init` |
| Codex | `Apply Cladding to this project` | Type `$cladding`, then choose `init (cladding)` |
| Antigravity | `Apply Cladding to this project` | `/cladding:init` from the installed plugin |
| Cursor IDE / Agent | `Apply Cladding to this project` | Natural language routes through the connected onboarding tool |

## Upgrading

```bash
npm update -g cladding     # 1. install the new version
clad setup                  # 2. refresh this machine's host wiring
cd <your project>           # 3. once per project
clad update                 # 4. bring it in line with the new version
```

Your authored code, feature/spec content, and documentation are preserved. The command may refresh
derived inventory/index data and the Cladding-managed block in `AGENTS.md` or `CLAUDE.md`. If the
newer version is stricter, it only **points out** drift — it does not rewrite authored project intent.
