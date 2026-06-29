# Detector regression audit (`npm run audit:detectors`)

**The thing that judges everything is itself unjudged.** cladding gates on ~38
drift detectors, but nothing measures whether those detectors stay accurate
across releases. This harness closes that meta-gap — for the detectors it
covers — by scoring them against a curated adversarial corpus.

## What it is (and is NOT)

- **IS:** a *regression guard*. For each covered detector the corpus pairs
  **drift cases** (the detector MUST fire) with **clean / near-miss cases** (it
  MUST stay silent). The scorer counts TP / FP / FN / TN and compares the
  per-detector `fp` / `fn` against a committed baseline
  (`detector-baseline.json`). A change that makes a detector noisier (`fp` up)
  or blinder (`fn` up) fails the audit and shows up in review.
- **IS NOT:** a population accuracy claim. These are **counts over a
  hand-curated corpus**, not statistical precision / recall / FPR. A detector
  reading `0 fp / 0 fn` means "no regression on the cases we wrote" — *not*
  "accurate in the wild". Do not quote these as accuracy percentages.

This is deliberately the honest, narrow framing: conformance fixtures already
assert a detector *fires* on drift; the net-new value here is asserting it stays
*silent* on adversarial near-misses (the false-positive direction), and locking
both directions against regression.

## Why two failure directions matter

- **Noise (false-positive):** a detector that fires on clean code trains users
  to ignore findings — eroding the gate's authority.
- **Blindness (false-negative):** a detector that misses real drift is
  classified security-adjacent in `SECURITY.md` (it erodes the falsifiability
  claim). This is the more dangerous direction.

## v1 scope

Pure detectors only. Shell-based detectors — `HARDCODED_SECRET`,
`ARCHITECTURE_VIOLATION`, `COVERAGE_DROP` — are **out of scope** in v1 (they
shell out to secretlint / madge / coverage tooling). Covered today:
`UNTESTED_AC`, `STATUS_DRIFT`, `AC_DRIFT`, `UNVERIFIED_AC`.

## Usage

```bash
npm run audit:detectors              # score the corpus; exit 1 on any regression
npx tsx audit/detector-audit.ts --update-baseline   # re-lock the baseline after a deliberate change
```

## Adding a case

Append to `audit/corpus.ts`: give it a stable `id`, the detector `NAME`, an
`expect` (`drift` | `clean`), a one-line `note` (say *why* — especially what
near-miss a clean case pins), and a `setup(dir)` that materializes the synthetic
project. Run `--update-baseline` and commit the baseline diff alongside.
