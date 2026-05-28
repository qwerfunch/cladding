# Gemini CLI → Antigravity migration

Tier: B · Source: hand-authored guide · Audience: cladding users on Gemini CLI

Google announced Gemini CLI sub-agent **sunset on 2026-06-18**, replaced by Antigravity. cladding wires both — Tier 2 (Gemini) stays through 0.5.x; Tier 1 (Antigravity) is the recommended target. This guide covers what changes for a project that was running cladding on Gemini CLI.

---

## TL;DR

You can keep running cladding on Gemini CLI through the sunset window — nothing breaks at the cladding layer. After 2026-06-18, Gemini CLI itself will stop accepting sub-agent dispatches; cladding's `dispatchHint` for Gemini will still emit (with `advisory: true`) but the host will ignore it. Switch to Antigravity before then. The cladding-side migration is **two environment changes and one config move** — no code edits, no spec rewrites.

---

## Side-by-side

| Concern | Gemini CLI (Tier 2) | Antigravity (Tier 1) |
|---|---|---|
| Sub-agent file path | `~/.gemini/agents/<id>.md` | dynamic (host-spawned) |
| Manifest format | `.md` frontmatter (snake_case) | host-managed JSON |
| Dispatch tool | `@agent-<name>` (explicit @-mention) | `spawn_subagent` (auto-dispatch) |
| dispatchMode | `'sub-agent'` advisory | `'sub-agent'` direct |
| Env signal cladding detects | `GEMINI_HOME` / `GEMINI_CLI` | `ANTIGRAVITY_HOME` / `ANTIGRAVITY_SESSION` |
| Tool allowlist field | `allowed_tools` (snake_case) | `tools` (PascalCase, Claude-style) |
| Concurrent dispatch | multiple `@agent` calls | spawn_subagent batches |
| Sunset date | **2026-06-18** | n/a (active development) |

---

## Step-by-step

### 1. Verify Antigravity install

Antigravity ships separately from Gemini CLI. Confirm it is on PATH and the env signals cladding watches for are set:

```bash
antigravity --version
echo $ANTIGRAVITY_HOME
```

If `ANTIGRAVITY_HOME` is unset, cladding's `detectHost` will return `gemini` (if Gemini env vars are also present) or `generic`. Either way, the dispatch hint shape is wrong for Antigravity.

### 2. Migrate sub-agent manifests

The canonical persona files (`src/agents/*.md` in cladding's repo) don't change. What changes is the **transpile target**: PR-A.3's `scripts/build-plugin.mjs` Phase E emits to `plugins/gemini-cli/agents/`. Antigravity uses dynamic spawn — there is no static manifest to emit. cladding's per-host transpiler treats Antigravity as a Tier 1 host with `tools[]` allowlist (Claude-style); the spawn payload is constructed at dispatch time, not from a file.

Practically: if you were `cp`-ing cladding's `plugins/gemini-cli/agents/*.md` into `~/.gemini/agents/`, **stop** after migrating. Antigravity reads cladding's persona definitions on-demand via the `cladding` MCP server, not from disk.

### 3. Remove Gemini env vars (optional)

Once you confirm Antigravity is the active host (cladding's `detect_host` MCP tool returns `host: 'antigravity'`), you can unset the Gemini env vars so cladding's detection priority isn't ambiguous:

```bash
unset GEMINI_HOME GEMINI_CLI
```

Or set `CLADDING_HOST=antigravity` to bypass auto-detection entirely.

### 4. Verify the switch

Run `clad serve` and from your Antigravity session call:

```
mcp:cladding:detect_host
```

Expected output:

```json
{
  "host": "antigravity",
  "tier": 1,
  "signals": ["ANTIGRAVITY_HOME"],
  "overridden": false
}
```

If `host` is `gemini` or `generic`, return to step 1.

---

## Behavioural differences during the transition

While running on Gemini CLI (`Tier 2`):

- `EnterWorkResult.subAgentDispatchHint.advisory === true` — the host AI must explicitly invoke `@agent-<persona>`, not auto-dispatch.
- `capabilityEnvelope.allowedTools` uses Gemini snake_case (`ReadFile`, `WriteFile`, `EditFile`, `Shell`, `SubAgent`).
- Concurrent groups from `executeDrive().groups` require the host AI to issue N `@agent` calls in one response — Gemini CLI does NOT batch.

After switching to Antigravity (`Tier 1`):

- `subAgentDispatchHint.advisory` is absent (auto-dispatch supported).
- `capabilityEnvelope.tools` uses Claude-style PascalCase (`Read`, `Glob`, `Grep`, `Write`, `Edit`, `Bash`, `Task`).
- Concurrent groups dispatch via `spawn_subagent` batches.

---

## Cladding-side deprecation timeline

| Version | Gemini CLI status | Notes |
|---|---|---|
| 0.5.0 (this release) | Tier 2, fully supported | Sub-agent wire active. Migration window opens. |
| 0.5.x | Tier 2, full support continues | Antigravity documented as recommended Tier 1. |
| **2026-06-18** | (Gemini CLI sunset) | Host stops accepting `@agent` dispatches. cladding still emits the advisory hint; host ignores it. |
| 0.6.0 | Deprecated — `dispatchHint` for Gemini emits `dispatch_drift_legacy` event | `dispatch_drift` auditor reports a high-priority warning when host=gemini. |
| 0.7.0 | Removed | `detectHost` no longer recognises Gemini signals; falls through to generic. |

If you cannot switch to Antigravity by `2026-06-18`, set `CLADDING_HOST=generic` to opt out of the Tier 2 path entirely — your project will run in host-self-inject mode with no dispatch_drift warnings.

---

## Reporting issues

Migration bugs go to https://github.com/qwerfunch/cladding/issues with the label `migration:gemini-to-antigravity`. Include the output of `clad serve` + `mcp:cladding:detect_host` and the active host's version.
