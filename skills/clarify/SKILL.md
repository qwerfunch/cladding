---
description: Advance the onboarding Q&A loop after `clad init <intent>`. Pass the user's answer to the next pending question as a positional argument; the LLM refines spec/docs based on the full Q-A history and may emit new follow-up questions. Reads/writes `.cladding/onboarding/state.yaml`. Use when the user is mid-onboarding and you have collected their reply to one clarifying question — never invent answers.
---

# Cladding clarify (formerly `refine`)

Drives the **iterative onboarding loop** initiated by `clad init <intent>`. The init pass writes `.cladding/onboarding/state.yaml` with 2–3 clarifying questions; `clad clarify <answer>` advances the loop one question at a time.

## Artifacts produced (by Tier)

| Tier | File | Authority |
|---|---|---|
| A | `spec/scenarios/<slug>-<hash6>.yaml` (refined, v0.3.45+) | Spec SSoT (onboarding output) |
| B | `spec/architecture.yaml` (refined) | Design SSoT |
| B | `spec/capabilities.yaml` (refined) | Design SSoT |
| B | `docs/project-context.md` (refined) | Design SSoT |
| D | `.cladding/onboarding/state.yaml` (Q&A history updated) | transient audit |

Existing files divert to `.cladding/scan/*.proposal` per the SSoT model's refresh policy. See [`docs/ssot-model.md`](../../docs/ssot-model.md).

## Flow

1. `clad init <intent>` → produces initial artifacts + writes `state.yaml` with pending questions
2. Orchestrator asks the user the **first pending question verbatim**
3. User replies
4. Orchestrator runs `clad clarify <user's reply>` (positional, no quotes needed)
5. `clad clarify` marks the question answered, re-runs the LLM with the full Q-A history, refines artifacts, may add new follow-up questions
6. Loop until `status: done`

## Variadic positional

```
clad clarify 법인 사업자만 (개인사업자 제외)
clad clarify "한국 시장 위주"
clad clarify 카드 + 간편결제 우선
```

All tokens are joined with spaces — quoting is optional.

## Flags

- `--cwd <path>` — directory containing `.cladding/onboarding/state.yaml` (default cwd)
- `--no-llm` — force deterministic interpreter; current artifact bodies are preserved and the answer is logged as a Q&A footnote in `docs/project-context.md`
- `--json` — emit a `RefineReport` JSON (`{cwd, answered, newQuestions, mode, status}`) instead of the formatted text

## Output (text mode)

- Pulse summary line — `✓ clarify answered · mode: greenfield · source: llm`
- Created / proposal entries for refined artifacts (existing files divert to `.cladding/scan/*.proposal`)
- New clarifying questions printed as a numbered list (if any)
- Closing line — `남은 질문: N 개. clad clarify <답변> 으로 계속.` OR `✓ 모든 질문에 답변 완료 — 온보딩 종료.`

## Exit codes

- `0` — answer accepted (or no-op when state is already done)
- `1` — fatal error (corrupt state file)
- `2` — usage error (no state file present, or no answer provided)

## State file

`.cladding/onboarding/state.yaml` shape:

```yaml
intent: "결제 SaaS for B2B"
language: typescript
projectName: payment-saas
mode: greenfield
startedAt: 2026-05-21T12:34:56.789Z
status: active
qa:
  - question: "주 사용자가 개인? 사업자?"
    answer: "법인 사업자만"
  - question: "어떤 결제수단 우선?"
    answer: null
```

`status: done` is set once every question has an answer AND the latest refinement returned no new questions. The file stays on disk as an audit log of the onboarding decisions.

## When NOT to invoke

- `state.yaml` does not exist → exit 2. Run `clad init <intent>` first.
- The user has not replied yet — never invent answers. Wait for their actual response.
- The user is asking about an unrelated topic — pause the loop and resume later when they're ready.
