<!--
Thanks for opening a PR! Before you submit, please confirm the items below.
GOVERNANCE.md §4.3 is the source of truth for the PR contract.
-->

## Summary

<!-- 1-3 sentences. What does this change accomplish, and why now? -->

## Linked issue

<!-- `Closes #NNN` if this fixes an issue; otherwise delete this section. -->

## PR contract (GOVERNANCE.md §4.3)

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` — all tests pass
- [ ] `npm run stage:drift` — zero error-severity findings
- [ ] `npm run conformance` — 26/26 fixtures matched
- [ ] `node bin/clad check` — 15-stage gate green on a clean tree
- [ ] If this PR touches a shipped feature, `spec.yaml` (or the relevant `spec/features/F-NNN.yaml`) is updated
- [ ] A `CHANGELOG.md` entry is added under the next-release heading in the right section (`Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`)

## Scope of change

<!-- Tick whichever applies; this informs the SemVer bump per GOVERNANCE.md §2. -->

- [ ] **Patch** — bug fix · doc · refactor with no observable change
- [ ] **Minor** — new stage runner · new detector · new agent persona · new CLI verb · additive spec sync
- [ ] **Major** — breaking change to `StageResult` / `DriftFinding` / spec schema · public-verb removal

## Out-of-scope checklist (must all be no)

- [ ] This PR **does not** regress Iron Law conformance below the currently declared level
- [ ] This PR **does not** bypass the anti-self-cert guard
- [ ] This PR **does not** fork the Ironclad spec (an upstream change goes to https://github.com/qwerfunch/ironclad first)

## Notes for the reviewer

<!-- Optional. Anything you'd flag during review — risky line, tricky edge case, follow-up TODO. -->
