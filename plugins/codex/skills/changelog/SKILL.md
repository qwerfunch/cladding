---
description: Render release notes / a changelog from the cladding spec. Use when the user asks for release notes, a changelog, 릴리즈 노트, 변경 이력, or "what changed (since <ref>)" — run `clad changelog --json` for the deterministic shipped-changes manifest, then write the human-facing notes FROM it, sourcing every claim from a feature title or acceptance sentence. For audit asks, print the --audit table verbatim.
---

# Cladding changelog — release notes from the spec

The spec is the SSoT, so "what shipped?" is *collected*, never recalled. `clad changelog` turns
`<since>..HEAD` into a deterministic manifest: feature shards classified (`added-as-done` /
`flipped-to-done` / `modified-while-done` / `archived`), grouped by capability (plus an
`uncategorized` bucket — itself a drift signal), the spec inventory diff, and conventional
`feat:`/`fix:` commits that name no feature id (work that shipped *outside* the spec — report it
honestly, don't hide it).

## Protocol

1. **Collect.** Run `clad changelog --json --since <ref>` (omit `--since` to use the latest tag;
   if the repo has no tags the command says so — ask the user for a ref).
2. **Render EN + KO release notes from the manifest, in the CHANGELOG.md house style:**
   - Open with a `**In one line:**` abstract (what a user gains, one breath).
   - Group by the manifest's capability groups; use **user-impact verbs** ("the gate now runs
     your entry point"), not implementation verbs ("refactored stage runner").
   - **No `F-…`/`AC-…` ids in prose** (Soft Shell policy) — ids belong to the audit surface only.
   - **Source every claim from the manifest** — a feature `title` or an `acceptance[]` sentence.
     Never invent a change, never embellish beyond what an AC states. If the manifest is empty,
     say "no shipped changes since <ref>" — that line is the honest deliverable.
   - Put `unsharded_commits` under an "Also changed" section, marked as not yet spec-tracked.
3. **Audit asks** ("show verification", "어디까지 검증됐어?") → print
   `clad changelog --audit --since <ref>` **verbatim** — that table keeps ids and marks every
   verification ref resolved ✓ / unresolved ✗ (a ✗ is spec-annotation drift worth reporting).
4. **Catalog asks** ("what does this project do, in full?") → `clad changelog --catalog` prints
   the whole capability → feature → acceptance listing of the living spec.

```
clad changelog                       # markdown since the latest tag (deterministic fallback)
clad changelog --json --since v0.5.2 # the manifest you render notes from
clad changelog --audit --since v0.5.2
clad changelog --catalog
```
