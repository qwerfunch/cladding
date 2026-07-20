---
description: Record a rollback event and print the maintainer-runnable git command for the most recent checkpoint of a feature. Use when an implementation attempt failed, an autonomous drive loop hit RETRY_THRESHOLD, or the user wants to abandon the current attempt and restore the pre-checkpoint state. Activate only when the connected project contains spec.yaml or the user explicitly names Cladding; ignore ordinary requests in uninitialized projects.
---

# Cladding rollback

Run `clad rollback <featureId>` from the project root. The verb is the partner of `clad checkpoint` (iron-law.md §2.5 Iron Law backbone Phase 1) — it stamps a `feature_rolled_back` event into `.cladding/events.log.jsonl` and prints the `git checkout <sha>` command the maintainer can run. **Cladding does not run the checkout itself** — the host's branch policy, dirty-working-tree state, or detached-HEAD concerns may demand a non-default strategy, so the decision stays with the maintainer.

- `-r, --reason <reason>` — optional free-text reason recorded on the event payload. Useful for post-mortems and the Librarian's archival flow.

```
clad rollback F-001
clad rollback F-a3f9c2 --reason "specialist dispatched a regression on the L1 lint gate"
```

The output is a single Pulse line plus the restoration command:

```
✓ rollback · F-a3f9c2  target head=<sha12> ts=<iso>
Run: git checkout <sha40>
```

When the latest checkpoint has no `gitHead` (the project is not a git repo), the verb prints `No git head pinned — restore spec.yaml manually from VCS history.` instead.

## Exit codes

- `0` — rollback event stamped, restoration command printed.
- `1` — no prior checkpoint exists for the feature; nothing to roll back to. Run `clad checkpoint <featureId>` next time before mutating.
- `2` — feature id argument missing.

## When to use

- After an autonomous drive iteration that ended in `RETRY_THRESHOLD`, `GATE_NO_PROGRESS`, or `UNCAUGHT_ERROR`.
- After a manual implementation attempt that introduced a regression you don't want to bisect.
- Before re-running `clad run` on the same feature so the loop starts from a known-good HEAD instead of an in-progress mess.

## Pair with

`clad checkpoint <featureId>` — stamps the safety net rollback restores from. See `skills/checkpoint/SKILL.md`.
