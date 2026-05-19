# Event-Sourcing Store — Spec with Traps

A typed in-memory event-sourcing store. Streams hold ordered events; subscribers receive events as they're appended; replay is deterministic; retention sweeps old events without dropping unread ones; idempotency keys deduplicate.

The spec is **deliberately ambiguous in 8 places (T1-T8 below)** to measure whether each tool's workflow surfaces them. A *good* implementation either pins the ambiguity in its own spec/contracts or surfaces it as an explicit blocker; a *silent* implementation just makes a choice and ships.

## Modules expected

```
src/store.ts       — EventStore class (the main entry)
src/types.ts       — types + errors (StoreEvent, AppendResult, RetentionConfig, ...)
src/clock.ts       — injectable clock helper (for tests)
tests/store.test.ts — happy path + edge cases
```

Target: ~400-600 LOC src, ~200 LOC tests.

## Acceptance criteria (22)

| id | sentence |
|---|---|
| AC-01 | `new EventStore({retention})` constructs an empty store. |
| AC-02 | `append(stream, event)` returns `{id, offset, occurredAt}` — `id` is a stable string, `offset` is per-stream, `occurredAt` is ISO. |
| AC-03 | Within one stream, `append` assigns monotonically increasing offsets starting from 0. |
| AC-04 | Two `append` calls with the same `idempotencyKey` (same stream) return identical `{id, offset, occurredAt}` and do NOT store a duplicate. |
| AC-05 | `subscribe(stream, handler)` invokes `handler(event)` for every appended event in order. |
| AC-06 | A subscriber added after appends receives all past events of that stream on first poll. |
| AC-07 | `subscribe` returns an `Unsubscribe` function; after calling it the handler is no longer invoked. |
| AC-08 | A handler that throws is retried with backoff up to N times before being moved to a dead-letter sink. |
| AC-09 | `replay(stream, fromOffset)` returns an async iterator yielding every event from `fromOffset` to current head, in order. |
| AC-10 | `replay` is repeatable: calling `replay(stream, fromOffset)` twice with the same args returns the same sequence. |
| AC-11 | When `retention.maxAgeMs` is set, `sweep()` removes events whose `occurredAt` is older than `now - maxAgeMs`. |
| AC-12 | When `retention.maxCount` is set, `sweep()` retains only the most recent N events per stream. |
| AC-13 | `sweep()` does NOT remove events still ahead of any active subscriber's last-acked cursor. |
| AC-14 | Concurrent `append` calls (different `await` chains hitting the same stream) produce distinct offsets — no collision. |
| AC-15 | `head(stream)` returns the next offset that would be assigned (0 for an empty/unknown stream). |
| AC-16 | An `append` to an unknown stream auto-creates the stream. |
| AC-17 | `subscribers(stream)` returns the active subscriber count (0 when unknown). |
| AC-18 | `streams()` returns the list of all known stream names. |
| AC-19 | `clear(stream)` removes the stream and rejects any pending replay iterators on it. |
| AC-20 | `clearAll()` empties the store; all subscribers + iterators reject. |
| AC-21 | A subscriber's handler must return (or a returned Promise must resolve) before the cursor advances to the next event. |
| AC-22 | The clock is injectable via constructor option `clock: () => number` (defaults to `Date.now`). |

## Intentional traps (NOT pinned as explicit ACs)

These spec ambiguities are the second-order measurement. None of them appear in AC-01..AC-22 above; the question is whether each tool's workflow surfaces them.

| trap | description |
|---|---|
| **T1** | `idempotencyKey` is reused across two different streams — does the second call to a different stream share the result (global keyspace) or each stream has its own keyspace? |
| **T2** | A handler throws during retry backoff (i.e. the retry attempt itself fails) — is the original retry budget reset or preserved? |
| **T3** | `replay(stream, fromOffset)` where `fromOffset` is beyond `head(stream)` — error, empty iterator, or block-until-available? |
| **T4** | `sweep()` is called concurrently with `append()` — does sweep operate on a snapshot or live-iterate (risking the new event being swept by accident)? |
| **T5** | A subscriber is added DURING fanout of event E — does the new subscriber see E, or only events after E? |
| **T6** | The clock returns a smaller value on a subsequent call (NTP skew or `Date.now` going backwards) — does `occurredAt` clamp to monotonic or accept the time-travel? |
| **T7** | DLQ behavior on retry exhaustion — silent drop, throw to the caller, dedicated dead-letter stream, or external sink? |
| **T8** | `clear(stream)` is called while a subscriber's handler is mid-execution for that stream — abort handler, finish then reject, or reject silently? |

## Run rules

Each variant works from this same spec-with-traps.md. The goal is a working implementation; the measurement is **what each tool's workflow does with the 8 ambiguities**.

- vanilla: single-pass implementation; no scaffolding
- harness-boot: `.harness/spec.yaml` with 22 ACs as features; run work cycle per feature; gate review may surface trap notes in state.yaml
- cladding: `clad init` + EARS-locked sharded spec; traps that need explicit handling become first-class ACs (`ears: unwanted` or `ears: state`); `clad sync` + `clad check --strict` audit
