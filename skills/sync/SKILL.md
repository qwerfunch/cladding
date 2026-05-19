---
description: Validate the active spec.yaml against the Ironclad schema and surface any structural / drift problems. Use when the user wants to know if the spec is well-formed, when the spec was just edited, or as a pre-flight check before running `check` or `drive`.
---

# Cladding sync

Run `clad sync` from the project root. The command:

- Loads `spec.yaml` (or its sharded form under `spec/features/*.yaml`).
- Validates against `src/spec/schema.json` (JSONSchema).
- Reports the feature count and any validation failures.
- Exits non-zero when the spec is invalid so CI can gate on it.

Spec must be valid before `clad check`, `clad drive`, or any stage runner produces meaningful output. If `sync` fails, fix the reported issues first.

```
clad sync
```
