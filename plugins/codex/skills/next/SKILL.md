---
description: Drive the NEXT single feature end-to-end through the cladding cycle, in-session — spec → implement → tests → `clad done`. ONE feature per invocation; re-run to advance, or let the orchestrator loop it under /goal. Use when building features in a cladding-managed project. Writes code, tests, and the spec shard.
---

# Cladding next — one feature, end-to-end

The **in-session per-feature driver**. Unlike `clad drive` (headless, autonomous, can fall back to stubs), `next` is the host AI itself taking ONE feature through the full cycle with its own Write/Edit plus cladding's tools and gates. The loop is you re-invoking it — or the orchestrator looping it under a goal. The cadence is the execution structure, not advice.

## The one feature

1. **Pick.** Read `spec.yaml` (its `inventory` + `features`) and `spec/features/`. Choose the next feature whose `depends_on` is satisfied and whose `status` is not `done`. Prefer an existing `planned`/`in_progress` shard; otherwise take the next capability from `spec/capabilities.yaml` or the project intent. If everything ready is done, say so and stop.

2. **Spec (`librarian`).** Author/confirm THIS feature's shard **only**: real EARS `acceptance_criteria` (each with `test_refs`) + the `modules` it will create. Use the `clad_create_feature` MCP tool, or write `spec/features/<slug>-<hash6>.yaml` in the hash model (`id: F-<hash6>`, `status: in_progress`). Do **not** author shards for any other feature.
   - ▣ Run `clad sync` — the shard must be schema/EARS-valid before any code.

3. **Implement (`specialists`).** Write the production code for this feature — cohesive modules, typed errors, no unsound casts.

4. **Test (separate context).** A **different** dispatch, handed the `acceptance_criteria` **only** (never the implementation), authors the acceptance tests bound to each AC's `test_refs`. Implementer ≠ test-author — the anti-self-cert separation is structural.

5. **Done.** Run **`clad done <featureId>`**. It flips `status: done` **only if** `clad check --tier=pre-push --strict` is GREEN, reverting the shard otherwise. Do **not** hand-write `status: done`. If the gate is red, fix the named stage(s) and re-run `clad done` — `done` never claims more than the gate verifies.

6. **Stop.** One feature per invocation. Report `next: feature=<slug> gate=<GREEN|RED> status=<done|in_progress>`, then stop. Re-invoke `/cladding:next` for the following feature.

## Why one at a time

Authoring many shards ahead of the code races the spec past the implementation and breaks the spec↔code↔test lockstep cladding exists to keep — the `PLANNED_BACKLOG` detector flags a backlog of code-less features under `--strict`. Independent features (no shared `modules`, dependencies already `done`) may run as **parallel instances of this same one-feature cycle**, never as a global "spec everything first" phase. Rationale: [`docs/feature-cycle.md`](../../docs/feature-cycle.md).
