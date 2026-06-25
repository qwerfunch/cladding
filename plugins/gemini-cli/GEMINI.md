# Cladding — Ironclad reference implementation

This extension wires Gemini CLI to **cladding**, a multi-agent dev harness implementing the Ironclad standard.

## What you get when this extension is enabled

- **`/cladding:sync`** — validate `spec.yaml` against the Ironclad schema
- **`/cladding:check`** — run all 15 Iron Law stages + the drift detector suite
- **`/cladding:panel`** — feature × stage Integrity Panel (project-wide status board)
- **`/cladding:drive`** — autonomous loop (iterate features, dispatch specialists + reviewer)
- **`/cladding:init`** — scaffold a new cladding workspace
- **`/cladding:serve`** — boot the MCP server (usually auto-launched, not invoked directly)
- **Auto-launched MCP server** (`clad serve`) — exposes spec, drift, events, persona prompts as MCP tools / resources / prompts to Gemini

## The five personas

Cladding orchestrates work across five agent personas. When using `/cladding:drive` or asking Gemini to reason about Ironclad features, lean on these roles:

- **orchestrator** — workflow conductor. Sequences agents based on the 5 invocation principles; routes user intent to specialists.
- **librarian** — knowledge keeper. Owns the spec, the audit log, and the long-running context. Answers "where is X documented?"
- **reviewer** — anti-self-cert guard. Inspects implementations; the structural barrier that refuses self-authored evidence (F-049 AC-086).
- **observability** — telemetry interpreter. Reads `.cladding/events.log.jsonl` and `.cladding/audit.log.jsonl`; surfaces drift trends.
- **specialists** — implementers. Authors code / tests / docs for whatever feature is active. Modifies the working tree.

The full prompt body for each persona is exposed as an MCP prompt — Gemini can request `prompts/get` against the cladding MCP server to load any of them.

## Authoring feature shards (read before writing one)

When you author or modify a feature shard under `spec/features/`, follow the canonical schema. Cladding's `clad sync` will reject anything that strays — schema is enforced via `additionalProperties: false`.

**Filename + id**: hash-based only. `<slug>-<hash6>.yaml`, with `id: F-<hash6>` (e.g. `checkout-flow-ee2133.yaml` → `id: F-ee2133`). Never hand-author `F-NNN` sequential ids — those are reserved for cladding's own historical features.

**Generate a hash**: `node -e "console.log(require('node:crypto').randomBytes(3).toString('hex'))"`.

**Required body shape**:

```yaml
id: F-<hash6>
slug: <kebab-slug>           # matches filename prefix
title: "<short human title>"
status: planned              # planned | in_progress | done | blocked | archived
modules:
  - <relative path to a real file>
acceptance_criteria:
  - id: AC-001
    ears: event              # event | state | unwanted | optional | ubiquitous | complex
    condition: when <trigger>          # omit for `ubiquitous`
    action: <what the system shall do> # omit for `ubiquitous`
    response: <observable outcome>     # omit for `ubiquitous`
    text: "When <trigger>, the system shall <action>, so <outcome>."
    test_refs:
      - tests/<file>.test.ts   # optional; links AC → test
```

**EARS templates** (the `text:` field follows these one-liners):

- `ubiquitous` — `The system shall <action>.`
- `event` — `When <trigger>, the system shall <action>.`
- `state` — `While <state>, the system shall <action>.`
- `unwanted` — `If <undesired>, the system shall <safe action>.`
- `optional` — `Where <feature flag>, the system shall <action>.`
- `complex` — combine multiple of the above.

**Do NOT use** `description:` for ACs — the schema rejects it. Use `text:` plus the structured `condition/action/response` triple (omit for `ubiquitous`).

After authoring, run `clad sync` to validate; the error message names the offending property if anything is wrong.

## Authentication

This extension uses your **Gemini CLI Google account login** (60 req/min · 1000/day free tier). Cladding's host adapter path requires no API key — F-049 AC-091 invariant. The `gemini` slot is reserved in `src/adapters/index.ts` `SDK_REGISTRY` but the SDK adapter body is not yet implemented; if you need direct-SDK dispatch (raised quotas, CI/CD batch), open a feature request before relying on it.

## Headless / CI usage

Gemini CLI's trust-folder gate fires before `--yolo` can auto-approve tools when the working directory is outside Gemini's trusted set (e.g. a fresh `/tmp` workspace, a CI runner clone). For headless cladding workflows, add `--skip-trust`:

```bash
gemini -p '/cladding:init "..."' --yolo --skip-trust
```

Alternatively set `GEMINI_CLI_TRUST_WORKSPACE=true` in the environment. The interactive `gemini` UI is unaffected — trust this folder once in the prompt and the flag is no longer needed.

## Where to learn more

- Project: <https://github.com/qwerfunch/cladding>
- Ironclad standard: <https://github.com/qwerfunch/ironclad>
- License: MIT
