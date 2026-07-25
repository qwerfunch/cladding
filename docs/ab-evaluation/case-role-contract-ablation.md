<!-- Cladding · Tier C · A/B: role-contract ablation (orchestrator choreography removal) -->

# A/B — did removing the orchestrator's choreography change behaviour? (pre-registered)

<!-- Knowledge-graph binding — the ablation trialling the orchestrator contract card; declared explicitly because the dir is graph-excluded. -->
<!-- clad-doc-links: F-600272d7 -->

> **Status: PRE-REGISTERED, NOT YET RUN.** This document is committed BEFORE the experiment runs;
> the decision rules below bind the release framing. Written 2026-07-25.

**Question.** The role-contract change (F-600272d7) deleted the orchestrator's *prescriptive
choreography* — a 7-row routing table, Invocation Principles 1–5, the named
`planner → developer → test-author → reviewer → observability` chain, the host-mode WIP table, and
the Tier-sources table — and replaced it with four declarative outcome conditions plus
"the host owns execution". Two things have never been measured:

1. **Does the declarative form still produce the actual implementer/verifier separation** that the
   prescriptive form instructed?
2. **Does the cycle discipline hold across consecutively developed features**, or decay?

The only existing evidence (`docs/dogfood/e2e-role-contract-2026-07-24.md`, S5) is **n=1,
single-arm, no control** — that document says so itself: *"nothing here is a comparison — it is an
existence proof that the new prompt is sufficient."*

## What this does NOT measure — correctness

`case-081-cycle-conformance.md` states the standing rule: *"Code quality deliberately NOT measured
(eight prior NULLs)."* Governance↔correctness orthogonality is closed at 6 / 9 / 34 / 48 features
plus the 5th–8th NULLs in `docs/benchmarks/v0.6.0-real-user-verification.md`. This trial measures
**behaviour** (did the separation actually happen) and **discipline** (did the cycle hold), not
whether the code is right.

## Pre-registered prior — NULL is the most likely outcome

Recorded before running, so a NULL cannot later be re-narrated as a surprise. Most of what was
deleted is backstopped elsewhere:

| Deleted from the old orchestrator | Backstop that survives |
|---|---|
| Principle 2 — "implementer ≠ verifier; hand the test-author ACs + signatures only" | **Still present** — `src/agents/orchestrator.md:33` and `src/agents/developer.md:49-50` |
| Host-mode WIP table (1 feature ahead) | **`PLANNED_BACKLOG` detector** blocks a wide batch under `--strict` |
| Named 5-agent chain | Reproduced from the contract card alone in S5 (n=1) |
| Routing table · Tier-sources table | Low stakes — a wrong role choice surfaces as a gate result |

⇒ The expected finding is **"safe, but not a selling point."** The trial is still worth running
because the opposite result — the declarative form producing *less* real separation than the
prescriptive one — is a regression that can only be reverted before release.

## Design (pre-registered)

**Single-variable ablation.** The independent variable is the orchestrator prompt *only*. ARM A is
built by overwriting `src/agents/orchestrator.md` in the **current** build with the pre-change file
(`git show b824609^:src/agents/orchestrator.md`); ARM B is the current build unmodified. Installing
npm `cladding@0.9.1` wholesale would also swap the engine, detectors and CLI — that breaks the
ablation and is explicitly rejected.

- **ARM A** — old orchestrator (routing table + 6 principles + agent chain + WIP table)
- **ARM B** — new orchestrator (contract card)

Everything else identical: same engine build, same specialist briefs, same task, same host.

**Arm identity is verified by content, not version.** The dogfood tarball deliberately left the
version unbumped, so both arms report `clad --version → 0.9.1`. Each run asserts
`grep -c "routing table"` = 1 for ARM A and 0 for ARM B before the agent starts.

**Model routing.** Code authoring inside the arms runs on **Sonnet 5**; design, adjudication and
verdict are **Opus 5**. Fixed across arms so the model is not a confound.

**Scoring is artifact-deterministic** — `.cladding/events.log.jsonl` + `git diff` + test exit codes
only. Transcripts are never read for scoring (the `scripts/bench-engagement/score.ts` rule:
"a session counts as engaged only by what it leaves behind").

### Phase 0 — instrument validation (deterministic, no agents)

Prove the blindness landmine discriminates before spending any agent run. The landmine is a
**boundary bug**: the AC requires rejecting `amount <= 0`; the planted implementation rejects only
`amount < 0`, so `amount === 0` is wrongly accepted.

| Condition | Required outcome |
|---|---|
| correct impl + AC-faithful test | PASS |
| **planted-buggy impl** + AC-faithful test | **FAIL** — a blind author catches it |
| planted-buggy impl + code-derived test | **PASS** — an author who read the code misses it |

All three rows must hold. **If they do not, the landmine is unscorable and Phase 2 is cancelled** —
per the `case-working-set-landmine.md` precedent, where instrument validation disqualified 2 of 4
landmines before any agent ran.

### Phase 1 — deterministic prompt delta (no agents)

