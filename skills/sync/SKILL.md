---
description: Validate the active spec.yaml against the Ironclad schema and refresh the inventory. Rarely needed manually — clad_create_feature already auto-syncs the inventory and clad check / clad done self-validate the spec, so do NOT run it as a reflexive pre-flight before those. Use it only after you have directly hand-edited a shard file (spec/features/*.yaml or spec.yaml).
---

# Cladding sync

Run `clad sync` from the project root. The command:

- Loads `spec.yaml` (or its sharded form under `spec/features/*.yaml`).
- Validates against `src/spec/schema.json` (JSONSchema).
- Reports the feature count and any validation failures.
- Exits non-zero when the spec is invalid so CI can gate on it.

Spec must be valid before `clad check`, `clad run`, or any stage runner produces meaningful output. If `sync` fails, fix the reported issues first.

```
clad sync
```

## When you actually need it (don't reflex-sync)

You rarely need to run this MANUALLY — and a reflexive "just-in-case" sync after every
operation is wasted work (in an A/B measurement, 28 of 30 manual `clad sync` calls found
nothing to fix). The inventory + validation are already maintained for you:

- **`clad_create_feature` auto-syncs the inventory** after each feature it writes (and rejects a
  malformed AC at creation), so you don't need to sync after creating features.
- **`clad check` / `clad done` validate the spec themselves** (drift stage), so you don't need
  to pre-sync before them — a real drift surfaces in that gate anyway.

Run `clad sync` only when you have **hand-edited a shard file directly** (`Edit`/`Write` on
`spec/features/*.yaml` or `spec.yaml`), to refresh the inventory and re-validate that edit.
Prefer `clad_create_feature` over hand-editing in the first place — then even this is unneeded.
