# Cladding Governance

How this project is steered, how it tracks the Ironclad standard, and what external contributors can expect.

## 1. Sync Policy — Ironclad spec ↔ Cladding

Cladding is a **reference implementation** of Ironclad, not a fork. The spec is upstream, this codebase is downstream. The relationship is explicit, audited, and *deliberate* — never auto-follow.

### 1.1 Pin location

The exact spec version this codebase implements lives in `.claude-plugin/plugin.json`:

```jsonc
"ironclad": {
  "spec-version": "0.0.23",                                  // human-readable
  "spec-url":     "https://github.com/qwerfunch/ironclad",   // repo
  "spec-tag":     "v0.0.23",                                 // git tag
  "spec-commit":  "883ff01d0360b7c989fe16214c69a324f049c8cd", // immutable
  "spec-fetched": "2026-05-18"                               // when synced
}
```

`spec-commit` is the authoritative pin. The tag exists for humans; the commit hash prevents tag drift.

### 1.2 When to sync

| upstream change | Cladding response |
|---|---|
| **Patch** (`v0.0.23 → v0.0.24`) — typo, clarification | Optional. Defer until the next minor brick. |
| **Minor** (`v0.0.x → v0.1.0`) — new detector enum value, new EARS pattern, new conformance fixture | **Required** before the next Cladding minor release. |
| **Major** (`v0.x → v1.0`) — breaking shape change | **Required** before the next Cladding major release. Treat as a roadmap event. |
| Spec adds a stage / detector / level | Cladding adds a corresponding implementation brick. Conformance must re-run clean before sync closes. |
| Spec removes a stage / detector | Cladding may keep its implementation but must mark it `deprecated` in `plugin.json current.deprecated[]`. |

### 1.3 Sync procedure — 5 steps

When a sync is triggered, the project performs these steps **in order**:

1. **Update pin** — bump `plugin.json ironclad.spec-version`, `spec-tag`, `spec-commit`, `spec-fetched`. Commit alone, no code changes yet.
2. **Update CHANGELOG.md** — add a `### Changed` entry under the current release naming the spec version + the substantive deltas (which stages / detectors / patterns moved).
3. **Touch affected detectors** — for every detector whose contract changed, update its source under `stages/detectors/*.ts` and its self-dogfood expectations. Add new detectors when the catalog grows.
4. **Re-run conformance** — `npm run conformance` must report `iron_law: L4` (or the highest level Cladding declares) with `matched === total`. If a fixture diverges, treat it as a regression and fix it before the sync PR opens.
5. **Cut a Cladding release** — patch / minor / major per §2 below. The release notes' "Spec sync" section quotes the deltas from step 2.

Each step lands in its own commit so the audit trail is granular. The whole sync ships as one PR with the title `chore: sync to ironclad v<X.Y.Z>`.

## 2. Versioning Policy

