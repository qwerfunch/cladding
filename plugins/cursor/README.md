# cladding · Cursor IDE plugin

Cursor support so far has been MCP-only — cladding's MCP server (`clad serve`) is wired into `~/.cursor/mcp.json` by `clad setup`. This directory adds the **Layer-C PreToolUse hook** equivalent for Cursor, mirroring the Claude Code wire-up that landed in 0.4.7.

## What's here

- **`hooks/pre-edit.mjs`** — host-agnostic `.cladding/work-registry.json` check. Denies the edit (exit 2 + stderr message) when no work transaction is open; allows silently otherwise.

## Wire-up (manual, until `clad setup` auto-wires)

Cursor v1.7+ reads `~/.cursor/hooks.json` for project-wide hooks. Add (or merge) something like:

```json
{
  "hooks": {
    "beforeShellExecution": [
      {
        "command": "node /absolute/path/to/cladding/plugins/cursor/hooks/pre-edit.mjs",
        "timeout": 5000
      }
    ]
  }
}
```

Replace `/absolute/path/to/cladding` with the result of `npm root -g` + `/cladding` (npm-global install) or your local checkout.

> **Exact event name + JSON contract**: Cursor's hook system (v1.7+) defines 21 hook events; the precise event name that maps to Claude Code's `PreToolUse(Edit|Write)` may be `beforeShellExecution`, `beforeMCPExecution`, or a per-tool event. The script above uses the universal **exit 2 + stderr** pattern that every known host surfaces back to the user, so wiring it under any "pre-something" event will deny edits when no work transaction is open. Verify against your Cursor version's hook docs before relying on this in production.

## Auto-wire (planned, follow-up patch)

`clad setup` will gain a `wireCursorHook` helper that merges this hook into `~/.cursor/hooks.json` alongside the existing `wireCursorMcp` (which already handles `~/.cursor/mcp.json`). Gated on the Cursor hook manifest schema stabilising.

## Why not a full Cursor plugin manifest?

Cursor does not currently ship a plugin marketplace analogous to Claude Code plugins or Codex skills. The integration surface is `~/.cursor/mcp.json` (MCP servers) + `~/.cursor/hooks.json` (hooks) + `.cursorrules` (per-project rules). cladding leverages all three lightly without claiming a marketplace presence.
