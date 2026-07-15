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
