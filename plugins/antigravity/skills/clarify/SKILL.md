---
description: Advance Cladding onboarding after the user answers a pending product question. Use the MCP prepare/apply flow, preserve the answer verbatim, and never invent answers. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding clarify

Use this workflow only for an answer contained in a new user message after Cladding displayed the pending question. Never infer, synthesize, or reuse an answer from an initialization turn. If no new user answer exists, stop without calling either clarify tool.

Use this workflow only after Cladding initialization returned a pending question and the user has answered it.

1. Call `clad_prepare_clarify` with the user's answer verbatim.
2. Read the returned prompt, current state, and artifacts. Draft the structured refinement required by `clad_clarify` using the current host model.
3. Call `clad_clarify` with the same answer, the one-time token, and the draft.
4. Ask `nextQuestion` verbatim when one remains.
5. If the result is `needs_review`, show the proposal diffs for every `pendingReview` target and wait for explicit user approval. Only then call `clad_resolve_onboarding_review` with the approved targets. Never describe onboarding as complete while review remains.
6. Report completion only when the returned status is `done`.

Do not run `clad clarify` in a shell from an AI host. Do not use MCP sampling. Never answer a product question on the user's behalf. A stale, malformed, replayed, or answer-mismatched apply request is a no-op and must be prepared again.
