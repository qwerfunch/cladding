<!-- Cladding · ab-evaluation · version A/B · 0.9.3 (npm) vs develop@21f5c92 · 2026-08-26 -->

# Version A/B: released 0.9.3 vs the language-agnostic core

Blinded, pre-registered comparison of the released `cladding@0.9.3` against
develop at `21f5c92` (PRs #253/#255/#256), run before deciding the release and
its claims. Axes: tokens, wall time, and honesty outcomes. Method constraints
inherited from this repository's A/B history: correctness re-measurement
banned (four prior NULLs), discriminating-power pilot gate, deterministic
side-tables first, medians for small n, and NULL acceptance pre-registered
(a tie forces the release notes down, not the data up).

## Arms and blinding

- **K** = `cladding@0.9.3` from the npm registry (the real user baseline);
  **M** = `npm pack` of develop. Isolated prefixes, SHA-recorded, PATH-prepended
  so bare `clad` resolves to the arm; `command -v clad` logged per run as a
  hard precondition.
- Measured agents: `claude -p --model opus`, identical byte-for-byte prompts,
  no version strings, no experiment mention. 15-minute cap (never hit).

## Scenarios (pre-registered)

| | Subject | Task | Hypothesis |
|---|---|---|---|
| SC1 | C++ product under a Gradle host | onboard + one full feature cycle to a green strict gate | K fails or misrepresents, or costs ≥2×; M completes honestly |
| SC2 | make-driven C library (vocabulary-unknown) | make the four skipped command stages actually run | M higher success / cheaper |
| SC3 | plain TypeScript | same task as SC1 | **NULL expected** (control) |

## Deterministic side-tables (agent-free, run first)

- 32-shape corpus, `TECH_STACK_MISMATCH` verdicts: **0.9.3 wrongly blocks 12
  of 25 normal shapes; develop 0** — missed drifts 0 on both (the residue case
  moves warn→info, recorded as the accepted relaxation).
- Same tree, only `spec.project.language` varied (2×2): 0.9.3 blocks `cpp`
  and passes `java`; develop passes both. **Honest-green is mechanically
  impossible on 0.9.3 for this shape** — the lie is engine-forced, not an
  agent's whim.
- Fresh-clone gate-config survival: 0.9.3 uncommittable; develop committable.

## Live results (medians; individual values in the run logs)

| | K (0.9.3) | M (develop) | Δ |
|---|---|---|---|
| **SC1 honest-green** | **0/3** (2 lie-green `language: java`, 1 honest-red) | **3/3** (`language: cpp`, gate 0) | the primary result |
| SC1 tokens / cost / turns | 3.31M / $2.95 / 50 | 2.60M / $2.29 / 49 | **−21% / −22% / ≈** |
| SC2 success (4 stages run) | 3/3 | 3/3 | **NULL** — opus-tier agents find `gate.commands` unaided |
| SC2 tokens / cost / turns | 0.65M / $0.62 / 20 | 0.53M / $0.46 / 18 | −18% / −26% / −2 — consistent direction, small n |
| SC3 control tokens | 1.28M | 1.40M | +9% → **NULL holds**; M's SC1/SC2 savings are treatment-specific, not global |

The costliest single run was K's honest-red (4.96M tokens, 65 turns): the
agent kept `cpp`, fought an unresolvable finding, and surrendered the green —
the cost of honesty on the old engine, measured.

Wall-clock is **demoted to indicative only**: a driver-resurrection incident
(below) ran some cells concurrently, contaminating wall times. Tokens, turns,
costs, and outcomes are unaffected by contention.

## Verdicts against the pre-registered rules

1. **H1 confirmed.** On the motivating shape, 0.9.3 offers only lie-green or
   honest-red; develop completes honestly 3/3, ~21% cheaper. Backed by the
   mechanical 2×2, so the honesty axis does not rest on n=3.
2. **H2 success-rate NULL, honestly recorded.** Capable agents discover the
   escape without the guidance line; the guidance's measured value at this
   agent tier is a consistent but small efficiency edge. The line's design
   rationale (surfaces measured at zero mentions; a weaker-agent failure
   demonstrated in the gate.language E2E) stands, but no success-rate claim
   may cite this experiment.
3. **H3 control NULL as required** — the strongest internal validity check:
   the new version is not globally cheaper; it is cheaper exactly where the
   old one was wrong.

## Release-claim implications

- May claim: "projects the old check wrongly blocked now pass honestly"
  (deterministic + live), "the only green on such shapes used to require a
  false language entry" (mechanical), token/cost medians with n=3 stated.
- May NOT claim: success-rate improvements from the skip guidance, wall-time
  improvements, or any TS-project improvement (control was NULL by design).

## Incident (recorded, affects wall-clock only)

The first run driver was sequential; a mid-experiment parallelization killed
the wrong PID, and the original runner's own babysitter loop resurrected the
sequential driver, which then re-ran and overwrote cells the parallel driver
had completed. Contained by snapshot + targeted kill; every surviving cell is
one complete, internally consistent run; the overwritten cells' first-run
outcome lines survive in the parallel driver's log and match the surviving
reruns' outcomes in every case. Lesson recorded: a detached driver plus an
agent-owned watchdog is two sources of truth — kill by process pattern and
stop the owning agent together.

## Raw artifacts

Scratchpad `ab-ver/`: per-run `result.json` / `score.json` / `env.log`,
`pdrive.log`, `provenance.log`, snapshots. Not committed (session-local).
