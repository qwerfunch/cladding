---
description: Run every Iron Law stage and the drift detector suite. Use when the user wants the full project health snapshot, a CI gate, or to verify nothing regressed before committing. Add --strict to promote warn-severity drift findings to errors.
---

# Cladding check

Run `clad check` from the project root. Runs the 13 Iron Law stages — Type / Lint / Drift / Commit / Arch / Secret / Unit / Coverage / Smoke / Performance / Visual / Audit / UAT — and aggregates the worst exit code.

- `0` — every stage cleared or skipped clean.
- `1` — at least one stage actually failed (fix-required).
- `2` — every result is skip (no fail-required input on the project yet).

`--strict` promotes warn-severity drift findings to error, matching the CI / pre-publish gate. The Drift stage runs every active detector under `src/stages/detectors/` (24/24 as of v0.3.40 — `npm run build:plugin` Phase D recounts and writes the integer into `.claude-plugin/plugin.json`).

`--internal` shows stage codes (`stage_1.1`) instead of business names (`Type`). Default is the business-name surface; the audit log keeps internal ids regardless.

```
clad check
clad check --strict
clad check --internal
```

## Gate economy (tiers)

Pick the cheapest tier that answers your question — the full pre-push suite is expensive and grows with
the project:

- `clad check --tier=pre-commit` — drift / arch / secret only (spec-vs-code, no full unit suite). Use for
  fast inner-loop feedback while implementing.
- `clad check --tier=pre-push --strict` — the full gate (type / lint / unit / cov + drift). This is what
  `clad done <featureId>` already runs, so do NOT run it separately right before `clad done` — one
  authoritative full gate per feature, not two. See `docs/feature-cycle.md` § Gate economy.
