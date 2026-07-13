<!-- Cladding · Tier C · reference · Refreshed by: manual (mirrors src/stages) -->

# The 15 gate stages (Iron Law)

cladding runs one check engine, bundled **by cost** so feedback is fast where it needs to be
and thorough where it must be:

- **3 stages at commit** — the cheap static checks (drift · architecture · secrets).
- **9 stages at push / completion** — the above plus type, lint, unit, coverage, spec conformance,
  and deliverable smoke. This is the tier `clad done` gates on.
- **all 15 in CI** — the full gate, including the E2E and evidence stages.

Only the depth differs; it is the same engine and the same pass/fail contract at every tier.
A GREEN strict pre-push (or CI) run writes the **attestation** — the committed verification
signature that `STALE_ATTESTATION` later compares against.

| Stage | What it checks |
|---|---|
| **1.1 Type · 1.2 Lint** | type errors · code style |
| **1.3 Drift** | spec ↔ code mismatches across 41 detectors |
| **1.4 Commit · 1.5 Arch · 1.6 Secret** | clean working tree · architecture invariants · leaked API keys |
| **2.1 Unit · 2.2 Coverage** | unit tests pass · coverage drop blocked |
| **2.3 Spec conformance · 2.4 Deliverable smoke** | the implementation-blind grader's tests pass · the declared deliverable actually runs *(blocks the empty-green "tests pass but the deliverable doesn't run")* |
| **3.1 Smoke · 3.2 Perf · 3.3 Visual** | e2e critical paths · performance budgets · UI visual regression |
| **4.1 Audit · 4.2 UAT** | every AC (acceptance criterion) has at least one piece of evidence · every done feature has at least one piece of evidence |

The full 41-detector taxonomy that Stage 1.3 runs is catalogued in
[`src/stages/detectors/README.md`](../src/stages/detectors/README.md).
