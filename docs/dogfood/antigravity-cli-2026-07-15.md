# Antigravity CLI project-scoped onboarding campaign — 2026-07-15

- Host: Antigravity CLI `1.1.2`
- Transport: `.agents/mcp_config.json` → project `.cladding/host/serve.cjs`
- Result: verified

The legacy 0.8.3 global plugin was backed up and temporarily disabled so it could not make the project wiring pass vacuously. A shell trap restored the plugin and its configuration after the campaign; the before/after configuration diff was empty.

| Case | Result |
|---|---|
| No setup control | only the requested `greeting.txt` was created |
| Setup-only control | ordinary request completed without initialization or Cladding commentary |
| Idea | staged draft applied after a separate exact phrase; two material product questions returned |
| Complete `plan.md` | initialized with the document intent and no follow-up questions |
| Existing code | existing-adoption initialized while preserving source and tests |

All three initialization cases passed `clad sync`, left no staged cache after apply, and wrote no authored onboarding artifact before approval.

## Post-initialization ordinary development

- Isolation: Antigravity kept its authenticated HOME, but the imported user-global Cladding plugin was disabled and all 25 user-global `cladding-*` skill links were moved to a temporary backup for the live run. The active count was independently observed as zero; the trap restored all 25 links and re-enabled the plugin afterward.
- Live task: the host added the **Note favorites** feature using only the initialized project's `AGENTS.md`, MCP configuration, init skill, and runtime launcher. The main conversation was `480c524f-6b7e-40e3-a8c5-342409f63648`, and the process exited normally.
- Independent contexts: conversation `50cdbfb0-39e2-4e05-bd89-a56a9c071ab9` authored the tests, and conversation `e65fbd5d-ee3a-4ac8-9070-bd5c4c571cb5` performed the final review. The reviewer approved the result.
- Design and completion: the feature was classified additive, linked to the note-favorites capability and the find-and-manage-note journey, and marked done through the project-local completion command.
- Test collection: `npm test` used the explicit paths `dist/tests/noteArchive.test.js` and `dist/tests/noteFavorites.test.js`; 12/12 tests passed. The same paths passed 12/12 under an independently selected Node 20 runtime.
- Clean gate: the host created implementation, attestation, and completion commits (`3d19430`, `d90f31d`, `23bd356`). An independent strict check passed every configured stage on a clean tree, and `git diff --check` reported no whitespace errors.