Cladding follows [SemVer 2.0](https://semver.org/).

| bump | trigger |
|---|---|
| **Patch** (`0.1.x`) | bug fix · doc · spec patch sync · refactor with no observable change |
| **Minor** (`0.x.0`) | new stage runner · new detector · new agent persona · new CLI verb · breaking-but-additive spec sync |
| **Major** (`x.0.0`) | breaking change to `StageResult` / `DriftFinding` / spec schema · removal of a public verb · v1.0 graduation (see §5) |

Pre-1.0, minor versions may include backwards-incompatible internal changes. The CLI surface (`clad <verb>`) stays stable — that's the contract external adopters depend on.

## 3. Release Cadence

- **Manual.** A release ships when the maintainer (currently `qwerfunch`) judges the next milestone is real and tested.
- **No fixed schedule.** There is no monthly / quarterly cadence. Cadence emerges from external dogfood signals and spec progress.
- **Tag, then notes.** Every release creates an annotated git tag `vX.Y.Z` on `main`, then `gh release create` with `--notes-file CHANGELOG.md`. Tags are immutable; never re-point a published tag.

The maintainer initiates a release with a single instruction (e.g. *"v0.1.0 release"*). The runtime takes over from there: fast-forward `develop → main`, tag, push, publish.

## 4. Contributor Policy

### 4.1 Welcome contributions

- Bug reports with reproducible test cases.
- New conformance fixtures (especially fail-cases that catch real drift the existing suite misses).
- New language entries in `stages/toolchain/detect.ts`.
- Translations of `README.md` into additional languages.
- LLM-free detector tightening (e.g. an `AC_DRIFT` syntactic refinement that doesn't require an LLM call).

### 4.2 Out-of-scope contributions

- PRs that regress Iron Law conformance below the current declared level. `iron-law` only goes up.
- PRs that bypass the anti-self-cert guard. Tool / LLM evidence alone cannot clear stage_4 — by design.
- PRs that fork the spec rather than implement it. If you want a different spec, start a different repo.
- Cosmetic-only PRs that don't ship a new fixture or new test.

### 4.3 PR contract

Every PR must:

1. Run `npm run typecheck && npm run lint && npm test && npm run stage:drift` clean.
2. Add or update `spec.yaml` if it touches a shipped feature (`librarian` agent's territory).
3. Pass `npm run conformance` — 26/26 matched.
4. Include a CHANGELOG entry under the right section (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`).

A reviewer (the maintainer or a delegated independent agent — never the PR author) signs off before merge. This is the human-in-the-loop barrier the project lives by; PRs that try to short-circuit it get closed.

### 4.4 First PR walkthrough

If this is your first time touching cladding, the path from clone to opened PR is intentionally short. Read this section once and you should be able to land a small fix without further hand-holding:

1. **Clone and install.** `git clone https://github.com/qwerfunch/cladding && cd cladding && npm install`. Node ≥ 20.
2. **Pick a starting point.** Browse [issues tagged `good-first-issue`](https://github.com/qwerfunch/cladding/issues?q=is%3Aissue+is%3Aopen+label%3A%22good-first-issue%22) or, if you have your own idea, open an issue first to confirm the proposal fits §4.1 / §4.2 before writing code.
3. **Branch off `develop`**, not `main`. Convention: `feature/<slug>` or `fix/<slug>`. Never push to `main` — releases ship via §3.
4. **Run the four-check loop before pushing**: `npm test && npm run typecheck && npm run lint && node bin/clad check`. The first three must be clean; `clad check` must show 13/13 stages on a clean working tree.
5. **Open the PR against `develop`.** The repository's `.github/PULL_REQUEST_TEMPLATE.md` walks you through the §4.3 contract as a checkbox list. A maintainer (or a delegated independent reviewer) signs off before merge.

For style and structure, see `CONTRIBUTING.md`. For drift detector conventions specifically (especially the status-aware rule for `UNTESTED_AC` and `MISSING_TESTS`), see [`stages/detectors/README.md`](stages/detectors/README.md).

## 5. v1.0 Graduation Criteria

These are the conditions the project must meet before bumping to `v1.0.0` — not a roadmap, but a checklist the maintainer revisits when the question comes up.

1. **External dogfood corpus.** At least one external project has run cladding through a full feature lifecycle (init → work → audit → UAT) and the audit log shows multiple human evidence entries from a non-maintainer.
2. **Ironclad spec at v1.0.** Cladding doesn't graduate ahead of its upstream. When the spec hits 1.0, the sync step (§1.3) runs cleanly and the conformance suite still reports L4.
3. **Second independent reference implementation.** Another tool (different language, different vendor) declares Ironclad L4 against the same fixture corpus, *without* sharing code with Cladding. This is the falsifiability requirement — until two implementations agree on the meaning of "L4", "L4" is a one-tool statement.
4. **Falsifications registry stable.** Counter-examples from external use cluster around the same handful of fixture additions. The registry tells us where the spec's edges are; v1.0 means those edges are documented, not just patched over.

When all four hold, v1.0 ships. Until then, every release stays in `0.x` with the implicit "internal-API may shift" caveat.

## 6. Out of scope for v0.1

These intentionally don't exist yet. v0.2+ revisits.

- **Multiple maintainers.** Sole-author project; governance is "the maintainer decides".
- **Automated spec sync.** The 5-step procedure above is manual on purpose; an automated bot would defeat the deliberate-sync invariant.
- **Breaking-change deprecation policy.** Will codify (e.g. "1-minor deprecation window") once we have external adopters who'd notice.
- **SLA / response-time commitments.** No.

## 7. Where to ask

- Cladding implementation issues → `https://github.com/qwerfunch/cladding/issues`
- Ironclad spec issues → `https://github.com/qwerfunch/ironclad/issues`
- Direct contact → repo author profile

Pull requests welcome. Read this document before opening one, and reference the section that authorizes the change.
