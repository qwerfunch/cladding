---
description: Advance Cladding onboarding after the user answers a pending product question. Use the MCP prepare/apply flow, preserve the answer verbatim, and never invent answers.
---

# Cladding clarify

Use this workflow only after Cladding initialization returned a pending question and the user has answered it.

1. Call `clad_prepare_clarify` with the user's answer verbatim.
2. Read the returned prompt, current state, and artifacts. Draft the structured refinement required by `clad_clarify` using the current host model.
3. Call `clad_clarify` with the same answer, the one-time token, and the draft.
4. Ask `nextQuestion` verbatim when one remains; otherwise report that onboarding is complete.

Do not run `clad clarify` in a shell from an AI host. Do not use MCP sampling. Never answer a product question on the user's behalf. A stale, malformed, replayed, or answer-mismatched apply request is a no-op and must be prepared again.
