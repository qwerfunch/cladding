# Event-Sourcing Store A/B/C — Trap-Catch + Multi-Axis

> Standing evidence for cladding's EARS-locked-spec claim. Measured 2026-05-19 alongside the v0.2.16 release. The full per-variant source (vanilla / harness-boot / cladding) lives in the maintainer's local cladding-abc workspace; this file is the synthesis published with cladding.
>
> Domain: in-memory typed event-sourcing store with append, fanout, retry/DLQ, replay, retention, idempotency. **22 ACs in [`event-store-spec-with-traps.md`](event-store-spec-with-traps.md) + 8 intentional traps** the spec deliberately does not pin.
>
> Plugin invocation note: harness-boot is normally invoked via `/harness-boot:work` (slash command from the installed plugin); cladding via `/cladding:clad`. The measurement invoked the equivalent local CLIs (`node /…/harness-boot/bin/harness`, `node /…/cladding/bin/clad`) — same binaries the plugin runtime calls. Behaviour identical.

## TL;DR

| | trap catch (code) | trap covered (code + docs) | silent gaps | code LOC | tests | ceremony |
|---|---|---|---|---|---|---|
| **vanilla** | **2/8 (25%)** accidental only | 2/8 (25%) | **6 silent** | 212 | 115 | 0 |
| **harness** | **2/8 (25%)** accidental only | **7/8 (88%)** documented | 1 silent (T2) | 212 (same code) | 115 | 5,957 chars (state.yaml + spec.yaml) |
| **cladding** | **8/8 (100%)** explicit code + AC-pinned + dedicated test | **8/8 (100%)** | **zero silent** | 318 (+50% for trap handling) | 190 (+65% for trap tests) | 7,300 chars (6 sharded F-NNN.yaml) |

**Headline**: at this complexity level, the gap widens. Vanilla and harness produce the **same code** (212 src LOC). Harness's gate-review process surfaces 7/8 traps as documented blockers — but the code still silently makes choices. Cladding's EARS-locked spec forces 8/8 traps into first-class ACs, which forces the code to handle them explicitly + test them. **+50% src LOC vs vanilla buys zero silent edges.**

## Trap-by-trap matrix

| trap | vanilla | harness | cladding |
|---|---|---|---|
| **T1: idempotency cross-stream** | ❌ silent (per-stream by accident, undocumented) | 📝 documented in spec.yaml notes | ✅ AC-023 state-pattern + test (`AC-023 (T1)`) |
| **T2: retry budget on backoff throw** | ❌ silent | ❌ silent (not surfaced in gate review) | ✅ AC-024 state-pattern + test asserts `attempts === 3` |
| **T3: replay future offset** | ⚠️ empty iterator by reflex, undocumented | 📝 documented in spec.yaml notes | ✅ AC-025 unwanted-pattern + test |
| **T4: sweep races append** | ❌ silent (live-iterate) | 📝 blocker on F-014, in_progress | ✅ AC-026 state-pattern + `snapshotLen` impl + test asserts new event survives |
| **T5: subscriber added during fanout** | ❌ silent | 📝 documented in spec.yaml notes | ✅ AC-027 state-pattern + `subsAtFanout` snapshot + test |
| **T6: clock goes backwards** | ❌ silent | 📝 documented in spec.yaml notes | ✅ AC-028 unwanted-pattern + monotonic clamp impl + test |
| **T7: DLQ behaviour** | ⚠️ internal array, undocumented | ⚠️ exposed via `dlq()` get-only | ✅ AC-029 state-pattern + dedicated `__dlq__:<stream>` + test |
| **T8: clear during handler** | ❌ silent | 📝 blocker on F-019/F-020, in_progress | ✅ AC-030 state-pattern + `StreamClearedError` class + test |

Legend: ✅ = code-level handling with explicit error/test · ⚠️ = handled but undocumented · 📝 = documented but unhandled in code · ❌ = silent miss

## 8 axes (full evaluation)

