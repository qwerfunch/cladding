# Headroom × Cladding Harness — Integration Design

> **Feature:** `F-6aebb9` (`spec/features/headroom-compression-seam-6aebb9.yaml`)
> **Status:** dark-launch implementation (off by default)
> **Engine:** [chopratejas/headroom](https://github.com/chopratejas/headroom) — Python library over a Rust core
> **Host:** Cladding TS harness (Node ≥18, ESM)

This document records *why* and *how* Headroom is embedded into the cladding
harness. It is the design SSoT (Tier B); the normative contract lives in the
feature shard above. Code must trace back to that shard's acceptance criteria.

---

## 1. The decision that shapes everything

Headroom ships four callable surfaces:

| Surface | In-process? | Server needed? | Language |
|---|---|---|---|
| Python library (`from headroom import compress`) | ✅ yes (Rust core) | ❌ none | Python |
| TypeScript SDK (`headroom-ai`) | ❌ no — HTTP client | ✅ **proxy or Cloud** | TS |
| Proxy (`headroom proxy`) | n/a | ✅ long-running daemon | Rust |
| MCP server | n/a | ✅ server | Python |

Cladding's harness is **TypeScript**. The obvious choice — the TS SDK — is a
thin HTTP client whose `compress()` *"requires a running Headroom proxy or a
Cloud API key."* That contradicts the project goal: **embed compression
in-process, do not stand up a server.**

The only surface that compresses **with no server** is the **Python library**.
So the serverless way to use Headroom from a TS harness is a **one-shot Python
subprocess bridge**: spawn `python3 scripts/headroom_bridge.py`, pipe the
messages in as JSON, read the compressed messages back out, let the process
exit. No daemon, no port, no Cloud round-trip.

### Architecture options compared

| Option | Server? | Latency/call | Verdict |
|---|---|---|---|
| **A. One-shot Python subprocess → `headroom.compress()`** | ❌ none | ~80–300 ms cold | ✅ **Chosen default** — true in-process Rust pipeline, local-first |
| B. Managed local proxy child + TS SDK | ⚠️ managed child | ~5–20 ms | Documented escape hatch for high call-volume loops (`transport: proxy`) |
| C. TS SDK → Headroom Cloud | ❌ remote | network | ❌ Rejected — sends harness context off-box; breaks local-first |
| D. Reimplement algorithms in TS | ❌ | — | ❌ Rejected — 6 Rust algorithms, unmaintainable drift |

Both A and B sit behind one cladding interface (`compressContext`) so the drive
loop never knows which transport is live — the same pattern as cladding's
existing `host` vs `sdk` adapter split. The dark launch ships **Option A only**;
Option B is a future `transport: proxy` slot.

---

## 2. Where compression attaches

Cladding has two dispatch modes (`src/adapters/`):

- **`host`** (default — `claude-code`, `generic-mcp`): the *host* owns the LLM
  wire and the user's subscription. Cladding does **not** make the API call, so
  there is no outbound payload to intercept. Headroom can only compress the
  **text cladding assembles** (`featureShard` JSON + `guardrails[]`) before it
  is handed to the host. Partial reach, but that assembled context is what
  grows.
- **`sdk`** (`claude-anthropic`, `src/adapters/sdk/anthropic.ts`): cladding owns
  `client.messages.create()`. **Full message-array compression** is possible.

The integration is therefore a **middleware in the adapter layer**, not a proxy
in front of it. The dark launch wires the seam into the `sdk` adapter (the path
cladding fully controls); the `host` path is a documented follow-up.

### Component & data flow

```
drive/loop.ts → drive/agent.ts → selectAdapter()
                                      │
                ┌─────────────────────┴───────────┐
             host adapter                      sdk adapter
        (claude-code / mcp)              (anthropic.ts)
                │                               │
                ▼                               ▼
        ┌──────────────────────────────────────────────┐
        │  optimizer/headroom.ts   (the seam)            │
        │  compressContext(messages, kind, model)        │
        │  · enabled gate · min-token gate · circuit     │
        │  · subprocess transport · fallback passthrough │
        └───────────────────────┬──────────────────────┘
                                 ▼
                  scripts/headroom_bridge.py   (one-shot, stdin→stdout)
                                 ▼
                  Rust _core pipeline (SmartCrusher · Kompress ·
                  CacheAligner · RollingWindow · Relevance · CCR)
                                 ▼
              compressed messages → host / Anthropic API → LLM
```

### Sequence (SDK mode)

```
loop → agent → AnthropicTransport.invoke(persona, ctx)
  1. build messages[] = [{system: persona.body}, {user: featureShard+guardrails}]
  2. compressContext(messages, kind, model)
       2a. disabled?       → passthrough (applied=false)
       2b. below min_tokens? → passthrough
       2c. circuit open?     → passthrough
       2d. spawn bridge (timeout 5s)
            success → compressed messages (+ tokensSaved, ccrHashes)
            error/timeout/parse → passthrough (fallbackReason set)
  3. emit `compression` event → .cladding/events.log.jsonl
  4. messages.create(returned messages)   # compressed OR original
```

**Invariant:** `compressContext` never throws and is pure pass-through on any
failure. The harness must run identically with Headroom absent — compression is
strictly an optional optimization, never a correctness dependency.

---

## 3. Per-data-type optimization strategy

Cladding's payload mixes three pressure sources. Each maps to Headroom
algorithms via a profile (`src/optimizer/profiles.ts`):

| Context kind | Dominant algorithm(s) | Posture | Why |
|---|---|---|---|
| **logs** (agent execution logs) | Kompress + RollingWindow | `target_ratio≈0.25`, `protect_recent=2` | Repetitive, low-density; keep the tail + salient lines. |
| **json** (tool outputs / API responses) | SmartCrusher + ToolCrusher | dedup, `min_tokens_to_compress=250` | Array dedup + change-point preservation collapses near-identical items. |
| **code** (source context) | RelevanceScorer + `protect_analysis_context` | conservative `0.6`, `compress_user_messages=false` | High-density; protect on analyze/review intent. |
| **spec** (feature shards + guardrails) | CacheAligner | `compress_system_messages=false`, `0.7` | Keep prefix byte-stable → maximize prompt-cache hits. |
| **history** (multi-turn) | IntelligentContext | `keepLastTurns≈4`, `0.4` | Drop stale turns, keep error-bearing / referenced ones. |

**Reversibility:** SmartCrusher/CCR emit `ccr_hashes` for crushed blocks. These
are surfaced in the `CompressResult` so a future confused-turn recovery can
re-expand a specific block instead of redoing the whole call.

---

## 4. Configuration

### Environment variables

```bash
CLADDING_HEADROOM=on|off|simulate        # master switch (default: off)
CLADDING_HEADROOM_TRANSPORT=subprocess   # subprocess (default) | proxy (future)
CLADDING_HEADROOM_PYTHON=python3         # interpreter for the bridge
CLADDING_HEADROOM_BRIDGE=scripts/headroom_bridge.py
CLADDING_HEADROOM_TIMEOUT_MS=5000        # per-call hard cap → fallback on breach
CLADDING_HEADROOM_MIN_TOKENS=1500        # skip compression below this
CLADDING_HEADROOM_MAX_FAILS=3            # circuit-breaker trip count
```

### `.cladding/config.yaml` (future, declarative mirror of the env vars)

```yaml
headroom:
  enabled: false
  transport: subprocess
  timeout_ms: 5000
  min_tokens: 1500
  max_consecutive_failures: 3
  default_profile: spec
```

The dark launch reads **env vars only**; the config-file binding is a follow-up
so the surface stays small until the seam has proven itself.

---

## 5. Exception handling & fallback (defense-in-depth)

Five layers, none of which can break the harness:

1. **Structural protection (lossless).** `protect_recent`,
   `protect_analysis_context`, `min_tokens_to_compress`,
   `compress_system_messages=false` ensure the active turn, code-under-review,
   and persona prompt are never touched.
2. **Simulate-guard.** `CLADDING_HEADROOM=simulate` predicts savings with zero
   lossy risk (no compressed payload is ever sent). Used during rollout.
3. **Transport fault → passthrough.** Timeout / non-zero exit / malformed JSON /
   missing python ⇒ the seam returns the **original** messages
   (`applied=false`, `fallbackReason` set). The LLM call proceeds uncompressed —
   degraded cost, never broken correctness. (AC `b9218d`.)
4. **Circuit breaker.** After `max_consecutive_failures` (default 3) the seam
   disables compression for the rest of the session (`circuit_open`) so a broken
   python env cannot impose an N× timeout tax. (AC `8bd17a`.)
5. **Post-hoc confusion recovery (future).** Inspect the LLM reply for confusion
   signals; on trip, re-dispatch the same turn with `CLADDING_HEADROOM=off`, or
   re-expand only the referenced crushed block via `ccr_hashes`. Not in the dark
   launch — documented for the follow-up.

Every attempt (applied, skipped, fallback) is appended to
`.cladding/events.log.jsonl` as a `compression` event so the `observability`
persona and `clad doctor` can report realized savings and fallback rate.

---

## 6. Rollout & verification

1. **Install engine:** `pip install headroom-ai` on the harness host. The bridge
   fails-loud → passthrough if absent, so this is non-blocking.
2. **Land dark:** ship with `CLADDING_HEADROOM` unset. The seam is inert.
3. **Simulate:** set `CLADDING_HEADROOM=simulate` → events log predicted savings
   with zero lossy risk.
4. **Measure:** `clad doctor` / the `observability` persona read the new
   `compression` events → realized `tokensSaved`, fallback rate, p95 bridge
   latency.
5. **Promote:** flip `CLADDING_HEADROOM=on` per-profile once fallback rate is low
   and savings justify the subprocess cost.

---

## 7. Known caveats (honest)

- **Subprocess cold-start (~80–300 ms/call)** is the price of "no server." For a
  chatty drive loop, Option B (managed local proxy child, ~5–20 ms) is the
  escape hatch — same `compressContext` seam, `transport: proxy`.
- **Host mode has limited reach** — when Claude Code owns the wire, Headroom only
  compresses the assembled `featureShard`+`guardrails` text, not the host's full
  window. The dark launch wires only the `sdk` adapter.
- The `host` integration, the `proxy` transport, the `.cladding/config.yaml`
  binding, and post-hoc confusion recovery are deliberately **out of scope** for
  the dark launch and tracked as follow-ups.
