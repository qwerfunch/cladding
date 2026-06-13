# Pre-registration — the spec-as-context hypothesis (vision ①)

**Status:** REGISTERED (0.6.0). Execution target: 0.7, after `clad adopt`
(brownfield backfill) ships. This document is committed BEFORE the experiment
runs; the decision rule below binds the roadmap.

## Hypothesis under test (falsifiable)

On a large existing codebase (~100–200k LoC), an agent working with an
accumulated intermediate-language spec **plus its delivery machinery**
completes maintenance tasks with materially less exploration (tokens / tool
calls) and better impact accuracy than agents without it, at an
equal-or-better regression rate.

Why this needs a pre-registered kill criterion: every favorable prior signal
was structurally advantaged (H7 asked spec-vocabulary questions a vanilla
tree cannot answer by construction; the vanilla arm was hand-curated; the
proxy reader was not a model), while every direct outcome measurement
(conformance at 6/9/34/48 features) was NULL. The theory says the advantage
is an increasing function of codebase size — small-scale NULL does not refute
it — but theory also says the competitor at scale is not "no map" but "a
cheap map", and the premise "the map stays true" is exactly what annotation
drift already violated once (9 correct features falsely rejected).

## Arms (confound controls bind — review T6)

| Arm | Artifact | Delivery machinery |
|---|---|---|
| A | full cladding spec (backfilled via `clad adopt` + capped LLM refinement, budget logged) | SessionStart injection + `clad_get_context`-shaped retrieval + index |
| B | vanilla — code + the repo's REAL docs/README intact (stripping them would rig the comparison) | none |
| C | generated summaries (ARCHITECTURE.md + per-directory digests, refreshed per session; an afternoon of tooling, no schema, no gates) | **the SAME machinery as A**: same SessionStart injection, same retrieval tool over summary chunks, same token budget |

Arm A runs with **gates and enforcement OFF** — vision ① (context) must be
measured separately from vision ② (verification), which is already evidenced
and survives this experiment either way.

## Tasks & execution

- 2 pinned OSS TS repos (80–200k LoC, green suites, ≥50 post-pin merged PRs
  for ground truth), e.g. excalidraw / outline class.
- 12 tasks per repo mined from real post-pin PRs: 4 localized fixes
  (expected NULL — the control), 4 cross-cutting changes (≥3 modules — where
  the hypothesis lives), 4 impact-only questions.
- Same model, fixed version, headless; 3 runs per task per arm.

## Endpoints (primary first)

1. Exploration cost: tool calls + input tokens before the first edit of a
   ground-truth-relevant file; total session tokens.
2. Impact accuracy: precision/recall of predicted affected files vs the
   ground-truth PR ∪ failing tests.
3. Regression rate (full suite after the agent's diff) and task success
   (withheld ground-truth tests).
4. Reported separately, never netted away: harness overhead (shard upkeep,
   annotation churn) and spec-misled incidents (agent followed a stale map
   into a dead end).

## Decision rule (the kill criterion — binding)

- **A must beat C** (not merely B) on the cross-cutting endpoints:
  ≥20% median exploration-token reduction with a CI excluding zero, OR a
  significant impact-recall gain — at no worse regression/task-success.
- If A ≈ C: the value was "any summary + delivery", not the spec ontology —
  **vision ① is demoted from the roadmap** (the verification harness, ②, and
  rendering, ④, stand on their own evidence and are unaffected).
- If A < B on overhead-adjusted totals: demote AND record the overhead
  decomposition before any retry.
- Expected and accepted: NULL on the localized-task control.

No post-hoc endpoint additions; any protocol change before execution amends
this file in a reviewed commit.
