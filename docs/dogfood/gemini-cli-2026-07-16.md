# Gemini CLI project-local setup verification — 2026-07-16

- Host: Gemini CLI `0.42.0`
- Isolation: temporary HOME with no user-global Cladding extension or skill
- Transport: project `.gemini/settings.json` → project `.cladding/host/serve.cjs`
- Skill: project `.agents/skills/cladding-init/SKILL.md`
- Result: project-local discovery and MCP connectivity verified; model surfaces not-run

`clad setup --host gemini` was run from a temporary Git project. It created the
Gemini settings file and shared project skill under that project, while the
isolated HOME remained free of Cladding configuration. Gemini reported
`cladding-init` enabled from `.agents/skills` and reported the `cladding` stdio
server connected through `.cladding/host/serve.cjs`.

The headless probe command uses Gemini Plan Mode plus the ignored project policy
`.cladding/host/gemini-doctor-policy.toml`. That policy matches the `cladding`
server, the three doctor tools, and their `readOnlyHint`; it does not enable
YOLO mode. Gemini accepted the policy arguments before reaching its account
precondition.

The model-backed probes could not run under the available Google login. Gemini
returned `IneligibleTierError` with `UNSUPPORTED_CLIENT` and directed the account
to Antigravity before any Cladding tool call occurred. No API-key environment
variable was available. Those surfaces are therefore recorded as `not-run`, not
as a pass and not as a project-wiring failure.

This supersedes the old global-extension setup recipe for current installation
guidance. The earlier report remains only as historical evidence; current setup
is project-scoped.