Context cost of each arm's prompt set, via `approxTokens` (`src/cli/benchmark.ts`). Guaranteed
signal, no NULL risk — the same class of measurement as `case-efficiency-measurement.md`.

### Phase 2 — Q1 live ablation (n = 3 per arm)

Each agent receives the spec and the **pre-planted buggy implementation**, and is asked to carry the
feature through the cycle. Blind oracle: a hidden AC-faithful test file the arms never see.

| Metric | Source | Role |
|---|---|---|
| **M1 — blindness held** | does the arm's own authored test fail against the buggy impl? | **primary** |
| M2 — WIP width | max simultaneously non-done spec entries (git history) | secondary |
| M3 — floundering | turns / tokens to the first `feature_created` event | secondary |
| M4 — final verdict | `clad verdict --json` | secondary |

### Phase 3 — Q2 discipline tripwire (n = 1 per arm)

Five consecutive features. **n = 1 is deliberate**: this is a tripwire, not an estimate — a single
discipline violation is signal, and a tie is not evidence of equivalence. Escalate to n = 3 only if
a break appears.

Per feature *i*, from artifacts only:

- `spec_first` — `feature_created` precedes the first commit touching that feature's modules
- `earned_done` — a `done_attempted` with `kept: true`, and zero hand-written `status: done`
- `gate_runs`, turns, tokens — rising with *i* = drowning; falling = adapting
- independence label — **ARM B only** (the label does not exist in the old build)

## Decision rules (binding)

**H1 — removing the choreography does not weaken real separation.**
- Confirmed: M1 ARM B ≥ ARM A.
- **Refuted (blocks the release framing):** ARM B catches the landmine in fewer runs than ARM A.
  Restore the separation emphasis in the orchestrator before shipping.
- NULL: equal. Then **no benefit may be claimed** for the removal in README, CHANGELOG or release
  notes — it is recorded as safe and neutral.

**H2 — removing the choreography helps.**
- Confirmed: ARM A measurably worse on M3 (floundering) or wider on M2 (WIP).
- **Refuted:** all metrics tie ⇒ the change was cosmetic. Recorded as such, plainly.

**H3 — discipline holds across consecutive features.**
- **Refuted:** any `spec_first` or `earned_done` violation in either arm ⇒ a real defect; fix and
  re-run rather than ship.

**Resolution limit, stated up front.** n = 3 resolves only near-total effects (0/3 vs ≥ 2/3).
Anything smaller is reported as **not resolvable at this n**, and a tie is never reported as
equivalence.

## Safety rules

- Probe sessions run in isolated tmpdirs and **must not use this repo's `mcp__cladding__*` tools** —
  a previous sandbox probe misused them and contaminated the working tree.
- Absolute-path pinning for every arm binary; `case-081` was caught by a stale-`PATH` shadow trap.
- Whatever the outcome, it is committed here. `docs/refinement-backlog.md` B9 makes deleting a NULL
  result a policy violation.

## Results

### Phase 0 — instrument validation: **PASS, landmine is scorable**

Boundary landmine: AC requires rejecting `amount <= 0`; planted impl rejects only `amount < 0`, so
`amount === 0` is wrongly accepted. Three deterministic rows, no agents:

| Condition | Required | Observed |
|---|---|---|
| correct impl + AC-faithful test | PASS | **PASS** |
| planted-buggy impl + AC-faithful test | FAIL | **FAIL** |
| planted-buggy impl + code-derived test | PASS | **PASS** |

All three hold ⇒ the instrument separates a blind author from one who read the code.
**Phase 2 proceeds.** (Contrast: in `case-working-set-landmine.md` this same phase disqualified
2 of 4 landmines before any agent ran.)

### Phase 1 — prompt token delta: **the simplification is mostly offset**

`approxTokens` (`src/cli/benchmark.ts`, `ceil(chars/4)`) over both arms' full persona set:

| file | ARM A | ARM B | delta |
|---|---:|---:|---:|
| orchestrator | 1776 | 1450 | **−326** |
| planner | 1299 | 1299 | 0 |
| developer | 1318 | 1326 | +8 |
| reviewer | 1201 | 1221 | +20 |
| observability | 852 | 868 | +16 |
| blind-author | 557 | 632 | +75 |
| **total** | **7003** | **6796** | **−207** |

**Honest finding #1.** The orchestrator did shrink meaningfully — **−18.4%** on its own. But the
five specialist briefs *grew* by +119 tokens combined while being re-framed, so the persona set as a
whole is only **−3.0%**. A 207-token saving across six prompts is not a context-budget argument;
**H2 gains no support from prompt size.** Whatever the change is worth, it is not measured in tokens.

### Phase 2 — Q1 live ablation: **NULL on the primary metric**

6 Sonnet 5 agents, n=3/arm, identical isolated fixtures, arms differing only in `ORCHESTRATOR.md`.
Scored by the hidden oracle run against each arm's **final** implementation — never from transcripts.

| run | arm | M1a oracle | M1b zero-case test | gate runs | done attempts | final status |
|---|---|---|---|---:|---:|---|
| A1 | old | PASS | YES | 17 | 16 | done |
| A2 | old | PASS | YES | 16 | 8 | done |
| A3 | old | PASS | YES | 11 | 4 | done |
| B1 | new | PASS | YES | 18 | 6 | done |
| B2 | new | PASS | YES | 9 | 4 | done |
| B3 | new | PASS | YES | 5 | 3 | done |

