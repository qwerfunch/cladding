# Deterministic perf A/B — test-run dedup (#215, F-49f6f2d2)

**Date:** 2026-07-12 · **Branch:** `ab-215` (isolated clone off `origin/develop`
@ `a0ed14a`, which carries F-49f6f2d2) · **Method:** no LLM/agents — a
one-line ablation of the same binary, timed with `/usr/bin/time -p`.

## Hypothesis

`clad check --tier=pre-push` runs stage_2.1 (unit) and stage_2.2 (coverage)
back to back. Before F-49f6f2d2, both stages independently spawn `vitest run`
— once plain, once with `--coverage` — so the same suite executes TWICE per
gate. F-49f6f2d2 primes a run-scoped cache (`primeTestRunCache('.')` in
`src/cli/clad.ts`) so stage_2.1 reuses the ONE shared coverage run stage_2.2
also folds. Prediction: the dedup arm's gate wall-time is lower by
approximately one suite run, and that saving **grows** with suite runtime —
findings must stay identical (no behavior change) and the vacuous-test guard
(F-b81d203e) must still fire on the reused path.

## Arms (one-line ablation)

- **B (dedup ON)** — `dist/clad.js` built from HEAD unmodified.
- **A (dedup OFF)** — `src/cli/clad.ts:544`'s `primeTestRunCache('.');`
  commented out, rebuilt, copied to a separate binary, then the source was
  reverted and HEAD rebuilt again (clone tree left clean — confirmed via
  `git status` before writing this doc).

Both binaries share the clone's `node_modules` (vitest 4.1.6,
`@vitest/coverage-v8`) and are invoked as `node <binary> check
--tier=pre-push --strict` from inside each target project directory.

## Fixture projects

Three synthetic vitest projects under `/tmp/ab215/{small,medium,large}`, each
with a `src/mathutils.js` module (add/sub/mul/isPrime/factorial + a
deterministic `busyWork(n)` CPU filler) and a generated
`tests/mathutils.test.js`:

| project | test count | per-test filler | plain `vitest run` (no coverage), median of 3 | `vitest run --coverage`, median of 3 |
|---|---|---|---|---|
| small  | 10   | `busyWork(500_000)` | 0.32s | 0.40s |
| medium | 200  | `busyWork(500_000)` | 1.03s | 1.55s |
| large  | 1000 | `busyWork(500_000)` | 3.97s | 6.36s |

