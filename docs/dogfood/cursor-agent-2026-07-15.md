# Cursor Agent project-scoped onboarding campaign — 2026-07-15

- Host: Cursor Agent `2026.07.09-a3815c0`
- Interface: headless `cursor-agent --print --trust --approve-mcps --force`
- Transport: `.cursor/mcp.json` → project `.cladding/host/serve.cjs`
- Result: verified

| Case | Result |
|---|---|
| No setup control | only the requested `greeting.txt` was created |
| Setup-only control | ordinary request completed without initialization or Cladding commentary |
| Idea | staged draft applied after a separate exact phrase; three material product questions returned |
| Complete `plan.md` | initialized with the document intent and no follow-up questions |
| Existing code | existing-adoption initialized while preserving source and tests |

All three initialization cases passed `clad sync`, left no staged cache after apply, and wrote no authored onboarding artifact before approval.

## Post-initialization ordinary development

- Isolation: a fresh HOME contained no user-global Cladding skills; Cursor authentication was passed to the process through its memory-only credential store. The project-local MCP launcher and generated `AGENTS.md` were the only Cladding guidance.
- Live task: the host added the **Note reminders** feature, kept the capability, journey, project context, and feature shard aligned, and exited normally (session `e23c4638-ec07-40c6-a325-913bc5162fbd`).
- Independent contexts: Cursor created one blind test-author transcript and one read-only reviewer transcript. The reviewer approved all six acceptance behaviors and the design linkage.
- Test collection: `npm test` used the explicit paths `dist/tests/noteArchive.test.js` and `dist/tests/noteReminders.test.js`; 13/13 tests passed. The same two paths passed 13/13 under an independently selected Node 20 runtime.
- Completion: the feature completion command marked **Note reminders** done. The host left its changes uncommitted, so an immediate project-wide strict check reported only the expected dirty-tree finding; after an evidence-only commit (`a735825`), all configured stages passed and the tree was clean.
- Diff hygiene: `git diff --check` passed, and the final package script contained no shell-expanded glob.

## Project permission follow-up

The setup path now writes `.cursor/cli.json` with exact allow entries for only
`clad_list_features`, `clad_get_feature`, and `clad_run_check`. Cursor's own
configuration parser accepted the file, `cursor-agent mcp list` reported
`cladding: ready`, and `cursor-agent mcp list-tools cladding` returned all 22
tools. The three exact entries let the doctor remain in read-only ask mode;
write-capable Cladding tools are not allowlisted. A model-backed replay of that
permission correction remains pending because the account usage limit was
reached first.
