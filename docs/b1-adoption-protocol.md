<!-- Cladding · Tier B · B1 adoption observation protocol · Refreshed by: manual (append the results table per run) -->

# B1 adoption observation protocol

## What is being decided

Backlog item **B1** is: **deprecate `clad_get_context` in 0.9**, then **remove**
it only after the newer `clad_get_working_set` has demonstrably taken over. The
deprecation (mark the tool deprecated; keep it registered) is cheap and
reversible. The removal is not — it deletes a working surface some agent may
still be pulling from. So removal is gated on evidence that agents actually
*chose* the replacement.

This document is that gate. It fixes the decision rule **before** the data is
read, because a verdict without a written rule invites motivated reading: with
0 pulls on the ledger it is tempting to redefine "adoption" downward until the
number clears, or to point at the hook-fired cards ("look, the surfaces fire")
as if delivery were adoption. The rule below removes that discretion — it names
the metric, the thresholds, the window, and both branches of the fork, so the
0.9 decision reads straight off the ledger instead of off an argument.

## The metric

`clad measure --sessions` reduces the local event ledger to a three-valued
**adoption verdict**. It counts exactly one signal — a **pull**: a *resolved*
`working_set_served` event, meaning an agent called an MCP read tool
(`clad_get_working_set` / `clad_get_context` / `clad_get_impact`) and got a real
context slice back. Everything cladding **pushes** — impact cards, SessionStart
cards, UserPromptSubmit suggestions — is deliberately excluded from every
adoption count. A pushed card proves cladding *spoke*; it says nothing about
whether the agent *listened*, so a hook-fired card can never raise the adoption
number or move the verdict. The exclusion is structural, not a weighting: in
`src/events/session-report.ts` the push event types feed only a `hasSignal`
flag; their payloads are never read for any pull count. That is why the delivery
block of `clad measure` can read "100% fired" while the adoption verdict reads
`not_confirmed` — the two blocks answer different questions on purpose (did we
speak vs did they choose to ask).

## Thresholds

A `confirmed` verdict requires **all four** gates to clear. The constants live
in `src/events/session-report.ts` as `B1_ADOPTION_THRESHOLDS` (plain values, so
they are adjustable before release); they are cited verbatim here so a reader
never has to open the source to know the bar:

| Constant | Value | Gate |
|---|---|---|
| `minCompletedCycles` | `3` | Kept `clad done` flips required before adoption is even judgeable. |
| `minPulls` | `10` | Resolved pull serves across the whole ledger. |
| `minCyclePullRate` | `0.6` | Fraction of completed cycles whose window contained ≥ 1 pull. |
| `minDistinctHeads` | `3` | Distinct git HEADs across pulls + dones — one busy session can't confirm. |

A single accidental tool call, or a ledger that only ever pushed, falls short of
all four. The three verdict values are:

- **`confirmed`** — every gate cleared.
- **`not_confirmed`** — the ledger is judgeable (≥ `minCompletedCycles`) but at
  least one gate is unmet. This is a *finding*, not a data gap.
- **`insufficient_data`** — the ledger carries no signal, or fewer than
  `minCompletedCycles` completed cycles. Too thin to judge; distinct from a
  wired ledger that judged and found no pulls.

## Observation window

`minCompletedCycles: 3` above is only the floor at which the reducer will render
a verdict at all. The *decision* to cut in 0.9 needs more than a judgeable
ledger — it needs a representative one. Before the 0.9 cut, require both of:

- **≥ 10 cladding-self completed cycles**, **and**
- **≥ 5 external-project completed cycles** — from a real project *other than*
  cladding, operated by the maintainer on their own machine.

Both must be met. The external requirement exists because `.cladding/events.log`
is per-machine and gitignored (see the caveats below): the only way to observe a
non-cladding project's adoption is for the maintainer to run cladding on one and
read that project's ledger directly. cladding-self cycles alone cannot confirm —
dogfooding has its own usage shape (the loop is orchestrated through MCP
`create`/`gate`, and subagents tend to read files directly) that need not
generalize to how other teams drive the tools.