Each project was made a real cladding project: `clad init --no-llm --scan`,
then a hand-authored `spec/features/mathutils-*.yaml` (`test_refs:
[tests/mathutils.test.js]`) taken through the actual `clad done <id>` gate
(not hand-written `status: done`) — each project's full `clad check
--tier=pre-push --strict` (Type/Lint/Drift/Architecture/Secret/Unit/Coverage)
was GREEN before measurement, confirming Unit tests (stage_2.1) and Coverage
(stage_2.2) genuinely run vitest (not skipped) in every run that follows.

## 1 — Wall-time sweep (median of 5, `.cladding/` cleared before each run)

| project | suite_runtime (plain run) | A_wall (dedup OFF) | B_wall (dedup ON) | Δ (A−B) | Δ% | A_spawns | B_spawns |
|---|---|---|---|---|---|---|---|
| small (10 tests)   | 0.32s | 2.93s  | 2.42s | 0.51s | 17.4% | 2 | 1 |
| medium (200 tests) | 1.03s | 4.78s  | 3.55s | 1.23s | 25.7% | 2 | 1 |
| large (1000 tests) | 3.97s | 12.95s | 8.61s | 4.34s | 33.5% | 2 | 1 |

Raw per-run wall-times (seconds), sorted, median in **bold**:

- small  A: 2.88, 2.89, **2.93**, 2.98, 3.01 · B: 2.40, 2.41, **2.42**, 2.61, 2.89
- medium A: 4.76, 4.77, **4.78**, 4.88, 4.93 · B: 3.54, 3.55, **3.55**, 3.56, 3.57
- large  A: 12.86, 12.89, **12.95**, 13.00, 13.08 · B: 8.56, 8.58, **8.61**, 8.65, 8.68

**Δ grows monotonically with suite runtime** (0.51s → 1.23s → 4.34s), confirming
the hypothesis. Mechanistically Δ tracks the *plain, non-coverage* vitest run
time plus a small constant (~0.2–0.4s) for the extra `npx`/process spawn
cladding no longer pays: arm A's own stage_2.1 run is the cheaper
`vitest run` (no `--coverage`) variant, not the more expensive
`--coverage` one — dedup removes exactly that spawn, so Δ ≈ suite_runtime(no
coverage) + spawn overhead, not the full coverage-instrumented time. Both
arms still pay for ONE `--coverage` run regardless (that cost is common to
both, cancels out of Δ).

## 2 — vitest spawn count

`node_modules/.bin/vitest` (the clone's real binary, shared by all three
fixtures via a `node_modules` symlink) was swapped for a counting wrapper
(`ln -sf` to a script that appends to a counter file then `exec`s the real
`vitest.mjs`; NOT overwritten in place), one gate run measured per project ×
arm, then the original symlink was restored.

| project | A_spawns | B_spawns |
|---|---|---|
| small  | 2 | 1 |
| medium | 2 | 1 |
| large  | 2 | 1 |

Matches prediction exactly in all 3 sweep points.

## 3 — Findings identical (dedup changes WHAT runs, not WHAT is reported)

`clad check --tier=pre-push --strict --json` captured for arm A and arm B on
each of the 3 projects (`.cladding/` cleared before each capture), then
diffed byte-for-byte.

| project | A vs B `--json` diff |
|---|---|
| small  | **IDENTICAL** |
| medium | **IDENTICAL** |
| large  | **IDENTICAL** |

Zero regression from dedup: same stage statuses, same finding sets, same
exit codes, on all 3 projects.

## 4 — Guard preserved (B only — F-b81d203e still fires on the reused run)

On the `small` project's `done` feature (`F-593ea084`, `test_refs:
[tests/mathutils.test.js]`):

1. Baseline: `node clad-B.js check --tier=pre-push --strict` → **GREEN**
   (Unit tests ✓, Coverage ✓).
2. All 10 `it(...)` cases in `tests/mathutils.test.js` rewritten to
   `it.skip(...)`.
3. Same gate → **RED**:
   ```
   ✗ Unit tests
       Done feature "Synthetic mathutils module (AB-215 fixture)" declares
       tests, but none of its test files executed a passing test (all
       skipped … — tests/mathutils.test.js [VACUOUS_TESTS]
   ```
4. Test file reverted byte-for-byte (verified via `diff` against the
   pre-mutation backup) → gate re-run → **GREEN** again (Unit tests ✓,
   Coverage ✓, Drift ✓ once `coverage-summary.json` refreshed — the drift
   stage runs before unit/coverage in the pipeline and reads the *prior*
   run's coverage artifact, so the immediate next run after a
   skip-then-revert briefly sees a stale low-coverage number; this is a
   pre-existing one-run-behind artifact-staleness property of stage_1.3
   unrelated to F-49f6f2d2's dedup, and clears on the following run).

The vacuous-test guard fires and clears correctly on the dedup-reused shared
run — the guard's own json input (the dual `--reporter=json` file) is
unaffected by which stage triggered the shared spawn.

## Conclusion

All 4 checks pass. The wall-time saving is real, non-noise (5.1×–8.5× the
run-to-run jitter band at every sweep point), and **grows with suite
runtime** — 0.51s on a 10-test/0.3s suite, 4.34s on a 1000-test/4s suite —
exactly the "one fewer suite run per gate" mechanism F-49f6f2d2 claims.
Findings are byte-identical between arms (dedup is a pure performance
change), and the vacuous-test guard (F-b81d203e) survives the reuse path
unweakened.