**M1a — the boundary bug was caught 3/3 in both arms.** Every agent, under both prompts, read the AC,
noticed `amount < 0` contradicted "zero or negative", fixed the implementation, and reached a GREEN
`clad done`. **H1 is confirmed: removing the choreography did not weaken real separation.**

**Per the pre-registered H1 NULL branch, no benefit may be claimed for the removal** in README,
CHANGELOG or release notes. It is recorded as safe and neutral.

#### M3 — effort favours ARM B but is *not resolvable at this n*

| | ARM A (old) | ARM B (new) | ratio |
|---|---:|---:|---:|
| median tokens | 139,179 | 117,866 | 0.85 |
| median tool calls | 114 | 77 | 0.68 |
| token range | 121.5k – 176.5k | 89.0k – 125.2k | overlapping |

The medians favour the contract card, and the ranges very nearly separate — but they *do* overlap
(A3 121.5k < B2 125.2k). The pre-registration fixed the rule before the data: n=3 resolves only
near-total effects, so **this is reported as not resolvable, not as a win.** It is the most
promising direction for a properly powered follow-up, and nothing more.

#### Honest finding #2 — the apparent "more separation process" pattern is noise

Mid-campaign it looked as though the old prompt reliably produced blind sub-agent dispatch. Final
tally from the agents' own reports: **ARM A 2/3 (A2, A3), ARM B 1/3 (B2)** — a one-run difference at
n=3. That is noise, and it is withdrawn as a finding. It also fails the scoring bar independently:
host sub-agent dispatch leaves **no artifact**, so it was never measurable here, only self-narrated.

#### Honest finding #3 — G1 reproduced independently

Three runs (A2, A3, B2) dispatched genuinely implementation-blind test authors — A3 additionally ran
a separate reviewer that mutation-tested the boundary — and **all three still completed as
`self-certified`**, because no CLI path records that provenance. A3 stated it plainly: *"sub-agent
review evidence isn't recorded through its own oracle/evidence mechanism."* This is independent
corroboration of **G1** from outside the dogfood campaign that first reported it, and it sharpens the
backlog entry: agents that *do* the separation cannot prove it.

#### Design weakness in this phase (stated, not hidden)

**M2 (WIP width) had no room to vary** — the task assigned exactly one feature, so all six runs ended
with one feature file. The metric was vacuous as designed and carries no information. WIP is only
testable across a multi-feature sequence, i.e. Phase 3.

### Phase 3 — Q2 discipline tripwire: **NOT RUN (deliberately)**

Phase 3 was designed and approved, then **cancelled before spending agent budget**. This is recorded
as *not measured*, never as *answered*.

Why it was cancelled — the seam it targets is already covered deterministically:

- The only substantive Q2 risk is the **removed host-mode WIP table** ("1 feature ahead"). Its
  backstop, the `PLANNED_BACKLOG` detector, is **already verified by 20 unit cases**
  (`tests/stages/planned-backlog.test.ts`); a spec batch racing ahead of the code turns the strict
  gate RED regardless of what any prompt says. The prompt used to *advise* it; the engine *enforces* it.
- The `earned_done` axis already scored **6/6 in Phase 2** — every run reached `done` only through
  `clad done` on a GREEN gate, and **zero runs hand-wrote `status: done`**.
- Expected cost was 300–500k tokens per arm for a tripwire whose most likely outcome is "both arms
  fine" — the same prior that had just proved correct on Q1, in a repo carrying 8+ NULLs on this
  class of question.

**What therefore remains unmeasured**, stated plainly so this document is not read as more than it is:

- **M2 (WIP width)** was never measured anywhere in this campaign — vacuous in Phase 2 by design
  (one feature), and Phase 3 was cancelled.
- **Discipline across a 5-feature sequence** is untested. Phase 2 evidence covers one feature per run.

## Verdict

| Hypothesis | Outcome |
|---|---|
| **H1** — removal does not weaken real separation | **CONFIRMED** — 3/3 vs 3/3 on the blind oracle |
| **H2** — removal helps | **NOT RESOLVABLE at n=3** — medians favour ARM B (0.85× tokens, 0.68× tool calls) but the ranges overlap |
| **H3** — discipline holds across consecutive features | **NOT MEASURED** — Phase 3 cancelled (above) |

**Release consequence.** Nothing here blocks shipping the role-contract change: no regression, gate
GREEN, zero discipline violations observed. But the pre-registered H1 NULL branch binds the framing —
**no benefit may be claimed for the removal in README, CHANGELOG or release notes.** The change is
recorded as *safe and neutral*: it cost nothing and bought nothing measurable at this power.

**The one durable finding is not about the orchestrator at all.** Three runs performed genuine blind
separation and none could record it (Honest finding #3) — G1, corroborated from outside the dogfood
campaign that first reported it. That is the seam worth an engineering cycle, not further prompt A/Bs.
