# Claude Code project-scoped onboarding campaign — 2026-07-15

- Host: Claude Code `2.1.207`
- Authentication: OAuth login present
- Result: live model campaign blocked by the host quota

Claude reported that the weekly model limit had been reached and would reset on July 17 at 17:00 Asia/Seoul. This is recorded as `not-run`, not a pass or a Cladding failure.

The free structural checks did pass: project setup produced only `.claude/skills/cladding-init`, `.mcp.json`, and the ignored launcher; a direct stdio initialize + `tools/list` handshake reached that launcher and exposed `clad_stage_init`. The natural-language control and three initialization scenarios must be rerun after quota reset before this release can claim a live Claude onboarding pass.
