---
description: Record a feature checkpoint event pinning the current git HEAD plus a spec digest, so a later rollback can restore the exact pre-change state. Use before a non-trivial feature implementation, before a refactor that touches many files, or whenever the user wants a known-good safety net the autonomous drive loop can fall back to. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding checkpoint

Run `clad checkpoint <featureId>` from the project root. Iron Law backbone Phase 1 (iron-law.md §2.5) — the verb only **stamps** the audit-log entry; it never mutates the working tree or invokes `git commit`. The maintainer keeps the option to freeze the state with a normal git commit on top.

The checkpoint event payload carries:

- `featureId` — the spec id, accepts both `F-NNN` legacy and six-or-more-hex hash shapes; newly authored records emit `F-<hash8>`.
- `gitHead` — full 40-char commit sha at the time of the call (or `null` when the project is not a git repository).
- `specDigest` — sha-256 over the merged spec for replay verification.
- `timestamp` — ISO 8601.

```
clad checkpoint F-001
clad checkpoint F-a3f9c2e1
```

The output is a single Pulse line: `✓ checkpoint · <featureId>  head=<sha12> digest=<digest12>`. The event lands in `.cladding/events.log.jsonl` as `type: "feature_checkpoint"` and can be inspected with `clad doctor --json` or `clad_get_events` over MCP.

## When to use

- Before starting a feature with your AI host so a failed attempt has a known-good target to roll back to.
- Before a manual refactor large enough that `git stash` is unwieldy.
- Right after `clad sync` reports the spec is valid, so the checkpoint pins exactly the validated spec digest the implementation will start from.

## Pair with

`clad rollback <featureId>` — prints the maintainer-runnable `git checkout <sha>` for the latest checkpoint and stamps a `feature_rolled_back` event. The pair forms the v0.3.X Iron Law backbone for safe autonomous progress; see `skills/rollback/SKILL.md`.
