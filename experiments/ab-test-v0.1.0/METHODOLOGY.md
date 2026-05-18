# A/B/C Comparative Test — Methodology

> Pre-release experiment for Cladding v0.1.0. Compares three Claude-Code development modes across three project scopes (3 × 3 = 9 cells).

## 1. Research question

Does Cladding (full Ironclad reference impl) produce measurably better outcomes than (a) vanilla Claude Code and (b) the legacy `harness-boot` plugin, on the same self-built project from the same spec?

"Better" is defined along six axes (§3). We hypothesise:

- **Cladding** wins on **AC completion · drift · maintainability** (because of the 19 detector closed loop).
- **Vanilla** wins on **wall-clock time** for *Simple* (no harness overhead).
- The token-usage axis is the most interesting — we don't know whether the harness overhead is paid back by tighter, sharded context.

## 2. Variables

| variable | type | values |
|---|---|---|
| Mode | independent | `vanilla` · `harness` · `cladding` |
| Scope | independent | `simple` (Todo CLI ~100 LOC) · `medium` (URL shortener ~500 LOC) · `large` (Mini blog backend ~1500 LOC) |
| Spec | controlled | identical natural-language spec per scope, given verbatim to all three modes |
| Model | controlled | Claude Opus 4.7 (1M context) — same across cells |
| Stochasticity | uncontrolled | one run per cell; report results as *trend*, not *absolute* |

## 3. Measurement axes

| # | axis | unit | source |
|---|---|---|---|
| 1 | Token usage (input + output) | tokens | vanilla = manual count from Claude transcript; harness = ceremony log under `.harness/events.log`; cladding = `clad benchmark` |
| 2 | AC completion rate | % of N ACs | manual + auto: each AC has a `test:` field; we run those tests against the artifact |
| 3 | Code quality | counts | `tsc --noEmit` exit · `eslint .` errors · LOC (`cloc`) · cyclomatic complexity (`lizard`) |
| 4 | Drift | error finding count | import the artifact into cladding's `stages/drift.ts` registry, run all 19 detectors |
| 5 | Wall-clock time | minutes | manual timestamps (start of first prompt → last commit) |
| 6 | Maintainability | 1–5 | LLM-judge (separate Claude call with the artifact + spec but *not* the mode label) on readability · modularity · comment quality |

A `measurement.json` per cell carries all six axes in one JSON document.

## 4. Time-box

| scope | hard cap |
|---|---|
| Simple | 30 min |
| Medium | 60 min |
| Large | 120 min |

If a cell hits the cap, we record *partial completion* (AC % may be < 100) and stop. The cap is the same across modes so the comparison stays meaningful.

## 5. Procedure (per cell)

1. Create the artifact dir `~/Developer/work/cladding-abc/<scope>/<mode>/`.
2. Set up the mode-specific environment:
   - `vanilla`: empty dir, `npm init -y`, the spec as a top-level prompt to Claude Code with no plugin context.
   - `harness`: `/plugin install harness-boot@harness-boot`, then `harness init`, then the spec.
   - `cladding`: `/plugin install cladding@cladding`, then `clad init`, then the spec.
3. Start the timer. Feed the spec (verbatim, from `spec/0X-<scope>.md`) once.
4. Allow the agent to work autonomously inside the time-box.
5. At hard cap (or completion), stop. Run measurement scripts on the result dir.
6. Write `experiments/ab-test-v0.1.0/results/<scope>/<mode>/measurement.json`.
7. Move artifact to `~/Developer/work/cladding-abc/<scope>/<mode>/` for safekeeping; do **not** delete (we may need to re-run axis 4 if cladding's drift rules change later).

## 6. Bias controls

| bias | mitigation |
|---|---|
| Self-measurement (cladding maintainer scores cladding) | axes 1–5 are mechanical · axis 6 uses a separate Claude call that doesn't see the mode label |
| Spec leak in vanilla mode | spec includes the same boilerplate prompt for all modes ("set up package.json + tsconfig + vitest before writing features") — no mode gets a free head-start |
| Stochasticity | single run per cell; the report calls out 9 individual data points, not a population |
| Tool maturity (harness-boot deprecated in favour of cladding) | both still install cleanly; legacy mode is allowed to use its current behaviour, not a hand-tuned variant |

## 7. Output layout — hybrid (Option C)

| where | what | git tracked? |
|---|---|---|
| `~/Developer/work/cladding-abc/<scope>/<mode>/` | raw artifact (every file the agent produced) | no |
| `~/Developer/work/cladding-abc/raw-token-logs/` | per-cell ceremony + transcript logs | no |
| `cladding/experiments/ab-test-v0.1.0/spec/` | three natural-language specs (one per scope) | yes |
| `cladding/experiments/ab-test-v0.1.0/results/<scope>/<mode>/measurement.json` | the six-axis summary, one JSON per cell | yes |
| `cladding/experiments/ab-test-v0.1.0/REPORT.md` | cross-cell synthesis · charts · narrative | yes |
| `cladding/experiments/ab-test-v0.1.0/METHODOLOGY.md` | this file | yes |

Total git footprint: ≈ 12 small JSON files + 3 spec markdowns + 2 reports = well under 100 KB.

## 8. Definition of done

The experiment closes when all nine `measurement.json` files exist and `REPORT.md` ships a comparison table for every axis × scope. The `v0.1.0` release notes then cite `REPORT.md` as the empirical evidence for Cladding's value claims.

## 9. Out of scope

- More than one run per cell (no statistical power claims).
- Languages other than TypeScript (cladding's polyglot capability is exercised but not benchmarked here).
- Live production deployment of the three artifacts.
- Cost (USD) accounting — token counts are the proxy.
