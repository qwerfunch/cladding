# Design note — make the Claude Code marketplace plugin self-contained

**Status:** accepted, deferred. Target: 0.5.1 / 0.6.0 (not 0.5.0).
**Why deferred:** 0.5.0 is release-ready; this is an architecture change to how the
marketplace plugin ships its engine, best landed as its own focused release.

## The gap

The Claude Code marketplace plugin ships only `agents/` + `commands/` — **not** the
engine. Its MCP server is declared as:

```json
"mcpServers": { "cladding": { "command": "clad", "args": ["serve"] } }
```

`command: "clad"` resolves against the user's PATH — i.e. it needs the **global npm
binary** (`npm install -g cladding`). So a user who installs *only* via the marketplace
(no npm) gets:

- a non-starting MCP server → none of `clad_create_feature` / `clad_run_check` / … work;
- no terminal `clad`, so `clad check` / `clad done` / `clad update` are unavailable.

Yet `README.md` route (b) presents the marketplace as standalone ("No `clad setup`
needed — the plugin manifest wires everything"). **The claim and the reality disagree** —
the same class of claim-vs-reality gap this branch (no-vacuous-green) exists to close.

## Confirmed feasibility

Claude Code supports `${CLAUDE_PLUGIN_ROOT}` in a plugin's `mcpServers` entry (`command`,
`args`, `env`). It expands to the installed plugin directory at runtime; bundled files are
cloned on install and re-pulled by `claude plugin update`. So a fully self-contained
plugin — bundled engine, **no global npm install** — is supported.

- https://code.claude.com/docs/en/plugins.md (Plugin-provided MCP servers)
- https://code.claude.com/docs/en/mcp-configuration.md (Plugin-provided MCP servers)

## The design — bundle the engine, point MCP at it

```json
// from (needs global npm `clad`):
"mcpServers": { "cladding": { "command": "clad", "args": ["serve"] } }

// to (self-contained):
"mcpServers": { "cladding": {
  "command": "node",
  "args": ["${CLAUDE_PLUGIN_ROOT}/dist/clad.js", "serve"]
} }
```

`scripts/build-plugin.mjs` copies the built `dist/clad.js` into
`plugins/claude-code/dist/clad.js` so it ships with the plugin.

### Result — two clean lanes, each self-contained

| | Marketplace user | npm / terminal user |
|---|---|---|
| Install | plugin 1-click (no npm) | `npm i -g cladding` + `clad setup` |
| Engine | bundled in the plugin | global `clad` |
| **Update** | **`claude plugin update`** (engine + prompts together) | `npm update -g cladding` + `clad update` |
| Operate | the AI, via MCP tools | terminal `clad`, or the AI |

This resolves the update confusion: a marketplace user never runs `clad update` or npm —
`claude plugin update` refreshes the bundled engine too. The terminal `clad update` is
purely the npm-lane reconciliation. **Bonus:** the MCP engine version now always equals the
plugin version, eliminating the "global `clad` 0.4.0 but plugin 0.5.0" drift class.

## The piece marketplace users still need

They have no terminal `clad`, so the per-project reconciliation that `clad update` does
(refresh the `inventory:` snapshot + the managed `CLAUDE.md` / `AGENTS.md` section) needs an
MCP path. Drift reporting already exists as `clad_run_check`. Add a **`clad_update` MCP
tool** that wraps `performUpdate` (`src/cli/update.ts`) so the AI can run the reconciliation
after `claude plugin update`. (Re-wiring is N/A for marketplace — the plugin handles it.)

## Implementation checklist

- [ ] `scripts/build-plugin.mjs` — copy `dist/clad.js` → `plugins/claude-code/dist/` (Phase that runs after the esbuild bundle exists).
- [ ] `plugins/claude-code/.claude-plugin/plugin.json` — `mcpServers.cladding` → `node ${CLAUDE_PLUGIN_ROOT}/dist/clad.js serve`.
- [ ] `src/serve/server.ts` — register a `clad_update` MCP tool over `performUpdate` (project-reconciliation; report-only drift, never blocks).
- [ ] `README.md` / `.ko.md` / `.html` / `.ko.html` — marketplace = standalone (no npm); update = `claude plugin update`. Keep the npm lane separate.
- [ ] `HARNESS_INTEGRITY` — add a check that the bundled `plugins/claude-code/dist/clad.js` is present and that its embedded `.version()` matches the plugin manifest version (so a stale bundle can't ship).
- [ ] `.gitignore` / `package.json` `files` — decide whether the bundled plugin `dist/` is committed or build-only (prefer build-only + ship via the marketplace tarball; keep the repo clean).

## Open questions / tradeoffs

- **Plugin size** grows by the bundle (`dist/clad.js`, ~hundreds of KB). Acceptable for a plugin.
- **npm users who also load the plugin** will run the *bundled* MCP engine (via `${CLAUDE_PLUGIN_ROOT}`), not their global `clad`. That is fine — and arguably better (MCP engine always matches plugin version). Their terminal `clad` stays the global one.
- **Codex / Gemini** hosts wire the MCP server through their own configs (`~/.codex/config.toml`, the Gemini extension). Apply the same bundled-path treatment there, or keep them npm-based — decide per host.
- **`clad setup`** stays the npm-lane wirer; it is unaffected.
