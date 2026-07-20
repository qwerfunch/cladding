# Cursor Agent onboarding campaign — 2026-07-14

- Host: Cursor Agent `2026.07.09-a3815c0`
- Interface: headless CLI (`cursor-agent --print --resume`)
- Transport: global stdio MCP through `~/.cursor/mcp.json`
- Exposed tools: 21
- Result: verified

## Live cases

| Case | Preview before writes | Separate exact approval | Result |
|---|---:|---:|---|
| Idea only | pass | pass | initialized; two unresolved product choices returned to the user without inventing answers |
| Planning document | pass | pass | initialized from `plan.md` with no unnecessary follow-up |
| Existing project | pass | pass | observed ESM, two-space indentation, JSDoc, immutability, and the Node test runner before adoption |
| Uninitialized control | n/a | n/a | ordinary file request created only the requested file; no Cladding artifacts or intervention |

The campaign ran with Cursor's force and MCP auto-approval flags inside isolated temporary
workspaces. Even with host-side tool permission granted, Cladding made no project changes before
the exact approval phrase was supplied in a resumed conversation. The control workspace contained
only `greeting.txt` afterward.
