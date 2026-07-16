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
| Gemini CLI | `.agents/skills/cladding-init` + `.gemini/settings.json` |
| Antigravity (`agy`) | `.agents/skills/cladding-init` + `.agents/mcp_config.json` (forward-compat) + machine-wide `~/.gemini/config/plugins/cladding/` — see the Antigravity note below |
| Cursor | `.cursor/skills/cladding-init` + `.cursor/mcp.json` + `.cursor/cli.json` read-only tool allowlist + bootstrap rule |

The only machine-specific path lives in `.cladding/host/serve.cjs`, which is ignored project runtime state. Re-run setup on each developer machine. Host config files use the portable relative launcher path and preserve unrelated entries. With no arguments the launcher starts MCP; with arguments it forwards a normal CLI command to that exact same engine. Generated project guidance therefore uses `node .cladding/host/serve.cjs check --strict` and similar shell calls when the launcher exists, preventing a different global installation from silently validating the project with another build.

With no `--host` option, setup wires only the hosts whose home markers exist on the machine and
reports the rest as `not selected`; `clad setup --host all` forces every channel, `--host <name>`
exactly one.

Codex loads `.codex/config.toml` only for a trusted Git repository. Accept Codex's normal project-trust prompt when opening the repository; this is a Codex security boundary and `clad setup` does not bypass or pre-approve it. One consequence for scripted use: the project config asks Codex to approve write-capable tools, and Cladding annotates its onboarding tools honestly as non-read-only, so non-interactive `codex exec` auto-denies the onboarding prepare/stage/apply calls. Interactive Codex simply shows its approval prompt; headless automation must pass Codex's own approvals-bypass flag.

**Antigravity is the one deliberate exception to project-local activation.** `agy` 1.1.2 reads MCP
config only from machine-wide locations (`~/.gemini/config/mcp_config.json` or
`~/.gemini/config/plugins/<name>/`) — it does not load a project `.agents/mcp_config.json`
(verified live in the 0.9.0 campaign, including a negative control). Setup therefore also writes
`~/.gemini/config/plugins/cladding/{plugin.json,mcp_config.json}` with an engine-absolute launch;
agy spawns MCP servers with each session's working directory, so the single machine-wide wire stays
project-aware. The project file is kept for forward compatibility, and the setup report calls the
exception out. A foreign directory already at that path is preserved unless `--force` is given.

Gemini likewise loads project skills and settings only after its normal folder-trust boundary is satisfied. Interactive use keeps that prompt intact; the explicitly consented doctor smoke uses Gemini's session-only trust override so a fresh verification fixture can exercise the project-local MCP connection without changing persistent trust settings.
That smoke stays in Gemini Plan Mode and loads an ignored project policy permitting only the three
annotated read-only doctor tools; it does not enable YOLO mode.

Cursor's project CLI configuration allowlists only the three read-only doctor tools. It does not
add a server-wide wildcard, and it preserves unrelated project allow/deny entries; write-capable
Cladding tools retain Cursor's normal approval boundary.

On upgrade, setup removes legacy global Cladding wires only when their ownership is provable. Ambiguous or hand-edited files are preserved and reported. If an old Claude user plugin remains, run `claude plugin uninstall claude-code@cladding --scope user --keep-data`.

**Verification level (honesty note, 0.9.0 packed-tarball campaign).** Claude Code `2.1.211` is
live-verified end-to-end from a packed 0.9.0 install: project `.mcp.json` discovery behind the
per-project approval gate, the full natural-language consent flow (stop at preview, paraphrase
rejected, exact phrase applies), the clarify loop, and model-driven feature creation. Codex CLI
`0.144.4` is live-verified for the same consent flow in a trusted repository, including a
fresh-process apply that resolved the staged draft from the durable cache. Antigravity `1.1.2` is
live-verified for the consent flow and clarify loop, but only through the machine-wide wire — a
negative control proved it never reads the project MCP file, which is why setup writes the
machine-wide wire described above. Gemini's project-local MCP connection and tool registration are
structurally verified after folder trust; its model surfaces remain `not-run` because the available
individual-tier login is rejected by Gemini CLI (`IneligibleTierError`). Cursor Agent
`2026.07.09-a3815c0` passed structural verification (server ready, 22 tools enumerated, negative
control) but its model replay is `not-run` for this campaign (account usage limit). (The
machine-readable claim lives in the README's `clad:host-claims` fence, which `HOST_CLAIM_DRIFT`
polices against `docs/dogfood/matrix.md`; its `verified` grade covers the doctor surfaces listed in
that matrix, not every release-specific onboarding campaign.)

## About the MCP server

All 5 hosts wire cladding as an MCP server — only the wire *location* differs. MCP is not
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
Exact matching prevents accidental application, but standard MCP does not prove which user produced
a tool argument. Treat the host as part of the trust boundary; this confirmation is not a sandbox
against a malicious or compromised host.

| Host | Primary request | Optional explicit invocation |
|---|---|---|
| Claude Code | `Apply Cladding to this project` | `/cladding:init` |
| Codex | `Apply Cladding to this project` | Type `$cladding`, then choose `init (cladding)` |
| Gemini CLI | `Apply Cladding to this project` | Select the project-local `cladding-init` skill |
| Antigravity | `Apply Cladding to this project` | Select the project-local `cladding-init` skill |
| Cursor IDE / Agent | `Apply Cladding to this project` | Natural language routes through the connected onboarding tool |

## Upgrading

```bash
npm update -g cladding     # 1. install the new version
cd <your project>           # 2. select one Cladding project
clad update                 # 3. refresh project wiring + derived state
```

Your authored code, feature/spec content, and documentation are preserved. The command may refresh
derived inventory/index data and the Cladding-managed blocks in `AGENTS.md` and `CLAUDE.md`.
Onboarding itself does not create or change `CLAUDE.md`; the update command retains its established
Claude-specific refresh for existing users while preserving their prose. If the
newer version is stricter, it only **points out** drift — it does not rewrite authored project intent.
