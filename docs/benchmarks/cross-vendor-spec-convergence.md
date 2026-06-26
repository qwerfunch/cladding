# Cross-vendor spec convergence — does a shared spec make different AIs / weaker models build the same way?

**Date:** 2026-06-14 ~ 06-15 · **Vendors:** Claude Code CLI (sonnet = strong, haiku = weak) · Gemini CLI (gemini-2.5-pro = strong, gemini-2.5-flash = weak) · **Method:** headless `-p` builds in isolated config dirs; two conditions (`bare` = functional prompt only · `spec` = same prompt + a shared `spec.yaml` (`ai_hints.preferred_patterns`) + `docs/conventions.md` + a feature shard, with "build the project's way"). Convergence scored by module-topology Jaccard, type-name Jaccard, abstraction-signal agreement, a 0–5 conformance score, and a blind 2-judge coherence read (anonymized). Infra: `/tmp/clad-abc/conv*` (setup / run / extract scripts).

> **Scope note.** This study measures one thing: **consistency** — do independent builds, by different AI *vendors* and different model *tiers*, converge on the same project way when they share a spec? It does **not** measure correctness or code quality, and nothing here should be read as such. Self-contained; not a roll-up of other benchmarks.

## TL;DR

A shared spec **aligns** independent builds — across vendors *and* across model tiers — almost perfectly in greenfield, and substantially when extending existing code. The one thing injection alone does **not** secure is the hardest structural judgment (extracting a varying behavior behind an interface); a **capable reviewer** catches that omission and even a **weak author repairs it once told**. Detection needs a capable model; authoring and repair do not.

> **"Injection aligns, review guarantees."** Shared spec = cheap broad alignment. The single hard structural axis = capable-reviewer detection + (anyone) repair.

---

## R1 — Two vendors, greenfield (event-sourced store)

Claude (sonnet) vs Gemini (pro) each build the same store independently, `bare` vs `spec`, 2 reps each (within-vendor reps = control for "do independent builds just vary?").

| pair | topology | type-names | abstraction-signal |
|---|---|---|---|
| **bare** cross-vendor | 0.67 | 0.33 | **0.25** |
| bare within-vendor | 0.67 | 0.61 | 0.75 |
| **spec** cross-vendor | **1.0** | 0.53 | **0.88** |
| spec within-vendor | 1.0 | 0.55 | 0.88 |

- **Divergence is real and vendor-driven**: bare cross-vendor agreement (0.25) ≪ within-vendor (0.75). Concretely, Claude returned `Result<T,E>` (errors-as-data); Gemini `throw`​ew. Module split differed.
- **The spec converges them**: under `spec`, both vendors produced the same module topology and both adopted `Result`. Cross-vendor rose to within-vendor level.
- **Decisive**: Gemini ran with **zero cladding hooks/MCP** — it converged by *reading the spec files alone*, flipping its default `throw` → `Result` and even copying the `// Why:` comment convention (verified in `gemini-spec/src/errors.ts`).

## R2 — Different domain · existing-code extension · longer session

**(a) Different domain — rate limiter, greenfield (strong):**

| | files | conformance /5 |
|---|---|---|
| claude-bare | 1 (monolith, throws) | 2/5 |
| gemini-bare | 3 | 4/5 |
| **claude-spec** | 6 | **5/5** |
| **gemini-spec** | 6 | **5/5** |

Cross-vendor: **bare** topo 0.33 / sig 0.60 → **spec** topo **1.0** / sig **1.0**. The R1 finding replicates on an unrelated domain — not a single-domain fluke.

**(b) Existing-code extension — job-queue seed + add dead-letter & priority.** A hand-authored seed embodies the conventions (Result, one-module-per-responsibility, `RetryStrategy`-style interfaces). Each vendor extends it, `bare` (code only) vs `spec`.

| convention dimension | result |
|---|---|
| **error model** (Result / no-throw) | **conformed by ALL arms, even bare** — the existing code is densely conventioned, so extenders mimic it from the code alone (spec not needed here) |
| **new-module-per-responsibility** | bare diverges (gemini-bare added **0** new files, crammed into `queue.ts`); spec helps (claude-spec → `dead-letter.ts` + `ordering.ts`; gemini-spec → `dead-letter.ts`, priority inline) |
| **interface for varying behavior** | only **claude-spec (sonnet)** abstracted priority behind an `OrderingPolicy`; others crammed it inline |

Blind coherence (anonymized 2-judge): claude-spec ~85 ("same team: yes"), gemini-spec ~70, bares ~68–70.

**(c) Longer session** (multi-feature extension over ~60 turns): spec arms ~77.5 coherence vs bare ~69.5 — the spec **reduces** drift over a longer build but does not fully prevent it.

## R3 — Weak models, greenfield (rate limiter)

Re-run R2(a) with **haiku** and **flash**.

| | files | conformance /5 |
|---|---|---|
| claude-bare-weak (haiku) | 3 | 3/5 |
| gemini-bare-weak (flash) | 1 (monolith, throws) | 2/5 |
| **claude-spec-weak** | 6 | **5/5** |
| **gemini-spec-weak** | 6 | **5/5** |

Cross-vendor: **weak bare** topo 0.33 / sig 0.80 → **weak spec** topo **1.0** / sig **1.0** — identical to the strong tier. **The spec converges weak models just as well as strong ones**; weaker models start messier in `bare`, so the spec's lift is, if anything, *larger*.

