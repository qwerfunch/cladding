<!-- Cladding · Tier C · reference · Refreshed by: manual -->

# Setup details — host wiring, MCP, and upgrading

The README covers the setup command and the natural-language request that follows it. This page is
the detail behind them: where each host is wired, how the MCP server works, and how to upgrade.

## Project activation boundary

`npm install -g cladding` installs only the CLI. Run `clad setup` **inside each project that should use Cladding**. Nothing is installed into a host's global skill or MCP catalog.

| Host | Project-scoped location |
|---|---|
| Claude Code | `.claude/skills/cladding-init` + `.mcp.json` |
| Codex CLI | `.agents/skills/cladding-init` + `.codex/config.toml` |
| Antigravity (`agy`) | `.agents/skills/cladding-init` + `.agents/mcp_config.json` |
| Cursor | `.cursor/skills/cladding-init` + `.cursor/mcp.json` + bootstrap rule |

The only machine-specific path lives in `.cladding/host/serve.cjs`, which is ignored project runtime state. Re-run setup on each developer machine. Host config files use the portable relative launcher path and preserve unrelated entries. With no arguments the launcher starts MCP; with arguments it forwards a normal CLI command to that exact same engine. Generated project guidance therefore uses `node .cladding/host/serve.cjs check --strict` and similar shell calls when the launcher exists, preventing a different global installation from silently validating the project with another build.

Codex loads `.codex/config.toml` only for a trusted Git repository. Accept Codex's normal project-trust prompt when opening the repository; this is a Codex security boundary and `clad setup` does not bypass or pre-approve it.

On upgrade, setup removes legacy global Cladding wires only when their ownership is provable. Ambiguous or hand-edited files are preserved and reported. If an old Claude user plugin remains, run `claude plugin uninstall claude-code@cladding --scope user --keep-data`.

**Verification level (honesty note).** Claude Code's MCP/runtime surfaces and real-time
intervention are verified through earlier real-usage campaigns; the natural-language onboarding
flow introduced in this release could not be re-run because the logged-in host reported its weekly
quota exhausted; project MCP handshake and tool discovery passed, but onboarding remains pending.
Codex CLI `0.144.3` is live-verified for idea, planning-document, existing-project, uninitialized
controls, and all three doctor surfaces. Antigravity `1.1.2` is live-verified for all three
onboarding cases plus both controls after disabling the legacy global plugin. Cursor Agent
`2026.07.09-a3815c0` is live-verified for the same five cases through project-local MCP wiring.
(The machine-readable
claim lives in the README's `clad:host-claims` fence, which `HOST_CLAIM_DRIFT` polices against
`docs/dogfood/matrix.md`; its `verified` grade covers the doctor surfaces listed in that matrix,
not every release-specific onboarding campaign.)

## About the MCP server

All 4 hosts wire cladding as an MCP server — only the wire *location* differs. MCP is not
something you invoke directly and there is no manual connect step. A host may provide an `/mcp`
diagnostic view, but normal use starts by asking the AI to apply Cladding to the open project.

Every host follows the same portable onboarding protocol under the surface: Cladding first returns
a read-only, bounded project briefing; the host's own model drafts structured onboarding data; then
Cladding validates and stages that draft before showing the approval phrase. Staging writes only an
opaque, short-lived cache under the ignored `.cladding/host/` runtime boundary. A later host process
can therefore apply the exact reviewed draft without reconstructing it from the approval code.
Follow-up answers use the same prepare/apply safety boundary. This requires only standard MCP tool
calls—not server-side sampling—and prevents incomplete, stale, or replayed drafts from partially
changing the project.

Initialization never writes immediately from the first natural-language request. The host previews
the planned file operations and shows a one-time approval phrase; only a separate user reply that
exactly repeats that phrase authorizes the write step. Questions, paraphrases, merely opening a
project, asking about Cladding, or running `clad setup` are not consent.

| Host | Primary request | Optional explicit invocation |
|---|---|---|
| Claude Code | `Apply Cladding to this project` | `/cladding:init` |
| Codex | `Apply Cladding to this project` | Type `$cladding`, then choose `init (cladding)` |
| Antigravity | `Apply Cladding to this project` | Select the project-local `cladding-init` skill |
| Cursor IDE / Agent | `Apply Cladding to this project` | Natural language routes through the connected onboarding tool |

## Upgrading

```bash
npm update -g cladding     # 1. install the new version
cd <your project>           # 2. select one Cladding project
clad update                 # 3. refresh project wiring + derived state
```

Your authored code, feature/spec content, and documentation are preserved. The command may refresh
derived inventory/index data and the Cladding-managed block in `AGENTS.md`. Existing `CLAUDE.md`
files are preserved and Cladding does not create a new one. If the
newer version is stricter, it only **points out** drift — it does not rewrite authored project intent.
