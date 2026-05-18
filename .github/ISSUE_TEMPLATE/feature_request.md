---
name: Feature request
about: Propose a new capability or enhancement
title: "[feature] "
labels: enhancement
assignees: ''
---

## What problem does this solve

<!-- The use case in one paragraph. Lead with the user pain, not the proposed mechanic. -->

## Proposed shape

<!--
If this is a new detector / stage / persona / verb, sketch it briefly.
Reference an `ironclad-design/*.md` section if your idea is rooted there.
-->

## Versioning scope (GOVERNANCE.md §2)

Pick one — this affects review priority:

- [ ] **Patch** — bug-shaped, doc, or refactor (no observable behavior change)
- [ ] **Minor** — new detector · new stage · new agent persona · new CLI verb · additive spec sync
- [ ] **Major** — breaking shape change (e.g. `StageResult`, `DriftFinding`, spec schema)

## In-scope check (GOVERNANCE.md §4.1 / §4.2)

Confirm this proposal is one of the **welcome** kinds, not an out-of-scope kind:

- [ ] Not regressing Iron Law conformance below the currently declared level
- [ ] Not bypassing the anti-self-cert guard
- [ ] Not forking the Ironclad spec (upstream changes go to https://github.com/qwerfunch/ironclad)
- [ ] Not cosmetic-only (must ship with a new test or fixture)

## Alternatives considered

<!-- Briefly: what else did you think about, and why is the proposed shape better? -->

## Willing to implement?

- [ ] Yes — I'd open a PR (read `CONTRIBUTING.md` first)
- [ ] Maintainer-led