## R4 — Weak models, existing-code extension (the hard axis)

Re-run R2(b) with weak models.

| dimension | weak-tier result |
|---|---|
| error model | **HOLDS** — all 4 weak arms used Result/no-throw |
| DLQ-as-new-module | **PARTIAL** — weak-bare added 0 new files; weak-spec both created a dead-letter module |
| **interface abstraction** (priority) | **DEGRADES** — **no weak model abstracted priority, even with the spec**; all crammed it into `queue.ts`. Only strong sonnet+spec achieved it (R2b). |

Blind coherence (weak): ~63.5–87 (mean ~73; one haiku-bare outlier ~87). The hardest structural judgment is a **cliff**, not a gradient: weak models simply don't recognize "this should be behind an interface," spec or not.

## R5 — Reviewer backstop (capable reviewer)

Run cladding's **reviewer persona** (sonnet, read-only) on the arms that failed the interface axis, plus the one that passed (control).

**Detection:**

| arm | flagged "priority not behind an interface"? |
|---|---|
| gemini-spec (pro) | ✅ |
| claude-spec-weak (haiku) | ✅ |
| gemini-spec-weak (flash) | ✅ |
| claude-spec (control, already abstracted) | ✅ correctly **not** flagged (no false positive) — and it surfaced 3 *other* real violations (worker relies on thrown handler, missing `// Why:`) |

**Repair** — feed the finding back to the **original author** (same vendor/tier):

| arm | fix |
|---|---|
| gemini-spec-weak (flash) | created `orderingPolicy.ts` (interface + impl, injected) — clean ✅ |
| claude-spec-weak (haiku) | created `ordering.ts` (`OrderingStrategy`) — clean ✅ |
| gemini-spec (pro) | interface + delegation, kept inside `queue.ts` — done, slightly less clean |

**3/3 abstracted the behavior after the review — including the weak models that could not do it proactively.** The expensive cognitive step (recognizing the abstraction is *needed*) lives in the reviewer; the repair is easy enough for a weak author.

## R6 — Does a *weak* reviewer detect it? → No

Re-run R5 detection with weak reviewers.

| reviewer | detection of the interface-abstraction omission (3 failing arms) |
|---|---|
| **sonnet (capable)** | **3/3** |
| haiku (weak) | **0/3** (caught only export-consistency / `// Why:` nitpicks) |
| flash (weak) | **0/3** (caught only a Result-masking issue; gave the control `passes: true` — found nothing) |

Weak reviewers are not useless — they catch shallow, local violations — but they are **blind to the hard semantic-consistency judgment**, the same blind spot weak *authors* have. **Detection requires a capable model.**

---

## Synthesis

| Question | Answer |
|---|---|
| Do different vendors diverge without a spec? | **Yes** (errors-as-data vs throw; topology). Vendor-driven, not noise. |
| Does a shared spec converge them? | **Yes, near-perfectly in greenfield** (topo 1.0), across **both vendors and both model tiers**. |
| Does it hold when extending existing code? | **Partially** — local conventions (error model) conform from the code alone; structural rules need the spec; the hardest abstraction needs more than prose. |
| Do weak models comply? | **Yes** on easy/medium axes; **no** on the hardest structural abstraction. |
| Can a reviewer backstop the gap? | **Yes** — capable reviewer detects (3/3), any author repairs (3/3). |
| Can a weak reviewer? | **No** (0/3). Detection is the capability-bound step. |

**The asymmetry (and the cost rule it implies):**

| step | difficulty | who can do it |
|---|---|---|
| **detect** "this needs abstraction" | hard (cognition) | **capable model only** |
| **repair** once told | easy (execution) | weak model OK |
| **author** under a shared spec | easy/medium | weak model OK |

> **Run cheap models for authoring and repair; spend a capable model on review — once.** This is exactly the economics of cladding's `reviewer → developer` loop-back recipe: concentrate the expensive cognition at the review step, keep everything else cheap.

## Limitations (honest)

- **Small n**: 1–2 reps, one task per domain, a single structural dimension (interface-for-priority) for the hard-axis tests. Directional, not definitive.
- **"Compliance by reading" ≠ enforcement**: tools *chose* to follow the spec here (fresh tasks, small specs, capable-enough models). Longer sessions and weaker models can still drift — which is *why* the reviewer backstop matters.
- **No independent third vendor**: a genuine open-weights vendor (Qwen2.5-Coder via ollama) was downloaded but **could not run** (ollama inference engine missing `llama-server`; no third-party API keys present). So "different vendor" = Claude vs Gemini only. The runner (`run-ollama.mjs`) is kept for when an engine/key is available.
- **Correctness is not measured here** — this is purely a consistency / convergence study; do not read any result as "better code."
- Coherence scores are LLM-judge reads (anonymized, 2 judges/arm); the ~15-point gaps are real but could calibrate differently.

## Reproduce

Scripts under `/tmp/clad-abc/conv` (R1) and `/tmp/clad-abc/conv2` (R2–R6): `setup*.mjs` scaffolds the bare/spec templates + job-queue seed; `run*.mjs` drives one vendor/tier/condition build headless; `extract*.mjs` computes the topology/conformance signals; `run-review*.mjs` + `run-repair.mjs` run the reviewer-detection and author-repair passes. Blind coherence judging was run as anonymized 2-judge workflows over copies stripped of arm labels.
