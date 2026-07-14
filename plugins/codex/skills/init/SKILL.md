---
description: Scaffold a Cladding workspace from a new idea, a planning document, or an existing project. Use the MCP prepare/apply flow so the current host model drafts domain-aware artifacts without requiring MCP sampling or a shell command.
---

# Cladding init

Use this workflow only when the user explicitly asks to initialize, adopt, or refresh Cladding. Opening a repository alone is not consent to initialize it.

## Required host workflow

1. If a greenfield request has no project intent, ask for one short description.
2. Call `clad_prepare_init` with exactly one starting mode:
   - `idea` with the user's description.
   - `document` with a project-relative planning-document path.
   - `existing` for an existing codebase; include an optional adoption goal.
3. Read the returned prompt and observations. Draft the structured object required by `clad_init` using the current host model.
4. Show `plannedChanges`, `confirmationQuestion`, and its one-time `approvalChallenge` to the user, then stop and wait for a separate reply. The original initialization request is not confirmation.
5. Only when the user's separate reply exactly matches `approvalChallenge`, call `clad_init` with the draft and that reply verbatim as `confirmation`. Include the one-time token when the host retained it; process-per-turn hosts may omit it and Cladding resolves the exact challenge from its short-lived machine-local cache. Questions, paraphrases, and generic acknowledgements are not approval.
6. If `nextQuestion` is present, show it verbatim and end the assistant turn immediately. Never answer it, infer an answer, or call either clarify tool during the initialization-approval turn. Continue with the Cladding clarify workflow only after a new user message supplies the answer. If no question remains, report that ordinary development can begin.

Do not run `clad init` in a shell from an AI-host onboarding session. Do not use MCP sampling. If the MCP tools are absent, tell the user to run `clad setup`, restart the AI host in the project directory, and stop without writing project files.

`clad_prepare_init` is read-only. Never call prepare and apply in the same assistant turn. Only `clad_init` writes artifacts, after explicit user confirmation plus schema and freshness validation. A stale, malformed, or replayed apply request must be prepared again.

The raw CLI remains available for terminal, CI, offline, and explicitly configured SDK automation; it is not the primary host onboarding path.