## Runner and cadence

The **maintainer** runs the measurement — **weekly** during active development,
and again at **release prep** for any release that could carry the 0.9 cut. A run
that moves a number appends a row to the results table below; runs that leave the
picture unchanged need not be recorded.

## How to run

- **Human read:** `clad measure --sessions` — renders the adoption block
  (verdict, completed cycles, pulls, cycle-pull rate, distinct heads, and the
  unmet gates) next to the delivery block.
- **For the record:** `clad measure --sessions --json` — emits the machine
  object. Its `adoption` field is the row source; copy those numbers into a new
  results-table row. The shape is:

  ```json
  "adoption": {
    "completedCycles": 64,
    "pullsTotal": 0,
    "cyclePullRate": 0,
    "distinctHeads": 55,
    "verdict": "not_confirmed",
    "reasons": ["insufficient_pulls", "low_cycle_pull_rate"]
  }
  ```

`cyclePullRate` is a fraction in `0.0`–`1.0` (the share of completed cycles that
contained at least one pull); the `minCyclePullRate` gate is `0.6`.

## Results

Append-only. One row per recorded run; never edit a prior row.

| date | repo | completedCycles | pullsTotal | cyclePullRate | distinctHeads | verdict | note |
|---|---|---|---|---|---|---|---|
| 2026-07-05 | cladding-self | 64 | 0 | 0.0 | 55 | not_confirmed | 0.8.1 development itself — orchestrated via MCP create/gate; subagents read files directly; zero working-set pulls |

## Reading the numbers honestly

- **Per-machine locality.** The ledger is `.cladding/events.log`, gitignored and
  local to one machine. Numbers reflect *this maintainer's* sessions, not the
  fleet. Two machines give two ledgers; there is no aggregate. This is why the
  window demands a maintainer-operated external repo rather than "some user's"
  telemetry — there is none to collect.
- **5 MB single-generation rotation.** The log keeps one generation up to ~5 MB;
  past that it rotates and the older history is **destroyed**, not archived. A
  long-lived repo's counts are therefore a trailing window, not lifetime totals.
  Read `completedCycles` as "recent," and prefer measuring soon after real work
  rather than reconstructing far back.
- **Silent vs unwired.** The value-delivery telemetry exists precisely so a
  *silent* surface (wired, but nothing used it) is distinguishable from an
  *unwired* one (no instrumentation). A ledger with real completed cycles and
  **zero** value events is not a missing-instrumentation gap — the same ledger
  recorded the cycles, so it *is* wired — it is the **strongest** non-adoption
  evidence available, and `clad measure` renders that adoption block rather than
  hiding it. Do not read a printed `0` as "not measured"; read it as "measured,
  and nobody pulled." (An empty ledger reads `insufficient_data` instead — that
  is the "not measured" case.)
- **Known blind spot — up, not down.** A pull is counted the moment a read tool
  resolves, whether or not the agent then *used* what it got back. The metric
  measures *choosing to pull*, not *benefiting from the pull*. So the bias runs
  one way: pulls can only over-state adoption (an agent that pulls then ignores
  still counts), never under-state it. A `confirmed` verdict is therefore a
  ceiling on real adoption, which is the safe direction for a gate whose failure
  mode is a premature removal.

## The fork

Read the verdict over the observation window and take exactly one branch:

- **If `confirmed`:** proceed with the B1 deprecation of `clad_get_context` in
  0.9.
- **If `not_confirmed`:** the next lever is **wiring / push improvement** —
  making the working set arrive without an explicit pull — **not** adding more
  capability. A capable-but-unpulled tool is a distribution problem, not a
  feature gap; building more surface area agents don't reach for makes the number
  worse, not better.
- **If `insufficient_data`:** the window is not yet met — keep observing; do not
  cut.
