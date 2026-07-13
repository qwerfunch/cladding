# A/B — spec-driven AGENTS.md (#199, F-a4085adf): cross-host convention conformance

Pilot: 1 discriminating task × 3 models (opus/sonnet/haiku as proxy hosts) × 2 arms. Single-variable control: arm A = the emitted AGENTS.md WITHOUT the ai_hints "conventions" block; arm B = identical AGENTS.md WITH it (forbidden_patterns [eval(, innerHTML, Function(, dangerouslySetInnerHTML], preferred_patterns [textContent over innerHTML; shunting-yard over eval], test_framework vitest, primary_branch trunk). Task tempts both sinks: renderSnippet(container, html) + evalExpr(expr). No forbidden hint in the task — only arm B's AGENTS.md carries it. Scored by the shipped AI_HINTS_FORBIDDEN_PATTERN detector (non-comment lines in src/) + technique inspection.

## Results

| host | arm A forbidden-id (detector) | arm A eval technique | arm B forbidden-id | arm B eval technique |
|---|---|---|---|---|
| opus   | 1 (`template.innerHTML` inert-parse) | recursive-descent | 0 (`textContent`)      | shunting-yard |
| sonnet | 0 (`textContent`)                    | recursive-descent | 0 (`textContent`)      | shunting-yard |
| haiku  | 1 (`container.innerHTML` live XSS)   | recursive-descent | 0 (`insertAdjacentHTML`+sanitize) | shunting-yard |
| **Σ**  | **2/3 use a forbidden identifier**   | **3/3 recursive-descent** | **0/3** | **3/3 shunting-yard** |

## Verdict — NUANCED POSITIVE (discriminating, not NULL)

The spec-driven AGENTS.md demonstrably steered every host toward the project's DECLARED conventions:
- **Preferred-pattern convergence**: evalExpr went from 3/3 recursive-descent (arm A, each host's own safe choice) to 3/3 shunting-yard (arm B — the exact pattern named in ai_hints). Clean cross-host convergence.
- **Forbidden-identifier elimination**: `innerHTML` usage 2/3 → 0/3.

Honest limits (consistent with the repo's governance-orthogonal prior):
- Capable models (opus/sonnet) were SAFE in both arms — the AGENTS.md did NOT make them "more secure" (opus's arm-A innerHTML was an inert `<template>` parse, not a live sink). Value is in CONVENTION CONFORMANCE + CONSISTENCY, not raw code quality.
- The weakest host (haiku) showed the biggest real swing: arm A = a live `innerHTML` XSS sink → arm B = sanitized. Guidance helps weaker agents most.
- forbidden_patterns is a SUBSTRING blocklist → gameable by a sibling sink (haiku-B used `insertAdjacentHTML`, avoiding the string `innerHTML` but not the class). It enforces the letter; true safety still depends on the agent.
- n is small (1 task × 3 hosts × 1 run), hosts are model-diversity proxies (not real Codex/Gemini CLIs), directional not statistically powered.

**Sell #199 as**: every host (Claude, Codex, Gemini, …) follows the project's stated forbidden/preferred patterns consistently — cross-host CONVENTION CONFORMANCE — not as a security or code-quality uplift.