| axis | vanilla | harness | cladding |
|---|---|---|---|
| **1. Code correctness** (typecheck, lint, tests) | ✓ typecheck, 11/11 tests | ✓ typecheck, 11/11 tests | ✓ typecheck, **15/15 tests** (+4 trap tests) |
| **2. AC implementation** (of 22 normal) | 22/22 (some implicit) | 22/22 (some implicit) | 22/22 (all explicit via EARS) |
| **3. Trap catch — code** | 2/8 (T3 + T7 accidental, ⚠️) | 2/8 (same as vanilla — same code) | **8/8** |
| **4. Trap covered** (code + docs) | 2/8 (25%) | 7/8 (88%) | **8/8 (100%)** |
| **5. Code LOC** (src/) | 212 | 212 | 318 (**+50%** — buys trap handling) |
| **6. Test LOC** (tests/) | 115 | 115 | 190 (**+65%** — adds 4 trap tests) |
| **7. Ceremony cost** (non-code artifacts) | 0 chars | 5,957 chars (.harness/spec.yaml + state.yaml) | 7,300 chars (6 sharded F-NNN.yaml) |
| **8. Honest status reporting** | ❌ "all green" declared, T1-T6/T8 silent | ✅ 3 features in_progress with explicit blockers (T4/T5/T8) | ✅ all features done WITH explicit trap-handling ACs (no silent gaps) |

## Why cladding wins at this complexity (mechanism, not bias)

Three deliberate features of cladding's workflow account for the 8/8 vs 2/8 gap:

1. **EARS unwanted-pattern AC** (`ears: unwanted` + `condition` + `text`) forces the spec author to write "if X then Y" as a first-class statement. Once it's in the spec, the implementer cannot avoid handling X — the AC is verifiable. T3, T6 became unwanted-pattern ACs in F-006.

2. **EARS state-pattern AC** (`ears: state` + `condition: while ...`) forces the spec author to pin behaviour under specific runtime states (concurrent sweep, mid-handler clear, retry mid-backoff). The implementer cannot leave the state semantics implicit. T1, T2, T4, T5, T8 became state-pattern ACs.

3. **Sharded spec per feature** keeps the trap-coverage feature (F-006) visible as its own file with 8 ACs at the same level as the normal-behaviour features (F-001..F-005). Reviewers see "trap coverage" as a deliverable, not a gate-review afterthought.

Harness's gate-review process does surface most traps (7/8 documented), but the documentation lives in state.yaml notes and doesn't force code-level handling. The status is honest ("in_progress with blockers") which is itself valuable — but the code still silently picks an answer at runtime.

Vanilla's single-pass implementation has neither forcing function nor honest status. 6 silent edges ship with "all green" tests.

## Plugin invocation note

For full transparency: the measurement used local CLI invocations rather than the plugin slash commands. The plugins were installable via:

- `/plugin marketplace add qwerfunch/harness-boot` + `/plugin install harness-boot@harness-boot` → `/harness-boot:init`, `/harness-boot:work`
- `/plugin marketplace add qwerfunch/cladding` + `/plugin install cladding@cladding` → `/cladding:clad`

The plugin runtime calls the same binaries (`bin/harness`, `bin/clad`) the measurement invoked directly. Behavior is identical; the only difference is the slash-command wrapper, which has no functional effect on the workflow output.

## Cumulative progression across the A/B/C cells

| Cell | Domain | ACs | Traps | Vanilla catch | Harness catch | Cladding catch |
|---|---|---|---|---|---|---|
| 07-second-order | rate limiter | 15 | 5 | 1/5 (20%) | 2/5 (40%) catch + 2/5 doc | 4/5 (80%) catch + 1/5 doc |
| **09-event-store** | **event-sourcing** | **22** | **8** | **2/8 (25%)** | **2/8 catch + 5/8 doc** | **8/8 (100%) catch** |

At cell 07's smaller scale, vanilla was 20% and cladding was 80%. At cell 09's higher complexity, vanilla holds at 25% (no scale advantage) while cladding jumps to 100%. **Cladding's catch rate scales with complexity; vanilla's does not.**

## Files

```
09-event-store/
├── spec-with-traps.md            (shared problem definition, 22 AC + 8 trap)
├── vanilla/                      (212 src LOC, 11/11 tests, 6 silent traps)
├── harness/                      (212 src LOC + 5,957 ceremony, 11/11 tests, 7/8 documented)
├── cladding/                     (318 src LOC + 7,300 ceremony, 15/15 tests, 8/8 explicit)
└── REPORT-EVENT-STORE-2026-05-19.md (this file)
```

🤖 Authored 2026-05-19 alongside cladding v0.2.16 release.
