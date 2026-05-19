# Changelog

All notable changes to Cladding are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

## [0.3.6] — Unreleased — SKILL.md → TOML build-time transpile for Gemini (F-081)

**Post-rollout audit, cycle 3 of 3 (final).** v0.3.3 shipped Gemini CLI commands as six hand-authored TOML files; the canonical sources (`skills/<verb>/SKILL.md`) and the TOML mirrors could drift if a verb description got updated in one place but not the other. This patch makes the SKILL.md the single source of truth and the TOMLs build-generated.

### Added

- `scripts/build-plugin.mjs` — new Phase C transpiles each `skills/<verb>/SKILL.md` into `plugins/gemini-cli/commands/<verb>.toml`:
  - YAML frontmatter `description` → TOML `description = "..."` (basic string with `\\` + `\"` escapes; apostrophes pass through).
  - SKILL.md body → TOML `prompt = '''...'''` (literal multi-line — backticks, backslashes, and other markdown punctuation pass through unaltered).
  - Fallback: if the body literally contains `'''`, switch to `prompt = """..."""` with backslash + double-quote escapes (none of cladding's current bodies trigger this, but the fallback exists for future authoring).
- `plugins/gemini-cli/commands/README.md` — AUTO-GENERATED sentinel pointing at `skills/<verb>/SKILL.md` as the canonical source. Rewritten on every build.
- `spec/features/F-081.yaml` — "SKILL.md → TOML build-time transpile" (5 ACs, status `done`).

### Changed

- `plugins/gemini-cli/commands/{sync,check,panel,drive,init,serve}.toml` — now regenerated from the canonical SKILL.md sources rather than hand-authored. The visible content is essentially the same (description and body wording lift verbatim from SKILL.md); the difference is who owns the file.
- Build pipeline: `npm run build:plugin` now runs all three transpile phases (Claude Code mirror → Codex mirror → Gemini transpile) in one pass. Same canonical sources feed all three host plugin layouts.

### Notes

- 520/520 vitest pass (no test changes in this release); lint clean; typecheck clean; drift-green at 80 features; bundle 1.1 MB.
- **v0.3.x cleanup is now complete.** v0.3.4 closed the docs/help-text inaccuracies, v0.3.5 added the version-drift detector, v0.3.6 closes the SKILL.md ↔ TOML drift surface. The universal generator (v0.4.0, predicate-gated) is no longer urgent — three hand-crafted manifests are stable and the only previous drift surface (Gemini TOML) is now SSoT-driven.
- v0.4.0 predicate (from plan): one of (a) new host plugin spec added → 4 host scenario justifies generalization, or (b) actual drift incident in the 3 current manifests → re-prioritize.

## [0.3.5] — Unreleased — HARNESS_INTEGRITY · multi-host manifest schema + version drift (F-080)

**Post-rollout audit, cycle 2 of 3.** The original `HARNESS_INTEGRITY` detector (v0.2.4) guarded one invariant — that `.claude-plugin/plugin.json` `current.detectors` numerator matched the file count under `src/stages/detectors/`. The multi-host rollout (v0.3.1 → v0.3.3) added two more manifests; this patch extends the detector so all three manifests stay in lockstep.

### Added

- `src/stages/detectors/harness-integrity.ts` — two new check layers on top of the original detector-count check:
  - **Per-host manifest schema**: validates `.claude-plugin/plugin.json` (requires `name` + `version`), `plugins/codex/.codex-plugin/plugin.json` (requires `name` + `version` + `description`), and `plugins/gemini-cli/gemini-extension.json` (requires `name` + `version`). Missing required fields → per-host `error` finding. Malformed JSON → `warn`.
  - **Cross-manifest version drift**: reads `package.json` `version` as baseline and compares to each host manifest. Any mismatch → per-host `error` finding naming the offending version and the baseline. Skipped silently when `package.json` is absent (detector stays a soft validator on non-cladding directories).
- `tests/stages/harness-integrity.test.ts` — 11 new tests across two new describe blocks (per-host schema · cross-manifest version drift). Covers: missing required fields per host, JSON parse failure, host manifest absent, version drift in each host, simultaneous drift in two hosts, version check skipped when `package.json` missing.
- `spec/features/F-080.yaml` — "HARNESS_INTEGRITY · multi-host manifest schema + version drift" (5 ACs, status `done`).

### Notes

- 509 + 11 new tests = **520/520** passing; lint clean; typecheck clean; drift-green at 79 features; bundle 1.1 MB.
- The original detector-count invariant (v0.2.4) is intact — same severity ladder, same trigger conditions. The two new layers are additive: when `package.json` and the three host manifests are absent (e.g. a fresh repo or a non-cladding directory), the detector silently passes.
- This closes the most impactful audit gap: a future release can't ship with `package.json` bumped but a host manifest forgotten — the drift detector now fails fast with `clad check --strict`.
- v0.3.6 plan: SKILL.md → TOML build-time transpile for Gemini (F-081). After that, v0.3.x cleanup is done.

## [0.3.4] — Unreleased — CLI text + docs cleanup (F-079)

**Post-rollout audit, cycle 1 of 3.** v0.3.3 finished the three-host plugin rollout; an audit caught three documentation/help-text issues that pre-dated v0.3.0 or were inaccurate at v0.3.3 ship time. This patch fixes them without touching code logic.

### Changed

- `src/cli/clad.ts` — `clad drive` description rewritten. The old line claimed "LLM dispatch arrives with F-049 in v0.2"; F-049 has been done since v0.3.0 and the loop has dispatched through MCP sampling or AnthropicTransport ever since. New description names the real behaviour: specialist + reviewer persona dispatch, L1 gates, anti-self-cert barrier, evidence recording.
- `src/cli/clad.ts` — `clad serve` JSDoc + subcommand description: removed the version-stamped `(v0.2.24)` annotation so `--help` output stays evergreen. CHANGELOG.md remains the SSoT for which release introduced which verb.
- `plugins/gemini-cli/GEMINI.md` — "API key fallback is supported" corrected. The `gemini` slot in `SDK_REGISTRY` is reserved but the SDK body is not yet implemented in v0.3.x; the doc now states this explicitly rather than promising a fallback that doesn't exist.
- `CHANGELOG.md` — v0.3.3 entry's authentication note updated for the same reason.

### Added

- `spec/features/F-079.yaml` — "CLI text + docs cleanup" (4 ACs, status `done`).

### Notes

- 509/509 vitest pass; lint clean; typecheck clean; drift-green at 78 features.
- Historical version references in source comments (e.g. "v0.2.19 ships the mock body via MockTransport") are intentionally kept — they document a factual sequence of events. Only user-facing surfaces (CLI help, plugin manifest docs) were evergreen-edited.
- v0.3.5 plan: extend `HARNESS_INTEGRITY` detector to cover all three host manifests + cross-manifest version consistency.

## [0.3.3] — Unreleased — Gemini CLI extension (F-078)

**Phase 3 of the multi-host plugin rollout.** Adds the Gemini CLI extension under `plugins/gemini-cli/`. Cladding is now installable as a first-class plugin/extension on all three major agentic CLIs: Claude Code (v0.3.1), Codex (v0.3.2), Gemini CLI (this release).

### Added

- `plugins/gemini-cli/gemini-extension.json` — Gemini extension manifest with `name`, `version`, `description`, `contextFileName=GEMINI.md`, and an `mcpServers` map that registers `clad serve` as a stdio MCP server. Loaded automatically when the extension is installed.
- `plugins/gemini-cli/commands/{sync,check,panel,drive,init,serve}.toml` — six verbs as Gemini CLI custom commands in TOML format. Each TOML has `description` (shown in `/help`) and `prompt` (sent to the model when the user invokes `/cladding:<verb>`).
- `plugins/gemini-cli/GEMINI.md` — context file loaded into Gemini's session from start. Lists the six commands, summarises the five personas (orchestrator · librarian · reviewer · observability · specialists), and states the no-API-key invariant explicitly.
- `spec/features/F-078.yaml` — "Gemini CLI extension manifest" (4 ACs, status `done`).

### Notes

- 509/509 vitest pass; lint clean; typecheck clean; drift-green; bundle rebuilds at 1.1 MB.
- Gemini CLI's TOML command format differs from Claude Code / Codex (both use Markdown with YAML frontmatter). v0.3.3 keeps the TOML files hand-authored alongside the canonical Markdown sources; the v0.4.0 generator (Phase 4) will transpile from a single universal source into each host's native format.
- **Authentication**: extension uses Gemini CLI's Google account login (60 req/min · 1000/day free tier). The `gemini` SDK adapter slot is reserved in `src/adapters/index.ts` `SDK_REGISTRY` but the SDK body is not yet implemented in v0.3.3 — direct-SDK dispatch is not a shipped fallback. The no-API-key invariant (F-049 AC-091) is intact across all three host plugins.
- v0.4.0 plan: `clad plugin build` universal generator (minor bump) — collapse the three hand-crafted manifests into a single source-of-truth that transpiles per host.

## [0.3.2] — Unreleased — Codex plugin manifest (F-077)

**Phase 2 of the multi-host plugin rollout.** v0.3.1 promoted cladding to a real Claude Code plugin; this patch adds the OpenAI Codex CLI / IDE plugin manifest under `plugins/codex/`. Same single-source canonical files (`src/agents/` + `skills/`) feed both manifests, so a verb or persona authored once shows up in both host plugin catalogs.

### Added

- `plugins/codex/.codex-plugin/plugin.json` — Codex plugin manifest. Declares `name`, `version`, `description`, `author`, `license`, `skills`, `mcpServers`, plus an `interface` block (`displayName`, `category`, `capabilities`) per the OpenAI Codex plugin spec.
- `plugins/codex/.mcp.json` — registers `clad serve` as a stdio MCP server so Codex auto-launches it whenever the plugin is enabled.
- `plugins/codex/skills/{sync,check,panel,drive,init,serve,orchestrator,librarian,reviewer,observability,specialists}/SKILL.md` — 11 skills (6 verbs + 5 personas) generated by `scripts/build-plugin.mjs` from the canonical sources.
- `spec/features/F-077.yaml` — "Codex plugin manifest" (5 ACs, status `done`).

### Changed

- `scripts/build-plugin.mjs` — now generates two host plugin layouts in one pass:
  - **Claude Code** mirror (Phase A, F-076) at the repo root — unchanged behaviour
  - **Codex** mirror (Phase B, F-077) at `plugins/codex/skills/` — copies repo-root `skills/<verb>/SKILL.md` verbatim and re-emits `src/agents/<persona>.md` as `<persona>/SKILL.md`. Warns when a persona file lacks the `description` YAML frontmatter field (Codex requires it) but continues the build.

### Notes

- 509/509 vitest pass; lint clean; typecheck clean; drift-green; bundle rebuilds at 1.1 MB.
- The build is now multi-host-aware in one command: `npm run build:plugin` regenerates both Claude Code's `agents/` mirror and Codex's `plugins/codex/skills/` mirror from the same single source.
- v0.3.3 plan: Phase 3 — Gemini CLI extension (`plugins/gemini-cli/`).

## [0.3.1] — Unreleased — Claude Code plugin formalization (F-076)

**Phase 1 of the multi-host plugin rollout.** cladding has been on the Anthropic Claude Code plugin marketplace as a *declaration-only* surface — `.claude-plugin/plugin.json` carried metadata but the plugin manifest's `skills/`, `agents/`, and `.mcp.json` were missing. This patch promotes cladding to a *real* Claude Code plugin: install it, and you get six namespaced skills (`/cladding:sync`, `/cladding:check`, `/cladding:panel`, `/cladding:drive`, `/cladding:init`, `/cladding:serve`), the five persona agents, and an auto-launched MCP server — no manual configuration.

### Added

- `.mcp.json` at the plugin root — registers cladding's MCP server (`clad serve`) so Claude Code auto-launches it whenever the plugin is enabled. This is what closes the loop: host adapters route through MCP sampling the moment the plugin loads, no `clad serve` command from the user needed.
- `skills/{sync,check,panel,drive,init,serve}/SKILL.md` — six verbs as Claude Code skills with YAML frontmatter `description` for model invocation. Each body explains what the verb does and when to use it.
- `agents/{orchestrator,librarian,reviewer,observability,specialists}.md` — the five persona files mirrored from `src/agents/` so Claude Code's agent picker surfaces them. The mirror is produced by `scripts/build-plugin.mjs` and committed to git.
- `scripts/build-plugin.mjs` — one-way copy from `src/agents/` (canonical source) to `agents/` (plugin manifest mirror). Drops an AUTO-GENERATED header in `agents/README.md` so hand-edits are caught.
- `package.json` — new `build:plugin` script; `build` now chains `build.mjs && build-plugin.mjs`.
- `spec/features/F-076.yaml` — "Claude Code plugin formalization" (5 ACs, status `done`).

### Notes

- `commands/clad.md` remains for backward compatibility — users on an older Claude Code release that prefers `commands/<name>.md` over `skills/<name>/SKILL.md` still get `/cladding:clad <verb>`. The modern surface coexists rather than replaces.
- After installing the plugin via `/plugin install cladding`, calling `/cladding:check` invokes the same drift suite as `clad check` from the shell — same code path, different surface.
- The auto-launched MCP server means the host adapters (`generic-mcp`, `claude-code`) flip from Mock to McpSamplingTransport without user intervention; cladding's drive loop dispatches real LLM calls through Claude Code's sampling channel from the first invocation.
- v0.3.2 plan: Phase 2 — Codex plugin (`.codex-plugin/plugin.json`) under `plugins/codex/`.

## [0.3.0] — 2026-05-19 — First minor — host MCP transport · live audit · F-049 done

**The v0.2.19 → v0.2.26 thread closes here.** F-049 (the agent dispatch + runtime orchestration feature whose Mock host bodies have been the project's biggest known deferral since v0.2.0) is now `done`. cladding ships a real transport for both modes:

- **Host mode** — `clad serve` boots an MCP server; the host adapters route LLM dispatch through the connected MCP client via the SDK's `createMessage` sampling request. Works with Claude Code, Cursor, Continue, Cline, or any future MCP-aware host.
- **SDK mode** — `claude-anthropic` calls the Anthropic API directly (opt-in via `agent.mode = sdk`).

The minor bump is the spec status flip — every code line that backs F-049 has been merging through develop since v0.2.19. No new code in this release, by design.

### Changed

- `spec/features/F-049.yaml` — `status: in_progress` → `status: done`. AC-092 rewritten to reference the four real implementations (F-069, F-073, F-074, F-075) instead of the original "v0.2.0 mock, v0.3.0 real" placeholder; evidence_refs now point at the concrete modules.
- Version bumped to **0.3.0** in `package.json`, `.claude-plugin/plugin.json`, `src/cli/clad.ts`, `src/serve/server.ts` default advertised version.

### Cumulative contributions (the eight patches this release bundles)

| Version | Feature | Contribution |
|---|---|---|
| 0.2.19 | F-068 | Transport interface extraction — adapter / body split. |
| 0.2.20 | F-069 | AnthropicTransport — first real-LLM dispatch (SDK path). |
| 0.2.21 | F-070 | Drive-loop integration test against AnthropicTransport. |
| 0.2.22 | F-071 | Transport-specific halt classes (`TRANSPORT_AUTH_FAILED` · `_RATE_LIMITED` · `_NETWORK`). |
| 0.2.23 | F-072 | Pre-flight transport health check at drive loop start. |
| 0.2.24 | F-073 | `clad serve` MCP server scaffold — tools / resources / persona prompts. |
| 0.2.25 | F-074 | `McpSamplingTransport` + live audit notification (`notifications/resources/updated`). |
| 0.2.26 | F-075 | Host adapter routing through MCP sampling · bundle minified to 1.1 MB · SECURITY.md MCP invariants. |

### Notes

- 509/509 vitest pass at the v0.2.26 tip; this release adds no test changes.
- `node bin/clad check --strict` drift-green at 75 features.
- BREAKING: none. Every change is additive — code that ran on v0.2.x still runs on v0.3.0 with identical behaviour (Mock fallback when no MCP server is registered).
- Marketplace + npm publish are explicitly out of scope for this release (memory: `marketplace_timing`, `npm publish` deferral).

## [0.2.26] — 2026-05-19 — Host adapter MCP routing + release readiness sweep (F-075)

**Phase B' of the v0.3.0 host-MCP transport thread — the closing patch before declaring F-049 done.** Wires the v0.2.25 building blocks into the actual host adapter dispatch path, then runs a release-readiness audit (bundle minify, security documentation, README sync) so v0.3.0 is a 30-minute version bump rather than a fresh integration push.

### Added

- `src/adapters/host/sampling-context.ts` — process-scoped registry for the active sampling-capable server. `setHostMcpServer(server)` returns a disposer that respects later registrations (won't clobber); `getHostMcpServer()` returns the current registration; `clearHostMcpServerForTesting()` for test isolation.
- `src/cli/clad.ts` `runServeCommand` — registers the freshly-built server in the sampling context before connecting stdio, so the moment a client connects the host adapters route through MCP sampling.
- `tests/adapters/sampling-context.test.ts` — 6 unit tests covering registration, disposer behaviour (including the "later registration wins" rule), null-clear semantics, and the test-only reset hook.
- `tests/adapters/host-parity.test.ts` — 5 new tests under "host adapter MCP routing (F-075)" covering: claudeCodeAdapter routes via sampling, genericMcpAdapter routes via sampling, clearing the registration falls back to Mock on the next dispatch, replacing the registered server re-allocates the cached Sampling transport, healthCheck stays `ready: true` under sampling.
- `spec/features/F-075.yaml` — "Host adapter MCP routing + release readiness sweep" (6 ACs, status `done`).
- `SECURITY.md` — new "MCP server (`clad serve`) — invariants" section: no arbitrary shell execution from MCP tools · read-only by default · sampling responses pass through anti-self-cert · audit notifications are advisory.

### Changed

- `src/adapters/host/claude-code.ts` + `src/adapters/host/generic-mcp.ts` — `invokeAgent` and `healthCheck` now go through an `activeTransport()` helper that returns a cached `McpSamplingTransport` (host-tagged id, `mcp-sampling:claude-code` / `mcp-sampling:generic-mcp`) when a server is registered, or the Mock fallback when not. Per-dispatch decision so a server registered after import still routes correctly.
- `scripts/build.mjs` — `esbuild` now runs with `minify: true`. **Bundle size: 2.4 MB → 1.1 MB (55 % reduction).** No source-map drop, no syntax transforms; the bundle stays a single ESM file readable enough for diagnostic spelunking.
- `src/adapters/host/transport.ts` `SamplingCapableServer` — `messages` widened from `ReadonlyArray` to `Array` and `role` widened to `'user' | 'assistant'` so the SDK's real `Server.createMessage` is assignment-compatible with the interface.
- `README.md` + `README.ko.md` — status line bumped to v0.2.26 · 498/498 tests, adds `clad serve` MCP server with live audit stream, McpSamplingTransport routing, minified bundle size; feature count 73 → 75.
- `docs/multi-provider-roadmap.md` — adapter matrix entries flipped from "planned" to "live (v0.2.26)"; new "What every v0.2.x release contributed" table summarising the F-068 → F-075 thread.
- `src/serve/server.ts` `buildServer` — default `version` advertised to clients bumped to `0.2.26`.

### Notes

- 509/509 vitest pass; `npm run typecheck` clean; `npm run lint` clean; `node bin/clad check --strict` drift-green.
- **Bundle 55 % smaller** without losing any feature — the MCP SDK cost from v0.2.24 is now amortized.
- Host adapter routing is the architectural closing of the v0.2.19 → v0.2.26 thread: F-049's AC-092 ("v0.3.0 introduces the MCP server mode that real Claude Code subagent and MCP-client roundtrips dispatch through") is satisfied today; the v0.3.0 declaration is purely a version bump + spec status flip + release flow.
- v0.3.0 plan: `spec/features/F-049.yaml` status `in_progress` → `done`, minor bump 0.2.26 → 0.3.0, main release flow (tag, gh release create). **Requires user confirmation** for the minor bump.

## [0.2.25] — 2026-05-19 — McpSamplingTransport + live audit notification (F-074)

**Phase B of the v0.3.0 host-MCP transport thread.** v0.2.24 shipped the read surface of `clad serve`; this patch adds the bidirectional pieces — a Transport that dispatches LLM calls via MCP sampling, and a notification path that lets clients live-tail the audit log.

### Added

- `src/adapters/host/transport.ts` — `McpSamplingTransport` (real-host body) + `SamplingCapableServer` interface. The transport takes any server with a `createMessage(params)` method and forwards persona body + feature shard as a sampling request to the connected MCP client. Reply maps to AgentResult with host-tagged identity, 200-char-truncated summary, empty mutations (structured mutations land later), and notes containing model + stopReason.
- `src/hitl/audit.ts` — `subscribeAudit(handler)` observer hook returning a dispose callback. Handlers fire after the file write; exceptions are swallowed so a misbehaving observer cannot corrupt the audit chain.
- `src/serve/server.ts` — `registerAuditNotifier` subscribes an observer that filters by cwd and emits `notifications/resources/updated` for `cladding://audit` when a new evidence entry lands. `registerSubscribeHandlers` wires no-op `resources/subscribe` + `resources/unsubscribe` request handlers (the high-level McpServer wrapper doesn't include them by default).
- McpServer constructor now declares `capabilities: {resources: {subscribe: true}}` so connected clients can subscribe to the audit resource.
- `tests/adapters/transport.test.ts` — 10 unit tests for McpSamplingTransport (id override, system-prompt forwarding, AgentResult shape mapping, 200-char truncation, non-text reply fallback, guardrail interpolation, ready() probe, maxTokens override, error propagation).
- `tests/hitl/audit.test.ts` — 9 tests for the audit observer hook (single observer, multiple observers, dispose, throwing observer doesn't break the chain, file readable from inside the observer, clear-for-testing).
- `tests/serve/audit-notify.test.ts` — 3 in-process integration tests using `Client.setNotificationHandler(ResourceUpdatedNotificationSchema, ...)` to verify: subscribed client receives the notification when evidence lands · evidence for a different cwd does NOT cross-talk · re-reading the audit resource after the notification surfaces the new entry.
- `spec/features/F-074.yaml` — "McpSamplingTransport + live audit notification" (6 ACs, status `done`).

### Fixed

- `src/serve/server.ts` — `cladding://events` and `cladding://audit` resource paths were `events.log` / `audit.log` but the writers (`src/events/log.ts`, `src/hitl/audit.ts`) use the `.jsonl` suffix. Aligned both sides to `events.log.jsonl` / `audit.log.jsonl`. This bug existed in v0.2.24 — surfaced when audit-notify integration tests started reading actual content.

### Notes

- 476 + new tests = **498/498** passing; lint clean; `node bin/clad check --strict` drift-green.
- McpSamplingTransport is exported but not wired into `generic-mcp` / `claude-code` adapters yet — that wiring (env detection + adapter routing) is the next sub-patch. v0.2.25 ships the building block; the routing decision waits until v0.2.26 release readiness sweep so the bundle-size cost (already paid by MCP SDK) is amortized across both pieces.
- The live-audit chain is fully functional **today** for any caller of `appendEvidence` — including future drive-loop iterations dispatching through McpSamplingTransport.
- v0.2.26 plan: release readiness sweep — esbuild `minify: true` (predicted 30~40% bundle reduction), SECURITY.md MCP section (no arbitrary shell exec invariant), README sync (capability lines for host MCP transport + live audit stream).

## [0.2.24] — 2026-05-19 — MCP server scaffold · `clad serve` (F-073)

**Phase A of the v0.3.0 host-MCP transport thread.** `clad serve` boots cladding as an MCP server over stdio so any MCP-aware host (Claude Code, Cursor, Continue, Cline) can consume cladding's tools, resources, and persona prompts. Phase A ships the read surface only; sampling-based dispatch (the transport the drive loop will use) lands in v0.2.25.

### Added

- `src/serve/server.ts` — `buildServer(opts)` factory returning a fully-configured McpServer. The function is transport-agnostic so the production CLI path and the in-process test pair share the same wiring.
- `src/cli/clad.ts` — new `clad serve` verb. Lazy-imports `@modelcontextprotocol/sdk` so the cold-start cost stays on the path that uses it.
- Four MCP tools: `clad_list_features` (with `statusFilter` arg), `clad_get_feature` (typed `isError` on unknown id), `clad_run_check` (delegates to `runDrift`, surfaces `isError` on fail), `clad_get_events` (tails `.cladding/events.log`, configurable `limit`).
- Three MCP resources: `cladding://spec` (aggregated spec, JSON), `cladding://events` (NDJSON event log), `cladding://audit` (NDJSON audit log). Returns empty text when the file is absent.
- Five MCP prompts — one per persona (`orchestrator`, `librarian`, `reviewer`, `observability`, `specialists`). Each accepts an optional `featureId` arg that gets interpolated into the persona body.
- `tests/serve/server.test.ts` — 13 integration tests using an in-process `InMemoryTransport.createLinkedPair()` to drive a real `Client` against the real `McpServer`. Covers tool listing, resource reading, prompt fetching, status filter, unknown-id error path, and an empty-log fallback.
- `tests/cli/clad.test.ts` — CLI plumbing test for `runServeCommand` (MCP server build + stdio transport instantiation, both mocked).
- `package.json` — `@modelcontextprotocol/sdk` ^1.29.0 + `zod` (transitive) added to dependencies.
- `spec/features/F-073.yaml` — "MCP server (`clad serve`) — read surface" (5 ACs, status `done`).

### Notes

- 462 + new tests = **476/476** passing; lint clean; `node bin/clad check --strict` drift-green.
- Bundle size grew from ~1.3 MB to ~2.4 MB because `@modelcontextprotocol/sdk` and its `zod` dependency get included. The dynamic import in `runServeCommand` keeps the cost on the `serve` path — `clad sync` / `clad check` / `clad drive` cold-starts are unaffected.
- v0.2.25 plan: `McpSamplingTransport` — sampling-based transport that the drive loop's host adapters use to round-trip LLM requests through the connected MCP host. Pairs with this server in-process for the integration test.

## [0.2.23] — 2026-05-19 — Pre-flight transport health check (F-072)

The drive loop used to discover a missing API key (or any unhealthy adapter) only after the first feature iteration: pre-flight check runs once at startup, the loop fails fast at iteration 0, and the user sees an actionable halt class instead of a wasted dispatch attempt.

### Added

- `src/drive/loop.ts` — pre-flight `adapter.healthCheck()` call between spec-load and the iteration loop. If the adapter reports `ready: false`, the reason string is routed through `classifyTransportError` (introduced in v0.2.22) so the halt lands in the most specific class — `TRANSPORT_AUTH_FAILED` for credential problems, `TRANSPORT_RATE_LIMITED` for pre-flight rate-limit, `TRANSPORT_NETWORK` for unreachable hosts, `LLM_UNAVAILABLE` as catch-all. Halt detail begins with `pre-flight health check failed:`.
- `DriveOptions.skipHealthCheck` — opt-out used by unit tests that stub `runAgent` and never reach a real adapter dispatch. Production CLI path leaves it `false`.
- `spec/features/F-072.yaml` — "Pre-flight transport health check in drive loop" (5 ACs, status `done`).

### Changed

- `src/drive/halt.ts` `classifyTransportError` — extended AUTH detection to also match the lowercased phrases `api key` and `api_key`, so AnthropicTransport's "ANTHROPIC_API_KEY env var is not set" pre-flight reason classifies as `TRANSPORT_AUTH_FAILED` instead of falling through to `LLM_UNAVAILABLE`.
- `tests/drive/loop.test.ts` — added a healthy-stub `selectAdapter` mock plus an F-072 sub-describe that exercises the four pre-flight paths (auth · rate limit · network · ready=true) and the `skipHealthCheck: true` bypass.

### Notes

- 462/462 vitest pass; `npm run lint` clean; `node bin/clad check --strict` drift-green.
- The pre-flight check costs one local function call when healthy and zero network IO for both host and SDK adapters in the happy path — AnthropicTransport's `ready()` only checks for the env var presence.
- v0.3.0 plan (substep 5): declare F-049 done (mock removed in favour of the SDK path), bump minor, release.

## [0.2.22] — 2026-05-19 — Transport-specific halt classes (F-071)

**Substep 4 of the v0.3.0 path.** The drive loop used to flatten every transport failure into `LLM_UNAVAILABLE`. With real-LLM dispatch live since v0.2.20, that's no longer actionable — users need to know whether a halt came from a bad API key, a rate limit, or a network blip. v0.2.22 introduces three transport-specific halt classes and routes the loop's catch blocks through a single classifier.

### Added

- `src/drive/halt.ts` — three new `HaltClass` members: `TRANSPORT_AUTH_FAILED` (401 / 403 / invalid API key), `TRANSPORT_RATE_LIMITED` (429 / quota / too many requests), `TRANSPORT_NETWORK` (ENOENT / ECONNREFUSED / ECONNRESET / ETIMEDOUT / ENOTFOUND or matching phrases). `LLM_UNAVAILABLE` stays as the catch-all.
- `src/drive/halt.ts` — `classifyTransportError(err: unknown): HaltClass`. Reads the error message (case-insensitive) plus the `code` field on `NodeJS.ErrnoException`. Auth precedes rate-limit precedes network in the check order, so an ambiguous error lands in the most user-actionable bucket.
- `src/ui/softShell.ts` — `HALT_MESSAGES` entries for the three new classes ("Stopped — agent rejected the credentials. Check your API key." / "Stopped — agent is rate-limited. Try again after the cooldown." / "Stopped — could not reach the agent over the network.").
- `tests/drive/halt.test.ts` — classifier unit tests across all four buckets (~20 cases), including non-Error throws and precedence ordering.
- `tests/integration/loop-real-transport.test.ts` — the "transport throw" case is split into four: 401 → AUTH_FAILED, 429 → RATE_LIMITED, ECONNREFUSED → NETWORK, unknown phrase → LLM_UNAVAILABLE.
- `spec/features/F-071.yaml` — "Transport-specific halt classes for real-LLM dispatch failures" (5 ACs, status `done`).

### Changed

- `src/drive/loop.ts` — both specialist and reviewer dispatch catch blocks now call `classifyTransportError(err)` instead of hardcoding `class: 'LLM_UNAVAILABLE'`. The reviewer block still routes `ReviewerIdentityCollisionError` to `HUMAN_REQUIRED` (unchanged contract).
- `tests/ui/softShell.test.ts` — the every-class round-trip test now iterates 13 classes (10 + 3 new).

### Notes

- 426 + new tests = **all passing**; `node bin/clad check --strict` stays drift-green.
- The classifier is intentionally pattern-based (HTTP status prefixes + SDK phrases + `ErrnoException` codes) — no SDK-specific coupling. New transports (OpenAI, Google, …) get the same classification for free as long as their errors carry conventional shapes.
- v0.3.0 plan (substep 5): declare F-049 done (mock removed in favour of the SDK path), bump minor, release.

## [0.2.21] — 2026-05-19 — Drive-loop integration test against AnthropicTransport (F-070)

**Substep 3 of the v0.3.0 path.** Wires the v0.2.19 Transport interface and the v0.2.20 AnthropicTransport into a drive-loop end-to-end integration test. Proves the loop's halt-class chain — `ALL_FEATURES_DONE`, `HUMAN_REQUIRED` via reviewer-identity barrier, `LLM_UNAVAILABLE` on transport throw — works against real-LLM-shape data, not just mock placeholders.

### Added

- `tests/integration/loop-real-transport.test.ts` — 3 integration tests:
  - Happy path: loop dispatches through `selectAdapter → claudeAnthropicAdapter → AnthropicTransport` with a stubbed clientFactory, reaches `ALL_FEATURES_DONE`
  - Identity collision: forced same-identity from both specialist and reviewer dispatches → `HUMAN_REQUIRED` (F-049 AC-086 contract preserved against real-shape data)
  - Auth fail: transport throws "401: invalid x-api-key" → `LLM_UNAVAILABLE` halt with original message in detail
- `spec/features/F-070.yaml` — "Drive-loop integration test against AnthropicTransport" (4 ACs, status `done`).

### Changed

- `src/adapters/sdk/anthropic.ts` — added `setDefaultTransportForTesting(t)` test-only seam. The module-level default Transport is now lazy and swappable via this function. Production code MUST NOT call it; integration tests use it to inject a stubbed Transport without monkey-patching the adapter.

### Notes

- 423 + 3 new tests = **426 / 426** passing.
- `node bin/clad check --strict` stays drift-green.
- `setDefaultTransportForTesting` is the first test-only export cladding ships; documented with a "Production code MUST NOT call this" comment.
- v0.2.22 plan: introduce transport-specific halt classes (TRANSPORT_AUTH_FAILED, TRANSPORT_RATE_LIMITED, TRANSPORT_NETWORK) that the loop maps to instead of the generic `LLM_UNAVAILABLE`. This gives users actionable error categories.

## [0.2.20] — 2026-05-19 — AnthropicSdkTransport · first real-LLM dispatch (F-069)

**Substep 2 of the v0.3.0 path.** Cladding ships its first real-LLM Transport: `AnthropicTransport`, which dispatches via `@anthropic-ai/sdk` to the Anthropic API directly. Opt-in via `agent.mode = sdk` + `agent.name = claude-anthropic` + `ANTHROPIC_API_KEY` env var. Default cladding stays on the host-bound MockTransport — no behaviour change for existing setups.

Host-mode real transport (the claude-code subagent dispatch path) still depends on the `clad serve` MCP server, which is queued for a later substep. v0.2.20 unlocks real LLM calls today through the SDK path, while the MCP path matures separately.

### Added

- `src/adapters/sdk/anthropic.ts` — `AnthropicTransport` (real-LLM body) + `claudeAnthropicAdapter` (AgentAdapter wrapping it). Uses the `clientFactory` injection seam so tests substitute an in-memory client and no network call fires during CI.
- `tests/adapters/anthropic.test.ts` — 11 unit tests covering id format, ready() with/without API key, invoke() throw on missing key, AgentResult shape, system/user message formatting, client caching, 200-char summary truncation, model/maxTokens override, stop_reason surfacing.
- `package.json` — `@anthropic-ai/sdk` added to `dependencies`.
- `spec/features/F-069.yaml` — "AnthropicSdkTransport — first real-LLM dispatch path" (5 ACs, status `done`).

### Changed

- `src/adapters/index.ts` — new `SDK_REGISTRY` with the `claude-anthropic` entry; `selectAdapter()` routes `mode: sdk` to `SDK_REGISTRY` before falling through to `generic-mcp`. The "SDK adapters not yet implemented" fallback comment is updated.
- `tests/adapters/index.test.ts` — the `sdk mode → falls back to generic-mcp` test is replaced by two tests: `sdk + claude-anthropic → SDK adapter` and `sdk + unknown name → still falls back to generic-mcp`.

### Notes

- 411 + 12 new tests = **423 / 423** passing.
- `node bin/clad check --strict` stays drift-green; coverage unchanged.
- The SDK adapter's body is real; the surrounding cladding workflow (selector, drive loop, parity tests) is the same. End-to-end real LLM dispatch works today with `CLADDING_AGENT_MODE=sdk CLADDING_AGENT_NAME=claude-anthropic ANTHROPIC_API_KEY=… node bin/clad drive`.
- v0.2.21 plan: drive-loop integration test that runs end-to-end against AnthropicTransport with a stubbed client (no network), proving the loop dispatches → reviewer barrier → UAT chain through real-shape (not mock) data.

## [0.2.19] — 2026-05-19 — Transport interface extraction · v0.3.0 substep 1 (F-068)

First step toward the v0.3.0 F-049 real Claude Code dispatch. Splits each host adapter into two layers: the AgentAdapter (the contract `drive/agent.ts` sees) and the Transport (the swappable body that crosses the host boundary). v0.2.19 ships the MockTransport implementation only; v0.2.20 replaces selected adapters' MockTransport with a real body without touching the AgentAdapter object.

**No behaviour change.** Pure structural refactor — the same mock results land in the drive loop today as before.

### Added

- `src/adapters/host/transport.ts` — Transport interface (`id`, `invoke`, `ready`) + `MockTransport` implementation. Both real bodies in v0.2.20+ will implement the same interface.
- `tests/adapters/transport.test.ts` — 7 unit tests covering MockTransport's observable behaviour.
- `spec/features/F-068.yaml` — "Transport interface extraction" (4 ACs, status `done`).

### Changed

- `src/adapters/host/claude-code.ts` — composes a `MockTransport` instance and delegates `invokeAgent` / `healthCheck` to it. Inline `mockResult()` removed.
- `src/adapters/host/generic-mcp.ts` — same refactor as claude-code.

### Notes

- 404 + 7 new tests = **411 / 411** passing.
- `node bin/clad check --strict` stays green; coverage unchanged.
- v0.2.20 plan: introduce `ClaudeCodeTransport` (real subagent dispatch) and `McpTransport` (real MCP roundtrip) alongside MockTransport. Adapter objects pick the right Transport based on runtime detection. Behaviour change isolated to the Transport file.

## [0.2.18] — 2026-05-19 — MISSING_TESTS warn → error (F-067)

**Lock-in patch**. The v0.2.4 honesty cleanup brought cladding's self-spec from 56 empty `status: done` ACs down to zero. v0.2.18 converts that one-time achievement into a permanent invariant: the `MISSING_TESTS` drift detector's default severity is promoted from `warn` to `error`. Shipping a new done AC without `test_refs` or `evidence_refs` now fails `clad check` outright — not just under `--strict`.

### Changed

- `src/stages/detectors/missing-tests.ts` — finding severity `warn` → `error`. Module header updated with the v0.2.18 rationale (the promotion was held until self-spec had zero empty done ACs, which v0.2.4 delivered).
- `tests/stages/missing-tests.test.ts` — assertion updated from `'warn'` to `'error'`; test name updated; header comment updated.
- `src/stages/detectors/README.md` — catalog row #7, status-policy table, and AC-evidence-taxonomy section all reflect the new error severity with a "(promoted from warn in v0.2.18)" annotation.

### Added

- `spec/features/F-067.yaml` — "MISSING_TESTS severity promoted warn → error" (3 ACs, status `done`).

### Notes

- `node bin/clad check` (default mode) on cladding's own self-spec stays drift-green because all 66 features × their ACs already declare evidence (v0.2.4 cleanup).
- 404 / 404 tests stay green. No coverage change.
- For user projects that haven't completed an equivalent cleanup, this is a breaking change in CI signal — the same situation that previously emitted warns now emits errors. Mitigation: declare evidence for every done AC, or temporarily downgrade the feature to `status: in_progress` until evidence is ready.

## [0.2.17] — 2026-05-19 — Differentiation evidence into docs (F-066)

Surfaces the 2026-05-19 controlled A/B/C benchmark (event-sourcing store, 22 ACs + 8 traps) inside cladding's own docs so external readers can find it without access to the maintainer's local cladding-abc workspace. The headline result — **vanilla 2/8 (25%) accidental trap catch vs cladding 8/8 (100%) explicit** — is now linked from `README.md`, `README.ko.md`, and cited in `GOVERNANCE.md` §5 (v1.0 graduation criteria).

### Added

- `docs/benchmarks/event-store-trap-catch.md` — full synthesis: 8-axis comparison, trap-by-trap matrix, plugin-invocation note, cumulative cells 07/09 table.
- `docs/benchmarks/event-store-spec-with-traps.md` — the shared problem definition (22 normal ACs + 8 intentional ambiguities).
- `spec/features/F-066.yaml` — "Differentiation evidence — surface cell 09 benchmark in cladding's docs" (3 ACs, status `done`).

### Changed

- `README.md` + `README.ko.md` — new **Evidence** section between Levels and Status & roadmap. Summarises the trap-catch result and links to the full document.
- `GOVERNANCE.md` §5 — appended a **Differentiation evidence** subsection citing the benchmark with explicit "one data point, not proof" framing. The four v1.0 graduation conditions stay unchanged.

### Notes

- This patch is documentation-only. No code change. 404/404 tests stay green. Coverage and drift unchanged.
- The benchmark is reproducible from the published spec + the published trap list; the per-variant source is in the maintainer's local cladding-abc workspace and can be republished on request.
- The "Differentiation evidence" framing is deliberate: one cell at one complexity level is signal, not proof. The v1.0 falsifications-registry condition (GOVERNANCE.md §5.4) gates the wider claim.

## [0.2.16] — 2026-05-19 — `src/` layout adoption (F-065)

**Layout refactor**, no behaviour change. Every first-party code dir now lives under a single `src/` root: `src/{adapters · agents · cli · drive · events · hitl · optimizer · router · spec · stages · ui}`. Spec data (`features/`, `scenarios/`, `architecture.yaml`) stays at the project root because user projects keep their data at that path; `schema.json` moves into `src/spec/` because it travels with the code that reads it.

### Changed (mechanical)

- Source dirs moved: `adapters/` `agents/` `cli/` `drive/` `events/` `hitl/` `optimizer/` `router/` `stages/` `ui/` → `src/<name>/`
- Spec runtime moved: `spec/{cli,ears,load,parse,types,validate}.ts` + `spec/schema.json` → `src/spec/`
- Spec data unchanged: `spec/{features/,scenarios/,architecture.yaml}` stay at root
- `tests/**/*.ts` — 126 import + vi.mock + dynamic-import paths gained `src/` prefix
- `spec/features/*.yaml` — 336 module / evidence_refs path references gained `src/` prefix (where they point at code)
- `conformance/runner.ts` — 16 stage / hitl imports updated
- `vitest.config.ts` — coverage `include` collapses from 11 glob patterns to `src/**/*.ts`
- `package.json` scripts — 13 entries updated (`tsx src/stages/X.ts` etc)
- `scripts/build.mjs` — entry `cli/clad.ts` → `src/cli/clad.ts`; schema source `src/spec/schema.json`
- `bin/clad` — tsx fallback path `cli/clad.ts` → `src/cli/clad.ts`
- `src/stages/detectors/unmapped-artifact.ts` — scan glob `stages/**` → `src/stages/**`
- `src/stages/detectors/harness-integrity.ts` — count glob `stages/detectors/*.ts` → `src/stages/detectors/*.ts`
- `src/stages/detectors/meta-integrity.ts` — schema lookup `spec/schema.json` → `src/spec/schema.json`

### Added

- `spec/features/F-065.yaml` — "src/ layout — move all code dirs under one source root" (4 ACs, status `done`).

### Notes

- 404 / 404 tests pass; `node bin/clad check --strict` is green; line coverage stays at **93.89%** (unchanged from v0.2.15 — the move doesn't add or remove tested code).
- Why the split: spec/ at root holds **data** that users' own projects also keep at root; `src/spec/` holds **code** that travels with cladding. `loadSpec(cwd)` still reads `${cwd}/spec.yaml` and `${cwd}/spec/features/*.yaml` — unchanged for users.
- Why `conformance/` stays at root (parallel to `tests/`, not under `src/`): it's a test/integration harness, not production code. `npm run conformance` is a separate entry point — the bundle doesn't include `conformance/runner.ts`. The `FIXTURE_REFERENCE_INVALID` detector reads `${cwd}/conformance/fixtures.yaml` for both cladding-self and user projects, so the path must stay symmetric across both.
- Doc sweep: 18 `.md` files updated for the new layout (63 inline-backtick path substitutions + 3 markdown link targets + 1 prose `tsx` invocation). README level-history entries that describe past versions are preserved verbatim.
- This is the second meta-refactor of the v0.2.x cycle (after the v0.2.13 coverage scope widening). After v0.2.16 the repo root is materially tidier: 11 code dirs collapse into 1.

## [0.2.15] — 2026-05-19 — Final coverage closure · every source dir ≥ 90% (F-064)

**Milestone**: every one of the 11 first-party source dirs (`adapters · agents · cli · drive · events · hitl · optimizer · router · spec · stages · ui`) is now at ≥ 90% line coverage. Project line coverage rises from **87.67% → 93.89%** (+6.22pp) under the widened scope from v0.2.13.

The cli chapter, which opened in v0.2.13 at 37.4% (init only), now closes at **92.7%**. The adapter chapter rises from 75% to **97.5%**.

### Changed

- `cli/clad.ts` — refactored to expose every verb's handler as a named export (`runInitCommand`, `runWorkCommand`, `runDriveCommand`, `runSyncCommand`, `runCheckCommand`, `runPanelCommand`, `runRouteCommand`), plus a `createProgram()` factory that returns the wired commander `Command`. Top-level `program.parse()` is now guarded by an `isCliEntry` check that fires when the module is the bundled entry **or** the directly-executed source. Importing from a test no longer touches `process.argv`. Behaviour-preserving — `node bin/clad <verb>` works identically to before.

### Added

- `tests/cli/clad.test.ts` — 18 tests covering every handler (init / work / drive / sync / check / panel / route) including exit codes, option forwarding, spec-absent fallbacks, `--strict` drift forwarding, `--internal` stage codes, `--json` raw output, `UNCAUGHT_ERROR` exit-1 mapping, and the `createProgram()` factory's 7-verb registration. Uses a record-only `process.exit` mock so the try/catch in `runSyncCommand` does not eat the recorded code.
- `tests/adapters/index.test.ts` — 12 tests covering the resolution chain (env priority / config priority / auto-detect / malformed config / partial agent / unknown host fallback / sdk-mode fallback) for both `resolveSelection` and `selectAdapter`.
- `spec/features/F-064.yaml` — "Final coverage closure — every source dir ≥ 90% lines" (4 ACs, status `done`).

### Notes

- Coverage per dir at v0.2.15 baseline (line %):
  - events: 100, hitl: 100, optimizer: 100, router: 100, ui: 100
  - spec: 98.3, **adapters: 97.5** (was 75), **cli: 92.7** (was 37.4), agents: 93.3, stages: 92.9, drive: 90.6
- 30 new tests bring the suite to **404 / 404 passing** (374 prior).
- `clad check --strict` confirmed green (93.89% > 70% floor with headroom).

### Coverage push — closing arc

| Batch | Targets | Line coverage | Scope |
|---|---|---|---|
| v0.2.5 baseline | 3 detectors | 26.8% | narrow |
| v0.2.9 (detectors closed) | 20 det | 63.49% | narrow |
| v0.2.12 (stages closed) | 20 det + 12 stages | 93.32% | narrow |
| v0.2.13 (scope widened) | + cli/init + cli/benchmark | 74.42% | **wide** |
| v0.2.14 (5 chapters closed) | + drive · agents · events · optimizer · ui | 87.67% | wide |
| **v0.2.15 (final closure)** | **+ cli/clad + adapters/index** | **93.89%** | wide |

## [0.2.14] — 2026-05-19 — Coverage sweep · 5 chapters closed in one batch (F-063)

Massive sweep that closes **five remaining 0%-coverage chapters** at once: `drive`, `agents`, `events`, `optimizer`, `ui`. Project line coverage rises from **74.42% → 87.67%** (+13.25pp) under the widened scope introduced in v0.2.13.

### Added

- `tests/drive/loop.test.ts` — 12 tests covering every halt class (UNCAUGHT_ERROR / ALL_FEATURES_DONE / BLOCKED_FEATURE / LLM_UNAVAILABLE / HUMAN_REQUIRED / MAX_ITERATIONS) plus happy path with single + paired-feature dependency runs. Heavy-mock approach (`vi.mock` for spec/load, agents/loader, drive/agent, stage runners, events, audit) keeps the suite deterministic.
- `tests/agents/loader.test.ts` — 8 tests covering frontmatter parse / missing / unterminated / unknown-capability filter / missing-file throw / cache reuse / cache clear.
- `tests/events/log.test.ts` — 8 tests covering newEvent shape, directory auto-creation, round-trip, absent / empty / whitespace-only log, multi-append order, idempotent directory creation.
- `tests/optimizer/preamble.test.ts` — 7 tests covering "You are X agent" stripping / "# Persona" heading / "Your job is to" / blank-run collapsing / no-preamble pass-through / custom patterns / default-pattern non-empty.
- `tests/optimizer/tail.test.ts` — 7 tests covering no-cut / cut-middle / boundary / default-arg / empty input / elision-count formula.
- `tests/ui/pulse.test.ts` — 8 tests covering every PulseKind glyph, TTY-vs-non-TTY ANSI rendering, detail-string indent, empty-detail trim.
- `tests/ui/panel.test.ts` — 8 tests covering L4 cell derivation (audit empty / human pass / tool-only guard fail), internal-vs-default mode, title fallback, default cwd/opts.
- `spec/features/F-063.yaml` — "Coverage sweep — drive · agents · events · optimizer · ui all covered" (6 ACs, status `done`).

### Notes

- Coverage per dir at v0.2.14 baseline (line %):
  - hitl: 100, router: 100, **events: 100** (was 0), **optimizer: 100** (was 60.7), **ui: 100** (was 39), spec: 98.3, **agents: 93.3** (was 0), stages: 92.9, **drive: 90.6** (was 21.9), adapters: 75, cli: 37.4
- 58 new tests bring the suite to **374 / 374 passing** (316 prior).
- `clad check --strict` confirmed green at 87.67% (well above the 70% floor).

### Coverage push — cumulative arc

| Batch | Targets | Line coverage | Scope |
|---|---|---|---|
| v0.2.5 baseline | 3 detectors | 26.8% | narrow (stages + spec) |
| v0.2.9 (detector chapter closed) | 20 detectors | 63.49% | narrow |
| v0.2.12 (stage chapter closed) | 20 det + 12 stages | 93.32% | narrow |
| v0.2.13 (scope widened) | + cli/init + cli/benchmark | **74.42%** | **wide (11 dirs)** |
| **v0.2.14 (5 chapters closed in one batch)** | + drive · agents · events · optimizer · ui | **87.67%** | wide |

### What's still open

Under the widened scope:

- `cli/clad.ts` (commander entry) — 0%. Needs subprocess or handler-extraction approach.
- `adapters/index.ts` — 62.5%. Some branches of the auto-detection logic uncovered.

That's the entire remaining gap on the source tree, post-sweep.

## [0.2.13] — 2026-05-19 — cli test batch 1 + widened coverage scope (F-062)

Opens the **cli chapter** with a honest twist: the coverage measurement scope is widened from `{stages, spec}` to every first-party source dir (cli, drive, optimizer, adapters, router, ui, hitl, events, agents). The headline coverage number now tracks the whole codebase, not just the two chapters closed in v0.2.9 / v0.2.12. **Pre-v0.2.13 percentages remain valid for the narrow scope they were measured against, but are not directly comparable to v0.2.13+ numbers.**

Under the widened scope, project line coverage stands at **74.42%** — well above the 70% floor, so `clad check --strict` still passes drift.

### Changed

- `vitest.config.ts` — coverage `include` widened to 11 first-party source dirs (was 2). The `exclude` list switches to a glob that catches every `*.test.ts` at any depth, rather than the previous stage-specific glob.
- `cli/benchmark.ts` — refactored for testability: `approxTokens` and `benchmark` are now exported, and CLI bootstrap code (`if (!featureId) process.exit(2)` …) is wrapped in an `isCliEntry` guard. Matches the pattern used by every other module in the tree.

### Added

- `tests/cli/init.test.ts` — three new branch tests bring `cli/init.ts` to **100% line coverage**: explicit `projectName` override, `.gitignore` without a trailing newline, `.gitignore` created from scratch.
- `tests/cli/benchmark.test.ts` — 8 tests covering `approxTokens` (empty / 4-char / partial / 400-char) plus `benchmark` (single feature / multi-feature reduction / sharded spec load / reduction-percent formula). Brings `cli/benchmark.ts` to **57.9% line coverage** (CLI bootstrap block remains uncovered — by design).
- `spec/features/F-062.yaml` — "cli test batch 1 + widened coverage scope" (5 ACs, status `done`).

### Notes

- 11 new tests bring the suite to **316 / 316 passing** (305 prior).
- Per-dir coverage at v0.2.13 baseline (line %):
  - hitl: 100, router: 100, spec: 98.3, stages: 92.9, adapters: 75, optimizer: 60.7, ui: 39, cli: 37.4, drive: 21.9, agents: 0, events: 0
- Visible 0% dirs (`agents/loader.ts`, `drive/loop.ts`, `events/log.ts`, `optimizer/{preamble,tail}.ts`, `ui/{panel,pulse}.ts`, `cli/clad.ts`) are batch-2+ candidates.
- `clad check --strict` confirmed green under the widened scope (74.42% > 70% floor).

## [0.2.12] — 2026-05-19 — Stage runner chapter closed · every stage covered (F-061)

**Milestone**: every one of the 12 Iron Law stage runners (stage_1.1 through stage_4.2) now carries a dedicated unit-test file at ≥ 75% line coverage. The stage-runner chapter that opened with v0.2.10 is closed. Combined with the detector chapter closed in v0.2.9, **every business-logic module cladding ships now has dedicated unit-test coverage**.

Project line coverage rises from **84.23% → 93.32%** (+9.1pp), crossing the 90% milestone. Total cumulative gain since v0.2.5 baseline: **26.8% → 93.32% (+66.5pp)** across seven batches.

### Added

- `tests/stages/perf.test.ts` — 8 tests covering the npm-script delegate pattern (unknown / script-missing / exit 0 / non-zero / ENOENT / non-ENOENT throw / null-exit / explicit non-npm override).
- `tests/stages/visual.test.ts` — 8 tests mirroring the perf pattern.
- `tests/stages/uat.test.ts` — 7 tests covering spec-absent / audit-empty / human-pass-satisfies / tool-only-fails / human-note-does-not-satisfy / status-filter / multi-feature paths via real `appendEvidence` writes.
- `spec/features/F-061.yaml` — "Stage runner tests batch 3 — every stage covered" (4 ACs, status `done`).

### Notes

- Coverage per targeted stage (v8 reporter, JSON summary):
  - `stages/perf.ts`: 88.5% lines · 92.6% branches
  - `stages/visual.ts`: 88.5% lines · 92.6% branches
  - `stages/uat.ts`: 85.7% lines · 93.3% branches
- 23 new tests bring the suite to **305 / 305 passing** (282 prior).
- The remaining ~7% of source-tree coverage lives in `cli/*`, `optimizer/*`, scan helpers — separate threads beyond the stage/detector chapters.

### Coverage push — the full arc

| Batch | Targets | Line coverage | Delta |
|---|---|---|---|
| v0.2.5 baseline | 3 detectors | 26.8% | — |
| v0.2.6 (detector batch 1) | 8 detectors | 36.36% | +9.5pp |
| v0.2.7 (detector batch 2) | 10 detectors | 49% | +12.6pp |
| v0.2.8 (detector batch 3) | 15 detectors | 58.66% | +9.7pp |
| v0.2.9 (detector batch 4) | 20 detectors (chapter closed) | 63.49% | +4.8pp |
| v0.2.10 (stage batch 1) | 20 det + 4 stages | 72.58% | +9.1pp |
| v0.2.11 (stage batch 2) | 20 det + 9 stages | 84.23% | +11.6pp |
| **v0.2.12 (stage batch 3)** | **20 det + 12 stages (both chapters closed)** | **93.32%** | **+9.1pp** |

## [0.2.11] — 2026-05-19 — Stage runner tests batch 2 (F-060)

Continues the stage-runner coverage thread opened by v0.2.10. Five more stage runners gain dedicated unit tests using the established patterns: detector-adapter stages (`arch`, `secret`) mock the underlying detector; polyglot stages (`unit`, `cov`, `smoke`) mock `execaSync`. Project line coverage rises from **72.58% → 84.23%** (+11.65pp).

### Added

- `tests/stages/arch.test.ts` — 6 tests covering the detector-adapter shape (no findings / info-only / single error / multi-error / mixed severity / opts forwarding).
- `tests/stages/secret.test.ts` — 6 tests mirroring the arch pattern.
- `tests/stages/unit.test.ts` — 6 tests covering the polyglot toolchain pattern (unknown / override / exit 0 / non-zero / stderr-present-or-absent / null-exit).
- `tests/stages/cov.test.ts` — 6 tests mirroring the unit pattern.
- `tests/stages/smoke.test.ts` — 8 tests covering the richer branch tree (unknown / npm-script-missing / present-exit-0 / non-zero / ENOENT / non-ENOENT throw / null-exit / explicit override).
- `spec/features/F-060.yaml` — "Stage runner tests batch 2" (4 ACs, status `done`).

### Notes

- Coverage per targeted stage (v8 reporter, JSON summary):
  - `stages/arch.ts`: 75% lines · 88.9% branches
  - `stages/secret.ts`: 75% lines · 88.9% branches
  - `stages/unit.ts`: 85.7% lines · 90.9% branches
  - `stages/cov.ts`: 85.7% lines · 90.9% branches
  - `stages/smoke.ts`: 88.5% lines · 92.6% branches
- The 75% line floor on `arch.ts` / `secret.ts` reflects their tighter source — the uncovered lines are the `isCliEntry` blocks at the bottom of each file, identical to the v0.2.10 pattern.
- 32 new tests bring the suite to **282 / 282 passing** (250 prior).
- 3 stage runners remain (`perf.ts`, `visual.ts`, `uat.ts`) — batch 3 candidates.

## [0.2.10] — 2026-05-19 — Stage runner tests batch 1 · **70% coverage floor cleared** (F-059)

**Milestone**: project line coverage crosses the 70% floor. `clad check --strict` no longer emits the COVERAGE_DROP warn that has been the last `--strict`-mode blocker since v0.2.2. The five-batch coverage push that began at v0.2.5 (26.8% baseline) closes at **72.58%**.

Four stage runners gain dedicated unit tests using the `vi.mock('execa')` pattern proven in v0.2.9: `type` (stage_1.1), `lint` (stage_1.2), `commit` (stage_1.4), and `audit` (stage_4.1). The first three are subprocess-bound polyglot stages; `audit` is pure read-only.

### Added

- `tests/stages/type.test.ts` — 6 tests covering unknown-language / explicit override / exit 0 / non-zero exit / stderr present-or-absent / null-exit-default-1.
- `tests/stages/lint.test.ts` — 6 tests mirroring the type-runner pattern (the stage shape is identical; only the gate differs).
- `tests/stages/commit.test.ts` — 6 tests covering clean tree / dirty tree / non-git / git non-zero with empty stderr / ENOENT / non-ENOENT throw.
- `tests/stages/audit.test.ts` — 5 tests using real `appendEvidence` writes to exercise audit-log empty / clean human evidence / tool-only guard-fail / multi-AC fail / mixed human-and-tool paths.
- `spec/features/F-059.yaml` — "Stage runner tests batch 1 — 70% coverage floor cleared" (4 ACs, status `done`).

### Notes

- Coverage per targeted stage (v8 reporter, JSON summary):
  - `stages/type.ts`: 85.7% lines · 90.9% branches
  - `stages/lint.ts`: 85.7% lines · 90.9% branches
  - `stages/commit.ts`: 84.2% lines · 83.3% branches
  - `stages/audit.ts`: 80% lines · 90% branches
- Per-stage line coverage hits ~80–86% rather than 100%. The uncovered lines are the `isCliEntry` blocks at the bottom of each file — runtime-only CLI bootstraps that aren't reachable from in-process tests.
- 23 new tests bring the suite to **250 / 250 passing** (227 prior).
- `clad check --strict` confirmed green on drift after this batch.

### Cumulative coverage progression (5-batch push)

| Batch | Detectors / Stages covered | Line coverage | Delta |
|---|---|---|---|
| v0.2.5 baseline | 3 detectors | 26.8% | — |
| v0.2.6 (detector batch 1) | 8 detectors | 36.36% | +9.5pp |
| v0.2.7 (detector batch 2) | 10 detectors | 49% | +12.6pp |
| v0.2.8 (detector batch 3) | 15 detectors | 58.66% | +9.7pp |
| v0.2.9 (detector batch 4) | 20 detectors | 63.49% | +4.8pp |
| **v0.2.10 (stage batch 1)** | 20 det + 4 stages | **72.58%** | **+9.1pp** |

### What's still open

- 8 stage runners remain (`arch`, `cov`, `secret`, `unit`, `smoke`, `perf`, `visual`, `uat`). Coverage will continue to rise as each batch lands — the 70% floor is now a sustained property, not a finish line.

## [0.2.9] — 2026-05-19 — Detector catalog 20/20 at 100% line coverage (F-058)

The final batch of the detector-coverage thread. The last two detectors — `HARDCODED_SECRET` and `ARCHITECTURE_VIOLATION`, both subprocess-bound — gain unit tests using `vi.mock('execa')` to exercise every branch deterministically. **Result: every one of the 20 registered drift detectors (19 Ironclad + 1 cladding extension) now has a dedicated `tests/stages/*.test.ts` file at 100% line coverage.**

Project line coverage rises from **58.66% → 63.49%** (+4.83pp). Cumulative gain across four batches: **+36.7pp** from the v0.2.5 baseline (26.8% → 63.49%). The detector chapter is now closed.

### Added

- `tests/stages/hardcoded-secret.test.ts` — 7 tests covering no-toolchain-gate / exit 0 / non-zero exit / ENOENT / non-ENOENT throw / stdout-only / no-output exit-code fallback. Uses `vi.mock('execa')` so the suite stays deterministic; real-binary coverage lives in `conformance/runner.ts` (stage_1.6 fixtures).
- `tests/stages/architecture-violation.test.ts` — 7 tests mirroring the HARDCODED_SECRET pattern. Real-binary coverage lives in stage_1.5 fixtures.
- `spec/features/F-058.yaml` — "Detector unit tests batch 4 (final 2 + every detector at 100% line coverage)" (4 ACs, status `done`).

### Notes

- Coverage per targeted detector (v8 reporter, JSON summary):
  - `hardcoded-secret.ts`: 100% lines · 81.25% branches
  - `architecture-violation.ts`: 100% lines · 81.25% branches
- 14 new tests bring the suite to **227 / 227 passing** (213 prior).
- **Milestone**: detector catalog 20/20 at 100% line coverage. Every drift detector cladding ships now has a dedicated unit-test file. Branch coverage averages ~95% across the catalog — the remaining gaps are nullish defaults and other defensive guards that don't materially change behaviour.
- The `COVERAGE_DROP` warn under `--strict` is still present (63.49% < 70% floor). The detector chapter is closed; v0.2.10+ pivots to **stage runner tests** (`stages/{type,lint,commit,cov,smoke,perf,visual,audit,uat,unit}.ts` all sit at 0% today — the biggest absolute gap left).

### Cumulative coverage progression

| Batch | Detectors covered | Line coverage | Delta |
|---|---|---|---|
| v0.2.5 baseline | 3/20 | 26.8% | — |
| v0.2.6 (batch 1) | 8/20 | 36.36% | +9.5pp |
| v0.2.7 (batch 2) | 10/20 | 49% | +12.6pp |
| v0.2.8 (batch 3) | 15/20 | 58.66% | +9.7pp |
| v0.2.9 (batch 4) | **20/20** | **63.49%** | +4.8pp |

## [0.2.8] — 2026-05-19 — Detector unit tests batch 3 (F-057)

Continuation of the v0.2.6/7 coverage push. Five more detectors gain dedicated `tests/stages/*.test.ts` files at **100% line coverage**. Overall project line coverage rises from **49% → 58.66%** (+9.7pp). After three batches, **15 of 20 detectors are covered at 100%**; cumulative gain from v0.2.5 baseline is **+31.9pp**.

### Added

- `tests/stages/coverage-drop.test.ts` — 6 tests covering artifact absent / coverage above/at/below floor / malformed JSON / missing lines field.
- `tests/stages/performance-drift.test.ts` — 7 tests covering both-files absent / one-side missing / metric regression / within tolerance / multi-metric / division-by-zero guard / malformed JSON.
- `tests/stages/evidence-mismatch.test.ts` — 5 tests covering audit log absent / artifact present / artifact missing / no-artifact note evidence / multi-missing via real `appendEvidence` writes.
- `tests/stages/stale-evidence.test.ts` — 5 tests covering audit log absent / fresh / stale (120 days) / mixed-age filtering / unparseable timestamp with controlled ISO stamps.
- `tests/stages/reference-integrity.test.ts` — 7 tests covering depends_on / superseded_by / scenarios.features cross-references (resolved + broken), multi-broken, and spec-absent.
- `spec/features/F-057.yaml` — "Detector unit tests batch 3" (4 ACs, status `done`).

### Notes

- Coverage per targeted detector (v8 reporter, JSON summary):
  - `coverage-drop.ts`: 100% lines · 100% branches
  - `performance-drift.ts`: 100% lines · 81.8% branches
  - `evidence-mismatch.ts`: 100% lines · 100% branches
  - `stale-evidence.ts`: 100% lines · 100% branches
  - `reference-integrity.ts`: 100% lines · 100% branches
- 30 new tests bring the suite to **213 / 213 passing** (183 prior).
- After this batch, **3 detectors lack dedicated tests**: `hardcoded-secret` (subprocess: `npx secretlint`), `architecture-violation` (subprocess: `madge`), and any future cladding extensions. Both subprocess detectors need richer fixture setup or a stubbed `execaSync` — that's batch 4.
- The `COVERAGE_DROP` warn under `--strict` is still present (58.66% < 70% floor). One more detector batch plus stage-runner tests should clear it.

## [0.2.7] — 2026-05-19 — Detector unit tests batch 2 (F-056)

Continuation of the v0.2.6 coverage push. Five more detectors gain dedicated `tests/stages/*.test.ts` files, each reaching **100% line coverage** on the detector source. Overall project line coverage rises from **36.36% → 49%** in this batch (+12.6pp). After two batches the suite has covered 10 of the 20 detectors at 100%.

### Added

- `tests/stages/convention-drift.test.ts` — 7 tests covering line-header / block-header / bare-module / non-existent / non-TS / multi-feature / spec-absent paths.
- `tests/stages/stale-tests.test.ts` — 7 tests using controlled `utimesSync` stamps to exercise the 30-day mtime boundary, no-tests, no-source, multi-stale, and spec-absent paths.
- `tests/stages/stale-specification.test.ts` — 6 tests covering the three lifecycle-metadata branches (archived_at + status mismatch / superseded_by without archived_at / archived status with surviving modules) plus healthy and spec-absent baselines.
- `tests/stages/harness-integrity.test.ts` — 6 tests covering matching count / divergent count / malformed declaration / plugin.json absent / detectors field absent / index.ts exclusion.
- `tests/stages/meta-integrity.test.ts` — 6 tests covering valid schema / missing required key / missing property declaration / malformed JSON / absent schema / unsupported spec version.
- `spec/features/F-056.yaml` — "Detector unit tests batch 2" (4 ACs, status `done`).

### Notes

- Coverage per targeted detector (v8 reporter, JSON summary):
  - `convention-drift.ts`: 100% lines · 90.9% branches
  - `stale-tests.ts`: 100% lines · 80% branches
  - `stale-specification.ts`: 100% lines · 93.3% branches
  - `harness-integrity.ts`: 100% lines · 100% branches
  - `meta-integrity.ts`: 100% lines · 100% branches
- 32 new tests bring the suite to **183 / 183 passing** (151 prior).
- 7 detectors still lack dedicated tests after this batch: `coverage-drop`, `performance-drift`, `evidence-mismatch`, `stale-evidence`, `hardcoded-secret`, `architecture-violation`, `reference-integrity`. The first four are batch-3 candidates (read-only file probing); the last three need richer subprocess / fixture setup.
- The `COVERAGE_DROP` warn under `--strict` is still present (49% < 70% floor). One more batch should close most of the remainder.

## [0.2.6] — 2026-05-19 — Detector unit tests batch 1 (F-055)

After v0.2.5 the only remaining `clad check --strict` failure was the pre-existing `COVERAGE_DROP warn` (line coverage 26.8% < 70% floor). v0.2.6 starts the honest path to clearing it — real test coverage, not a lower floor. Five detectors gain dedicated `tests/stages/*.test.ts` files, each reaching **100% line coverage** on the detector source. Overall project line coverage rises from **26.8% → 36.36%** in one batch.

### Added

- `tests/stages/unmapped-artifact.test.ts` — 6 tests covering happy / unclaimed / out-of-scope / multi-feature / archived / spec-absent paths.
- `tests/stages/missing-implementation.test.ts` — 7 tests covering present / missing / mixed / no-modules / archived / spec-absent / multi-feature paths.
- `tests/stages/status-drift.test.ts` — 8 tests covering the four lifecycle states (done / in_progress / planned / archived) × module presence, plus the no-modules and spec-absent edge cases.
- `tests/stages/ac-drift.test.ts` — 7 tests covering the structural floor (text-only / EARS-only / neither) and the EARS syntactic check (event-pattern misalignment / ubiquitous null condition) plus multi-AC and spec-absent paths.
- `tests/stages/tech-stack-mismatch.test.ts` — 5 tests covering language agreement / disagreement / unknown manifest, manifest-priority chain (package.json beats pyproject.toml), and spec-absent.
- `spec/features/F-055.yaml` — "Detector unit tests batch 1" (4 ACs, status `done`).

### Notes

- Coverage per targeted detector (v8 reporter, JSON summary):
  - `ac-drift.ts`: 100% lines · 90% branches
  - `missing-implementation.ts`: 100% lines · 100% branches
  - `status-drift.ts`: 100% lines · 100% branches
  - `tech-stack-mismatch.ts`: 100% lines · 100% branches
  - `unmapped-artifact.ts`: 100% lines · 100% branches
- 33 new tests bring the suite to **151 / 151 passing** (118 prior).
- 12 detectors still lack dedicated tests (batch 2 candidates: convention-drift, stale-tests, coverage-drop, performance-drift, evidence-mismatch, stale-evidence, stale-specification, hardcoded-secret, architecture-violation, harness-integrity, reference-integrity, meta-integrity).
- The COVERAGE_DROP warn under `--strict` is still present (36% < 70% floor); cumulative batches will close that gap.

## [0.2.5] — 2026-05-19 — Documentary → runnable promotion batch 1 (F-054)

v0.2.4 introduced 45 documentary fixtures with the explicit promise that future cycles would promote them to runnable conformance entries. v0.2.5 delivers the first batch — 7 documentary fixtures gain real `setup` / `run` bodies in `conformance/runner.ts` and are exercised on every `npm run conformance`. The conformance suite grows from 26/26 to 33/33 matched fixtures.

### Added

- `conformance/runner.ts` — `ExpectedFinding` type and an optional `expectFindings` field on the `Fixture` interface. `runOne` now asserts both `result.pass === expectedPass` AND that every entry in `expectFindings` is present in `result.findings` (with the right detector + severity). Closes the gap where a warn or info finding could not be probed because it does not flip drift's pass/fail.
- 7 runnable fixtures promoted from documentary placeholders:
  - `F-007_AC-011` — Commit stage skip (no `.git`)
  - `F-011_AC-018` — `MISSING_IMPLEMENTATION` info when `spec.yaml` is absent
  - `F-012_AC-020` — `UNMAPPED_ARTIFACT` info when `spec.yaml` is absent
  - `F-013_AC-021` — `TECH_STACK_MISMATCH` warn on language disagreement
  - `F-014_AC-022` — `STATUS_DRIFT` error when a done feature references a missing module
  - `F-014_AC-023` — `STATUS_DRIFT` warn when an in_progress feature has all modules absent
  - `F-019_AC-029` — `AC_DRIFT` error when an AC declares no text and no EARS fields
- `spec/features/F-054.yaml` — "Documentary → runnable promotion (batch 1)" (4 ACs, status `done`).
- `.claude-plugin/plugin.json` — new `conformance.documentary-promoted-batch-1` block records the 7/7 promotion total.

### Changed

- `conformance/fixtures.yaml` — the 7 promoted entries change `kind: documentary` → `kind: runnable`. Descriptions and AC traceability are preserved.
- `tests/conformance/registry.test.ts` — `loadRunnerIds()` regex generalises from `stage_X.Y.{pass,fail}` to also accept `F-NNN_AC-MMM`. Bidirectional sync invariant now covers both naming schemes.

### Notes

- 38 documentary fixtures remain in `conformance/fixtures.yaml` (2 original `missing-implementation` / `missing-tests` plus 36 from v0.2.4). Each is a future batch candidate; promotion order will favour ACs whose setup needs no specialised environment (audit logs, perf baselines, secretlint config).
- `expectFindings` is opt-in. Existing fixtures that only need pass/fail matching are unaffected.

## [0.2.4] — 2026-05-19 — Fixture registry + 56-AC evidence cleanup (F-053)

v0.2.3 split `test_refs` from `evidence_refs` but left 56 of cladding's own `status: done` ACs declaring neither — `MISSING_TESTS` warned on every one, and `--strict` mode failed loudly. v0.2.4 closes that gap by promoting the `fixture:NAME` label from a free-form string into a validated anchor, then using documentary fixtures plus existing tests and doc artifacts to give every AC a real evidence citation. **Result: `MISSING_TESTS` emits zero findings on cladding's own spec; `--strict` mode no longer fails on AC-evidence drift.**

### Added

- `conformance/fixtures.yaml` — single source of truth for every fixture name the self-spec is allowed to cite via `evidence_refs: [fixture:NAME]`. 26 runnable entries (matching the hardcoded fixtures in `conformance/runner.ts`) plus 45 documentary placeholders for ACs whose verification lives in the source or in a paired AC's test.
- `stages/detectors/fixture-reference.ts` (`FIXTURE_REFERENCE_INVALID`) — 20th detector (cladding extension to the upstream Ironclad 19). Scans every `evidence_refs` / `test_refs` entry that starts with `fixture:` and emits a `warn` finding when the name is absent from `conformance/fixtures.yaml`. Opts out silently when the registry file is missing, so user projects that don't adopt the convention aren't punished.
- `tests/stages/fixture-reference.test.ts` — 8 unit tests covering registered/unregistered citations, documentary kind, non-fixture refs, backward-compat with `test_refs`, missing registry, malformed YAML, and status-blind scanning.
- `tests/conformance/registry.test.ts` — 4 invariants on the SSoT: bidirectional sync with `runner.ts`, every entry declares a `kind`, every entry has a unique name.
- `spec/features/F-053.yaml` — "Fixture registry — validated anchor for evidence_refs labels" (6 ACs, status `done`).

### Changed

- `.claude-plugin/plugin.json` — `target.detectors` and `current.detectors` bumped from `19/19` to `20/20`. The 20th is cladding-extension; the Ironclad surface remains 19.
- `stages/detectors/index.ts` — registers `fixtureReference` alongside the upstream 19.
- `stages/detectors/README.md` — catalog row #20 added with a one-paragraph explanation that the cladding-extension diverges from the Ironclad column meanings. The "AC evidence taxonomy" section (added in v0.2.3) is updated to note that `fixture:` citations are now validated.
- `README.md` + `README.ko.md` — headline now reads "3 always-error + 16 conditional + 1 cladding extension" with the 20th detector named.
- `spec/features/F-001.yaml` … `F-047.yaml` — **56 ACs migrated**. 3 wired to existing tests (Bucket B: F-001/AC-002, F-003/AC-005, F-004/AC-006), 10 wired to doc artifacts (Bucket C: agents/*.md, CHANGELOG.md, GOVERNANCE.md, etc.), 43 wired to per-AC documentary fixtures named `F-NNN_AC-MMM` (Bucket A: code-implemented branches without a dedicated test).

### Notes

- The 43 Bucket A entries are honest documentary fixtures, not real conformance tests. Each fixture entry carries the AC's `text` as its `description` so reviewers can grep, and a future cycle (v0.2.5+) can promote individual entries to `kind: runnable` by writing matching setup/run code in `conformance/runner.ts`.
- After this patch, `clad check --strict` still surfaces a pre-existing `COVERAGE_DROP` warn (line coverage 26.8% < 70% floor). That is orthogonal to evidence-drift cleanup; raising coverage is its own cycle.
- `UNTESTED_AC` (the path-resolving sibling detector) remains unchanged — it still only inspects `test_refs`, so the documentary fixtures don't interact with it.

## [0.2.3] — 2026-05-19 — `test_refs` / `evidence_refs` split (F-052)

v0.2.2 reframed the detector headline; this patch fixes the *spec data* underneath it. Cladding's own 50-feature spec was burying npm-script names (`self-dogfood:stage:*`), conformance fixture pointers (`fixture:*`), and doc paths (`*.md`, `docs/*`) inside `test_refs` — making `UNTESTED_AC` skip them via a `self-dogfood:` / `fixture:` prefix dance and obscuring which ACs were actually verified by executable code-tests. v0.2.3 introduces a parallel `evidence_refs` field, migrates the 24 mis-categorised refs across 22 ACs, and teaches `MISSING_TESTS` to count either field as satisfying the verification requirement.

### Added

- `acceptance_criterion.evidence_refs` — schema-level sibling of `test_refs` for non-test verification artifacts (npm scripts, conformance fixtures, curated docs/reports). Documented in `spec/schema.json`, typed in `spec/types.ts`, and described under "AC evidence taxonomy" in `stages/detectors/README.md`.
- `tests/stages/missing-tests.test.ts` — 6 unit tests covering the new four-quadrant decision matrix (neither / test_refs-only / evidence_refs-only / both) plus the status=planned skip case and multi-AC independence.
- `spec/features/F-052.yaml` — "test_refs / evidence_refs split — honest AC verification taxonomy" (4 ACs, status `done`).

### Changed

- `stages/detectors/missing-tests.ts` — silent when *either* `test_refs` or `evidence_refs` is non-empty for a `status: done` AC. Both empty still triggers `warn` (escalates to `error` under `--strict`). Detector message now names both fields.
- `spec/features/F-001.yaml` .. `F-051.yaml` — 22 ACs migrated. Every former `test_refs: [self-dogfood:…]` / `[fixture:…]` / `[*.md]` entry now lives under `evidence_refs`. `test_refs` retains only paths matching `tests/**` or `*.test.*`.
- `stages/detectors/README.md` — new "AC evidence taxonomy" section explains the split and which detector inspects which field.

### Notes

- 56 of cladding's own ACs still have neither `test_refs` nor `evidence_refs` (audited 2026-05-19). These trigger `MISSING_TESTS warn` today; closing them is a v0.2.4+ audit that requires per-AC judgement about which evidence kind actually exists. The current patch fixes the *taxonomy*, not the *coverage*.
- `UNTESTED_AC` (the path-resolving detector) is unchanged. It only inspects `test_refs` because its truth condition is "file exists on disk"; `evidence_refs` entries are deliberately out of its scope.
- The `self-dogfood:` / `fixture:` skip prefixes in `untested-ac.ts` are now dead code for cladding's own spec but kept for backward compatibility with user spec.yaml files mid-migration.

## [0.2.2] — 2026-05-19 — Detector honesty patch

A 2026-05-19 controlled drift-inject experiment (`cladding-abc/08-drift-inject/`) measured cladding's detector set against four scenarios (UNMAPPED_ARTIFACT, MISSING_IMPLEMENTATION, AC_DRIFT, UNTESTED_AC). The result — 2.5/4 catch rate — surfaced that the "19 detectors" headline oversells the bare metal. This patch corrects the framing without changing default behaviour, and adds an opt-in `--strict` mode that promotes warn-severity drift findings to fail the stage.

### Changed

- `README.md` + `README.ko.md` — the detector set is now described as "3 always-error + 16 conditional", with the severity matrix linked. Replaces the previous undifferentiated "19/19" framing.
- `stages/detectors/README.md` — new "Severity reality vs the 19-detectors headline" section names the 3 confidently always-error detectors (`UNMAPPED_ARTIFACT` · `MISSING_IMPLEMENTATION` · `STATUS_DRIFT`) and groups the 16 conditional detectors by what softens them (status-aware · config-dependent · code-anchor-dependent · warn-only · scoped-scan · environment).

### Added

- `clad check --strict` — drift stage promotes warn findings to errors for that invocation. Suited for CI / pre-publish gates. Default `clad check` behaviour is unchanged.
- `stages/drift.ts` — `runDrift({strict?: boolean})`. When `strict` is true, `report.pass` becomes false on any warn finding (in addition to errors).
- `tests/stages/drift.test.ts` — 4 new cases for the strict mode (warn no-fail default, warn-fail strict, error-fail unchanged in strict, info still ignored).
- `spec/features/F-051.yaml` — "Detector severity policy + opt-in strict mode" (5 ACs, status `done`).

### Notes

- The default drift-stage policy stays warn-as-info (per the upstream Ironclad `iron-law.md stage_1.3` contract). `--strict` is the opt-in escalation.
- Two follow-up paths are deferred to v0.2.3+: (a) promoting `MISSING_TESTS` from warn to error for `done` features once cladding's own spec adds `test_refs` to the remaining ACs; (b) `AC_DRIFT` auto-anchoring via `clad sync` so the existing detector logic catches spec-text rewrites. Both are higher-risk patches that need their own design + safety review.

## [0.2.0] — 2026-05-19 — F-049 agent dispatch (machinery complete, transport mocked)

This release closes the "machinery" half of F-049 — the agent-adapter contract, the drive-loop dispatch wiring, the two reserved halt classes — and explicitly defers the real Claude Code / MCP transport bodies to v0.3.0. The architectural decision that unlocks the real transports (cladding adopts an MCP server mode, `clad serve`) is recorded in `docs/multi-provider-roadmap.md`; until then the two host adapters return deterministic mock results so the loop, the parity tests, and the halt classes all exercise the right code paths.

### Added

- `adapters/types.ts` — `AgentAdapter` contract (mode · name · capabilities · `invokeAgent` · `healthCheck`), plus `PersonaSpec` / `AgentContext` / `AgentResult` / `AgentMutation` / `Capability` / `HealthStatus`. Matches F-049 AC-085 (least-context payload) and AC-091 (host adapters require no API key).
- `adapters/host/claude-code.ts` — claude-code host adapter, **mock stage**. Detects the runtime via `CLAUDECODE` / `CLAUDE_CODE_SESSION_ID`. Real Claude Code subagent dispatch lands in the third v0.2.0 PR; the surrounding interface is stable.
- `adapters/host/generic-mcp.ts` — generic-mcp host adapter, **mock stage**. Detects MCP runtime via `MCP_TRANSPORT` / `MCP_SERVER_NAME`. Real MCP transport lands in the third v0.2.0 PR.
- `adapters/index.ts` — `selectAdapter(cwd)` + `resolveSelection(cwd)`. Resolution order: env vars (`CLADDING_AGENT_MODE` / `CLADDING_AGENT_NAME`) → `.cladding/config.yaml` (`agent.mode` / `agent.name`) → auto-detect (`claude-code` when inside Claude Code, otherwise `generic-mcp`). Never throws — always returns an adapter.
- `drive/agent.ts` — `runAgent(persona, ctx, opts)` wrapper. Selects the active adapter, invokes it, writes evidence to the audit log, enforces the reviewer-vs-author barrier (F-049 AC-086) via `ReviewerIdentityCollisionError`.
- `agents/loader.ts` — `loadPersona(id, rootDir?)` reads `agents/<id>.md`, parses the YAML frontmatter for `capabilities:`, returns the prose body as the persona prompt. Cached per file path.
- `tests/adapters/host-parity.test.ts` — 6 cases proving `AgentResult` / `Identity` / `mutations` shape is invariant across both host adapters (F-049 AC-090), plus `healthCheck` auto-detect.
- `tests/drive/agent.test.ts` — 3 cases: dispatch records evidence, reviewer-identity collision throws, reviewer hand-off succeeds when identities differ.

### Changed

- `drive/loop.ts` — rewritten as `async function runDriveLoop`. Per iteration: specialist dispatch via `runAgent` → apply mutations → ensureStub fallback → L1 gates (Type / Lint / Arch) → reviewer dispatch (catches `ReviewerIdentityCollisionError` → `HUMAN_REQUIRED` halt) → UAT (`stage_4.2`) gate (lack of human pass on a `done` feature → `HUMAN_REQUIRED` halt). Adapter errors anywhere in the cycle surface as `LLM_UNAVAILABLE` halts. Five of ten halt classes were "WIRED"; two more (`HUMAN_REQUIRED`, `LLM_UNAVAILABLE`) now emit for real, with `BUDGET_EXCEEDED` / `BLOCKED_FEATURE` / `GATE_NO_PROGRESS` still reserved.
- `cli/clad.ts` `drive` — now `await runDriveLoop(...)`. Soft Shell and `--json` outputs unchanged.
- `spec/features/F-049.yaml` — status remains `in_progress`. `modules:` extended with `drive/loop.ts` and `agents/loader.ts`.

### Architectural decision (transport deferred to v0.3.0)

- The two host adapters still return mock results. Real Claude Code subagent dispatch and real MCP roundtrips need cladding to bridge its single-shot CLI model with the host's long-running session — and the cleanest bridge is an MCP server mode (a new `clad serve` verb) that any MCP-aware host can connect to. That mode lands in v0.3.0; the v0.2.0 mock bodies are deliberate, not "not finished yet."
- The full architectural reasoning, the trade-off table, and the rejected alternatives (direct SDK call, slash-command output) live in `docs/multi-provider-roadmap.md` under "Transport architectural decision."
- `spec/features/F-049.yaml` gains AC-092 ("ship v0.2.0 with mock host adapter bodies and defer the real transport to v0.3.0") so the spec is honest about what shipped.
- No new dependency added; the loader reads `yaml` (already a transitive dep) for persona frontmatter.

## [0.1.6] — 2026-05-19 — Bundled CLI install path

The `clad` CLI now ships as a single esbuild bundle (`dist/clad.js`) so end-user installation is a one-liner with no runtime dev-dependency fetch. Behaviour is unchanged — every verb, every stage, every detector produces the same output as in v0.1.5.

### Added

- `scripts/build.mjs` — esbuild build script that emits `dist/clad.js` (876 KB, ESM, Node ≥ 20). Inlines `spec/schema.json` and copies it next to the bundle so `spec/validate.ts` keeps reading it via the same `readFileSync(join(__dirname, 'schema.json'))` path. Banner sets up a `createRequire` shim for the CommonJS dependencies that get bundled (e.g. `commander`).
- `package.json scripts.build` — runs `node scripts/build.mjs`.
- `package.json scripts.prepare` — auto-builds `dist/clad.js` on `npm install` when the bundle is missing and esbuild is present, so contributors and CI don't have to remember the build step.
- README + README.ko Install section — `npm install -g cladding` + `clad init` for end users; cross-tool note for Claude Code / Codex / Gemini CLI / Cursor / Cline / Continue.

### Changed

- `bin/clad` — now imports `dist/clad.js` directly when present (no `tsx` spawn, no `npx` fetch). Falls back to `tsx cli/clad.ts` when the bundle is absent so the dev loop keeps working without a manual rebuild after every source edit.
- `package.json files` — replaces source-tree paths with `dist/` (the bundle is the published artifact). Keeps `agents/`, `commands/`, `conformance/`, `.claude-plugin/`, `AGENTS.md`, and the standard root markdown.
- `stages/*.ts` (13 files) — the `isCliEntry` guard now also checks `globalThis.__CLADDING_BUNDLED` so the bundled build doesn't auto-fire every stage at startup. The dev path (`tsx stages/<name>.ts` / `npm run stage:<name>`) is unchanged because the flag is only set inside the bundle.
- `AGENTS.md` §2 Setup — separates the end-user install from the contributor install.

### Notes

- `dist/` is gitignored (build artifact, regenerated on every install / publish).
- `npm publish` itself stays deferred per maintainer's release policy — `prepublishOnly` is not yet wired (the `prepare` hook covers the install case; publish-time build will be added at the same time as the first `npm publish`).
- The `npm install -g github:qwerfunch/cladding` path also works: `prepare` runs after the clone and produces `dist/clad.js` (requires `--include=dev` so esbuild is available, which `prepare` would otherwise miss).
- `conformance/` is no longer listed in `package.json files` — it is a contributor self-audit tool that depends on the dev toolchain (`tsc` / `eslint` / `madge` / `secretlint` / `vitest`), none of which the end-user install ships. The L1–L4 conformance claim travels through release notes instead; external implementers verify against the upstream `ironclad-spec` fixtures, not against this runner.

## [0.1.5] — 2026-05-19 — Email hotfix

Security patch. No code change.

### Security

- Replaced a previously-published personal work email with the maintainer's public OSS email (`qwerfunch@gmail.com`) in `CODE_OF_CONDUCT.md` (enforcement contact), `SECURITY.md` (private vulnerability reporting), and the v0.1.1 entry of this CHANGELOG. The work address should not have been published; this patch closes future exposure surfaces.

### Notes

- Git history retains the original text in earlier commits. History rewrite is intentionally out of scope — force-pushing would break the v0.1.1 / v0.1.2 / v0.1.3 / v0.1.4 tag integrity, and the value is already in any third-party clone. Long-term containment lives at the mail-system layer (incoming mail to the old address can be blocked or forwarded — maintainer's action, outside this repo).
- The GitHub Release notes for v0.1.1 are regenerated at v0.1.5 release time so the UI also reflects the new contact.

## [0.1.4] — 2026-05-19 — Intent router precision + multilingual extensibility

`router/intent.ts` rewritten with high-precision, language-tagged patterns. The router still does not call an LLM (per `ironclad-design/03-ux-routing.md` P-11) — the precision change is in *which* prompts land on which verb, not in *how* they are classified.

### Changed

- **Planning intents route to `unknown`, not `drive`.** Previously `"기획 세워줘"`, `"plan it"`, `"planning"`, `"roadmap"`, `"로드맵"` all matched the `drive` rule. They now return `unknown`. Rationale: `drive` means *executing an already-defined plan as a feature group* (one scenario or several features); *making* a plan is librarian-territory and belongs to the host AI tool's natural-language layer, not a fixed CLI verb.
- **Drive rule expanded with execution-shaped keywords.** Added `execute`, `orchestrate`, `kick off` (English) and `실행해`, `진행해`, `돌려줘`, `끌고` (Korean). `drive`, `드라이브` retained.
- **Pattern structure is now language-tagged.** `Rule.patterns: Record<Lang, RegExp[]>` instead of a flat array, so future contributors can add `ja` / `zh` / `es` / others without disturbing existing rules. Each language gets its own test file (`tests/router/intent.<lang>.test.ts`) on contribution.
- **`unknown` semantics documented.** `commands/clad.md` and `AGENTS.md` §6 now state explicitly that `unknown` is not an error — it is the deliberate hand-off to the host AI tool's natural-language layer.

### Added

- `tests/router/intent.test.ts` expanded from 8 to 22 cases: 12 clear-intent (Korean + English × 5 verbs + boundary), 8 ambiguous-or-out-of-vocab returning `unknown`, 2 rule-order invariants.

### Notes

- Patch per `GOVERNANCE.md` §2. No new verb; the five Iron Core verbs (`init` / `work` / `drive` / `sync` / `check`) are unchanged.
- The `unknown` route is the deterministic side of cladding's "host-bound default" policy (F-049 / v0.1.2): cladding's own router stays LLM-free, and the host (Claude Code · OpenAI Codex · Google Gemini CLI · …) handles ambiguous prompts via its existing natural-language layer.

## [0.1.3] — 2026-05-19 — AGENTS.md cross-tool entry point + code-style SSoT

Doc-only patch that exposes Cladding's host-bound + no-API-key policy to the 25+ AI coding tools that read the [agents.md](https://agents.md/) standard — OpenAI Codex, Cursor, Cline, Aider, Continue, GitHub Copilot, Gemini CLI, JetBrains Junie, Windsurf, and others. Claude Code reads the same file; no separate `CLAUDE.md` ships.

### Added

- `AGENTS.md` (root, plain markdown, no frontmatter) — nine sections: project · setup · verify · code & comment style · PR policy · agent personas · multi-host policy · Soft Shell rule · where to look. Light entry pointer; deeper content lives in `docs/`.
- `docs/code-style.md` — single source of truth for code style and comment policy across Cladding. Google Style Guides applied to every language the polyglot toolchain supports (TS · JS · Python · Java · Go · Shell · C++ · Objective-C). For languages without an official Google guide (Rust · PHP · Ruby · Elixir · .NET / C#), pin the most-widely-adopted community style (`rustfmt` · PSR-12 · `mix format` · Microsoft C# conventions). Six explicit comment principles: Why > What · full TSDoc/JSDoc field set · spec linkage (`@see` to feature shards and `ironclad-design/`) · invariant / precondition / assumption when non-obvious · self-documenting code first · forbidden list (TODO, "임시", date-bound, stale-on-edit).

### Changed

- `GOVERNANCE.md` §4.4 footer — points contributors at `docs/code-style.md` for code style and comment policy.
- `agents/specialists.md` Code policy section — replaced the inline TS-only style line with a pointer to `docs/code-style.md`; kept the Cladding-specific "Error as Data" addition.
- `README.md` + `README.ko.md` — one-line pointer to `AGENTS.md` for AI tools.

### Notes

- Patch per `GOVERNANCE.md` §2: docs only, no spec change, no behaviour change.
- `CLAUDE.md` is intentionally not shipped — Cladding is a CLI/library, not a Claude Code plugin scaffold; `AGENTS.md` is the single agent entry point.
- The comment policy applies to new code from this release on. Existing comments are not retro-rewritten; they migrate naturally as the surrounding code is touched.

## [0.1.2] — 2026-05-19 — Soft Shell formatter + F-049 spec generic for multi-provider

Answers two user-facing questions in one patch:

- **Q1**: how much of `ironclad-design/03-ux-routing.md` does cladding actually apply? — raised P-02 / P-05 / P-07 / P-12 from "not yet" to "partial" by introducing a Soft Shell formatter and making business-language output the CLI default.
- **Q2**: can cladding extend to GPT / Gemini and other hosts? — rewrote F-049 spec ACs to describe "agent dispatch (host or sdk)" instead of "Anthropic SDK"; encoded that **host adapters require no API key** (cladding already runs this way under Claude Code's subscription) and SDK adapters are opt-in.

No CLI behaviour regression: every previous output is still available behind `--internal` (`check`, `panel`) or `--json` (`drive`).

### Added

- `ui/softShell.ts` — single conversion layer with `featureLabel(featureId, spec)`, `haltMessage(haltReason, spec)`, `gateLabel(stageId)`. Internal ids translate to business titles for user output; the audit log keeps the raw ids.
- `tests/ui/softShell.test.ts` — 8 cases covering happy path, fallback when title is empty, fallback when feature is missing, all 10 halt classes, feature-id rewriting in halt detail, gate-label translation.
- `docs/ux-routing-coverage.md` — honest tally of the 12 prescriptions from `03-ux-routing.md` with cladding's applied/partial/not-yet state and code anchors. Maintained in lockstep with the underlying behaviour.
- `docs/multi-provider-roadmap.md` — host vs sdk two-mode model, default selection rules, adapter contract sketch, adapter matrix (`claude-code` · `generic-mcp` · `anthropic` · `openai` · `gemini`), how-to-add-a-new-adapter guide.
- F-049 acceptance criteria AC-089 (adapter selection), AC-090 (parity), AC-091 (host adapters require no API key).

### Changed

- `ui/panel.ts` — default `renderPanel(spec)` shows feature titles; pass `{internal: true}` for the legacy `F-NNN` view.
- `cli/clad.ts` — `clad check` shows stage names (`Type` / `Drift` / `UAT`) by default and codes (`stage_1.1` …) under `--internal`. `clad drive` emits a plain `haltMessage` line and a `Touched: …` list by default; the prior JSON dump moves behind `--json`. `clad panel` accepts `--internal`.
- `commands/clad.md` — added an "Output language policy" section documenting the default vs `--internal` / `--json` views.
- `agents/*.md` (5 files) — appended a "User-facing language (Soft Shell)" guideline to every persona; added a `capabilities: [...]` frontmatter line alongside the existing Claude Code `tools:` field so non-Claude-Code hosts can map the persona to their own capability enum.
- `spec/features/F-049.yaml` — rewrote AC-085 and AC-088 to use "agent dispatch (host or sdk)" via the generic `invokeAgent` interface instead of naming the Anthropic SDK directly; new title is "Cladding drive — agent dispatch & runtime orchestration (host or sdk)".

### Notes

- This is a `0.1.x` patch per `GOVERNANCE.md` §2: doc + spec + a formatter, no new stage / detector / verb / persona.
- The actual `adapters/{host,sdk}/*` implementation lands in v0.2.0 stage 1 (host adapters, cost zero) and stage 2 (sdk adapters, opt-in).

## [0.1.1] — 2026-05-19 — Contributor on-ramp

A docs-only patch that turns Cladding from "the maintainer's project that happens to be public" into a project an outside contributor can actually open a first PR against without DM-ing the maintainer. No behavior change in the CLI, no detector logic change.

### Added

- `CONTRIBUTING.md` — fast-path entry point that points at `GOVERNANCE.md` §4 as the canonical contract and gives a 6-step new-contributor checklist.
- `CODE_OF_CONDUCT.md` — [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/) verbatim, with `qwerfunch@gmail.com` as the enforcement contact.
- `SECURITY.md` — private vulnerability-reporting channel, with anti-self-cert-bypass attempts classed as the highest-priority report.
- `.github/PULL_REQUEST_TEMPLATE.md` — transcribes the `GOVERNANCE.md` §4.3 PR contract as a checkbox list, plus a SemVer scope picker.
- `.github/ISSUE_TEMPLATE/bug_report.md` — captures `clad --version`, Node version, OS, active toolchain languages, and the Ironclad spec pin so polyglot reports are reproducible.
- `.github/ISSUE_TEMPLATE/feature_request.md` — proposes versioning scope (patch/minor/major) and self-checks against `GOVERNANCE.md` §4.1 / §4.2.
- `stages/detectors/README.md` — full 19-detector catalog table (axis · default severity · status policy · source file) plus a "when you add a new detector" contract. Names `UNTESTED_AC` and `MISSING_TESTS` as the two intentionally status-aware detectors and the other 17 as status-blind.

### Changed

- `GOVERNANCE.md` §4 — added subsection 4.4 "First PR walkthrough" with a 5-step clone-to-PR path. Points readers at `CONTRIBUTING.md` for style and at `stages/detectors/README.md` for detector conventions.

### Notes

- This is a `0.1.x` patch per the `GOVERNANCE.md` §2 policy (doc + tooling, no observable CLI behavior change).
- v0.2.0 remains the next minor release; its headline epic is F-049 (drive's LLM dispatch + 5-agent runtime).

## [0.1.0] — 2026-05-18 — Ironclad L4 conformant

First public release. Cladding ships every capability `ironclad-design/` planned, in *minimum-viable* form, with **iron-law L4** declared end-to-end on its own codebase.

### Added — Iron Law stages (13/13)

- `stage_1.1` Type — polyglot delegation (TS→tsc · Py→mypy · Rust→cargo check · Go→go vet · …)
- `stage_1.2` Lint — polyglot delegation (TS→eslint · Py→ruff · Rust→clippy · …)
- `stage_1.3` Drift — plug-in registry + aggregator (19 detectors wired)
- `stage_1.4` Commit — language-agnostic `git status --porcelain`
- `stage_1.5` Arch — toolchain chain (TS→madge · Python→lint-imports)
- `stage_1.6` Secret — toolchain chain (TS→secretlint · others→gitleaks)
- `stage_2.1` Unit — toolchain chain (TS→vitest · Py→pytest · …)
- `stage_2.2` Cov — toolchain chain (TS→vitest --coverage · …)
- `stage_3.1` Smoke / `stage_3.2` Perf / `stage_3.3` Visual — project-owned npm scripts
- `stage_4.1` Audit — anti-self-cert guard over audit log
- `stage_4.2` UAT — every `status=done` feature requires human pass evidence

### Added — Drift detectors (19/19)

Spec ↔ Code: `UNMAPPED_ARTIFACT` · `MISSING_IMPLEMENTATION` · `AC_DRIFT` · `TECH_STACK_MISMATCH` · `ARCHITECTURE_VIOLATION` · `CONVENTION_DRIFT`.

Code ↔ Test: `MISSING_TESTS` · `STALE_TESTS` · `COVERAGE_DROP` · `EVIDENCE_MISMATCH` · `HARDCODED_SECRET` · `PERFORMANCE_DRIFT`.

Spec ↔ Test: `UNTESTED_AC` · `STATUS_DRIFT` · `STALE_EVIDENCE` · `STALE_SPECIFICATION`.

Environment: `HARNESS_INTEGRITY` · `REFERENCE_INTEGRITY` · `META_INTEGRITY`.

### Added — SSoT (spec.yaml)

- v0.1 schema (jsonschema draft-07) with EARS-structured acceptance criteria
- Loader auto-detects unsharded vs sharded layout (`spec/features/*.yaml`, `spec/scenarios/*.yaml`, `spec/architecture.yaml`)
- Cladding's own self-spec — 43 features, 69 acceptance criteria, 2 scenarios

### Added — HITL infrastructure

- `hitl/identity.ts` — `EvidenceAuthor` enum (`human` | `llm` | `tool`)
- `hitl/audit.ts` — append-only JSONL audit log at `.cladding/audit.log.jsonl`
- `hitl/anti-self-cert.ts` — guard refuses to clear an AC backed only by tool/LLM evidence

### Added — EARS syntactic validator

- 5 patterns (ubiquitous · event · state · optional · unwanted) with trigger-keyword check
- Folded into AC_DRIFT detector for drift-stage reporting

### Added — Multi-agent orchestrator

- 5 personas (`orchestrator` · `librarian` · `reviewer` · `observability` · `specialists`) as Claude Code subagents
- 5 invocation principles encoded in `agents/orchestrator.md`

### Added — UX / CLI

- `clad` binary (commander-based)
- 5 Iron Core verbs (`init` · `work` · `drive` · `sync` · `check`)
- `clad init` — workspace scaffolder. One command creates `spec.yaml` seed, `.cladding/` runtime dir, and appends `.cladding/` to `.gitignore`. Auto-detects language. Idempotent; `--force` overwrites the seed.
- `clad panel` — feature × stage Integrity Panel
- `clad route <prompt>` — natural-language Intent Router (Korean + English)
- Pulse UI — `tail -f`-friendly status lines

### Added — Token optimizer

- `pruneToFeature(spec, id)` — focus feature + transitive deps
- `suppressPreamble(prompt)` — strip persona boilerplate
- `headTail(text, N, M)` — log shrinkage with elision marker
- `clad benchmark <feature>` — naive vs optimized token comparison

### Added — Conformance suite

- L1 fixtures (12) per `ironclad/conformance/level-1.md`
- L2 fixtures (4) — Unit + Cov × pass/fail
- L3 fixtures (6) — Smoke + Perf + Visual × pass/fail
- L4 fixtures (4) — Audit + UAT × pass/fail
- 26/26 fixtures match expected signal → `iron-law: L4`

### Added — Observability

- `events/log.ts` — append-only lifecycle events at `.cladding/events.log.jsonl`
- `clad benchmark` measured **87.9% token reduction** on F-008

### Added — Polyglot toolchain

- 9 languages: typescript · python · rust · go · java · php · ruby · elixir · dotnet
- Manifest-priority chain; unknown languages return `skipped` (exitCode 2), never false failure

### Added — Spec sharding

- `spec/load.ts` heuristic: master features inline → unsharded · empty master + `spec/features/` dir → sharded merge
- Architecture: master inline OR `spec/architecture.yaml`
- 4 unit tests cover both layouts + inline-wins precedence
- **Cladding's own spec migrated to sharded layout (L21.8)** — 47 features × 1 yaml file each, 2 scenarios × 1 file, 1 architecture file. Master `spec.yaml` shrinks to metadata only. `scripts/shard-spec.ts` ships the one-shot migration any project can reuse when its spec grows past one-file readability.

### Added — Repository hygiene

- `.secretlintignore` excludes `conformance/**` (synthetic secret-shaped strings live there)
- 44 vitest tests (parser, validator, EARS, toolchain, drift registry, anti-self-cert, prune, intent router)

### Conformance

- iron-law: **L4** declared on 2026-05-18 (`conformance/runner.ts` reports 26/26 matched)
- detectors: **19/19**
- stages: **13/13**
- ears: **syntactic**

### Known limitations

- `clad drive` ships as a **deterministic floor** (per [F-048](spec/features/F-048.yaml) AC-083): it iterates ready features in dependency order, materialises module stubs, and runs L1 gates (`type` · `lint` · `arch`). It does **not** invoke an LLM and does **not** dispatch the five agent personas. Real LLM-coordinated authoring lands in v0.2 via [F-049](spec/features/F-049.yaml). The two reserved halt classes `HUMAN_REQUIRED` and `LLM_UNAVAILABLE` (`drive/halt.ts`) are wiring for that work.
- The Iron Law L4 conformance claim above was earned by **human signoff on Cladding's own audit log**. It demonstrates that the L4 *machinery* (anti-self-cert guard, UAT human-pass requirement, reviewer-vs-author identity separation) is correct end-to-end. It does **not** demonstrate that machinery catching an LLM-authored implementation in flight — that stronger qualitative claim arrives with v0.2 + F-049.
- The five agent personas under `agents/*.md` ship as Claude Code subagent definitions and a routing contract. They are **not yet wired** to a runtime orchestrator; `drive/loop.ts` does not call them.

### Repository links

- Ironclad spec pinned to v0.0.23 / commit `883ff01d` / fetched 2026-05-18
- Reference: https://github.com/qwerfunch/ironclad
- Repository: https://github.com/qwerfunch/cladding

[0.2.2]: https://github.com/qwerfunch/cladding/releases/tag/v0.2.2
[0.2.0]: https://github.com/qwerfunch/cladding/releases/tag/v0.2.0
[0.1.6]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.6
[0.1.5]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.5
[0.1.4]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.4
[0.1.3]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.3
[0.1.2]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.2
[0.1.1]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.1
[0.1.0]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.0
