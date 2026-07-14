# Antigravity CLI onboarding campaign — 2026-07-14

- Host: Antigravity CLI (`agy`) 1.1.0
- Plugin: `plugins/antigravity` (19 skills, one MCP server)
- Transport: stdio MCP through `clad serve`
- Result: verified

## Live cases

| Case | Preview before writes | Separate exact approval | Result |
|---|---:|---:|---|
| Idea only | pass | pass | initialized; unresolved KYB/KYC choice returned to the user without inventing an answer |
| Planning document | pass | pass | initialized from `plan.md` with no unnecessary follow-up |
| Existing project | pass | pass | observed ES modules, two-space indentation, JSDoc, and the Node test runner before adoption |
| Uninitialized control | n/a | n/a | ordinary file request created only the requested file; no Cladding artifacts or intervention |

AGY runs each printed turn in a separate process. The campaign therefore also verifies the
machine-local, short-lived approval cache used when a host does not retain the opaque preparation
token between turns. The approval phrase remains exact, single-use, and expires after 30 minutes.
