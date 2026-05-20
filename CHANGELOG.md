# Changelog

All notable changes to Cladding are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — sentinel-miss telemetry surfaces LLM fallbacks in events.log (F-65814a)

**Silent fallback gets a voice.** v0.3.33–v0.3.35 wired the LLM dispatcher chain plus per-artifact / total fallback behaviour for conventions, architecture, scenarios, project-context, and (v0.3.38) capabilities. Every fallback site was silent — a host whose sampling policy systematically dropped one sentinel would never know, and adopters had no data to tune model / `max_tokens` / temperature against. v0.3.39 makes the misses observable by emitting a structured `sentinel_miss` lifecycle event per fallback to `.cladding/events.log.jsonl`. Configured-no-LLM runs (no dispatcher, greenfield, `--no-llm`) stay silent because they are deliberate offline runs rather than misses.

### Added

- `src/events/log.ts` — `EventType` union grows a `'sentinel_miss'` arm with an inline payload schema (`phase: 'scan_artifacts' | 'project_context'` · `cause: 'blank_section' | 'dispatcher_error'` · `fallback: 'total' | 'per_artifact'` · `missed_sections?: string[]` · `error?: string`)
- `src/cli/scan/llm.ts` — `InterpretedScan` grows a `readonly missedSections: readonly string[]` field; `interpretWithLlm` populates it by inspecting `sections.{conventions,architecture,scenarios,capabilities}` for blank trims; `deterministicInterpret` leaves it `[]` because it never consumed an LLM reply
- `src/cli/scan/llm.ts` — `interpretScanWithFallback(scan, dispatcher, cwd?)` emits in three places: dispatcher throw (`cause: 'dispatcher_error'`, `fallback: 'total'`, truncated `error`); `CONVENTIONS_MD` or `ARCHITECTURE_YAML` blank (`cause: 'blank_section'`, `fallback: 'total'`, `missed_sections`); only non-critical sentinels blank (`cause: 'blank_section'`, `fallback: 'per_artifact'`, `missed_sections`)
- `src/cli/scan/llm.ts` — `renderProjectContextMdWithLlm(ctx, name, dispatcher, cwd?)` emits dispatcher-throw and `WHY` / `WHAT` / `PURPOSE` blank-section events with the same schema under `phase: 'project_context'`
- `src/cli/init.ts` — threads the existing `cwd` variable into both refinement helpers so production calls always reach the telemetry sink while unit tests that omit `cwd` stay silent
- 11 new tests covering each emit site, the configured-no-LLM negatives (no dispatcher, no cwd, greenfield), and the `missedSections` population contract

### Changed

- v0.3.38 entry's stale roadmap counter (`six unreleased capability cycles`) corrected — after PR #121 dated and shipped the v0.3.28–v0.3.37 batch, only the v0.3.38 capability cycle was unreleased; v0.3.39 makes that two unreleased cycles, not seven

### Notes

- 753 + 11 new tests = **764/764** passing; lint clean; typecheck clean
- Telemetry never fails the init flow: `emitSentinelMiss` wraps `appendEvent` in a try/catch so a read-only workspace or transient fs error is swallowed — the artifacts already wrote successfully via `writeArtifact`
- `error` payload field is truncated to 200 characters so an oversized stack trace from a misbehaving dispatcher cannot bloat `events.log.jsonl`
- The configured-no-LLM majority of `clad init` invocations is byte-identical to v0.3.38 — no event written, no behavioural change

### Roadmap

- Release window — two unreleased cycles queued (`v0.3.38` capabilities + `v0.3.39` telemetry); release timing is the maintainer's call
- Future telemetry surfaces: a `clad doctor` verb that summarises `events.log.jsonl` (top missed sentinels, fallback frequency by phase) so adopters get a one-shot health check instead of grep recipes

---

## [Unreleased] — spec/capabilities.yaml LLM extraction from README headings (F-d3bde4)

**README ## headings get a first-class spec mirror.** v0.3.32 surfaced README headings inside `docs/project-context.md`; v0.3.33–v0.3.35 layered LLM refinement on top of conventions, architecture, and project-context. v0.3.38 closes the loop by minting `spec/capabilities.yaml` — the README-derived capability inventory — as its own artifact so downstream detectors and dashboards can read the capability list without re-parsing markdown.

### Added

- `src/cli/scan/llm.ts` — `renderCapabilitiesYaml(headings)` deterministic renderer. Schema `schema: "0.1"` / `source: README.md` / `capabilities: [{id, title}]`; slugifier lowercases, expands `&` → `and`, collapses non-alphanumerics to `-`, and falls back to `capability` when a heading slugifies to empty. Titles are double-quoted with embedded-quote escaping
- `src/cli/scan/llm.ts` — `buildPrompt` grows a fourth `=== CAPABILITIES_YAML ===` sentinel and packs `scan.projectContext?.readmeHeadings` into a labelled prompt block; LLM-refined runs add `summary` + `surface` (feature | platform | tool | infrastructure) per entry while the schema stays forward-compatible with the deterministic body
- `src/cli/scan/llm.ts` — `parseLlmResponse` returns the new `capabilities` section alongside conventions / architecture / scenarios; `InterpretedScan` grows a `capabilitiesYaml: string` field that both `interpretWithLlm` and `deterministicInterpret` populate
- `src/cli/init.ts` — `writeArtifact(cwd, 'spec/capabilities.yaml', interp.capabilitiesYaml, …)` lands directly after the `spec/architecture.yaml` write so the new artifact follows the same created-vs-`.cladding/scan/*.proposal` divert policy when the file already exists
- Per-artifact capabilities fallback: a dispatcher reply that parses but leaves the `CAPABILITIES_YAML` section blank keeps `mode === 'llm'` for conventions + architecture and substitutes `renderCapabilitiesYaml(headings)` for capabilities instead of triggering total fallback

### Changed

- `src/cli/scan/llm.ts` — `renderProjectContextRefined` + `renderProjectContextObserved` swap the "`_Reviewer interprets as capabilities — refine into spec/capabilities.yaml once v0.4 lands._`" placeholder for "`_Mirrored into spec/capabilities.yaml; LLM-refined when a dispatcher is available._`"; the trailing **See also** block now lists the new artifact

### Notes

- 743 + new tests passing; lint clean; typecheck clean
- Deterministic path is byte-stable when `scan.projectContext` is `null` — projects without a README see `capabilities: []` and no other change
- The artifact is auxiliary: `clad sync` continues to load `spec.yaml` as the master and treats `spec/capabilities.yaml` like `spec/architecture.yaml` — present, but not required for the existing detector chain

### Roadmap

- v0.3.39+ — sentinel-miss telemetry surfacing in `events.log` so adopters can tune their host's sampling policy (capabilities fallback now joins conventions/architecture as a per-artifact telemetry source)
- Release window — one unreleased cycle queued post-v0.3.37 (this one); release timing is the maintainer's call

---

## [0.3.37] — 2026-05-20 — README capability headline catches up to develop (F-1c9166)

**Marketing surface had drifted.** Five unreleased cycles (v0.3.32 → v0.3.36) shipped major capabilities — `docs/project-context.md`, the scan LLM dispatcher chain, MCP sampling priority, scan-artifact LLM refinement, the first strict-drift PASS since v0.3.29 — none of which were reflected in `README.md` or `README.ko.md`. External adopters reading either file still saw the v0.3.13 capability inventory. v0.3.37 narrows that gap with a scoped headline refresh.

### Changed

- `README.md` + `README.ko.md` — Status paragraph (line 32) refreshed:
  - Version string `v0.3.13 ships at 589/589 tests` → `v0.3.36 develop ships at 743/743 tests`
  - Five new mid-paragraph capability bullets (project-context · dispatcher chain · MCP sampling · one-dispatcher refinement · strict-drift PASS)
  - Spec layout cell `47 total` → `110 total` (feature count) and the inline `× 87` reference also corrected to `× 110`
  - CLI block grows the `--scan / --no-scan / --no-llm` flags on `clad init` plus a `clad serve` line
- Historic content (Level table L0–L22, Status & roadmap v0.1.0 narrative, Spec Reference pin, Vocabulary, Related) deliberately preserved — those rows are point-in-time conformance snapshots, not running capability state

### Notes

- 743/743 tests passing; lint clean; typecheck clean; `clad sync`: 110 features valid
- No production code touched — pure README + spec hygiene
- The READMEs and `CHANGELOG.md` are now consistent; the next release event (v0.4.0 candidate or v0.3.x → main fast-forward) needs only the version-string sweep, not a capability gap-close

### Roadmap

- v0.3.38+ — LLM-assisted capability extraction (README headings → `spec/capabilities.yaml`)
- v0.3.38+ — sentinel-miss telemetry surfacing in `events.log`
- Release window — five unreleased capability cycles + one hygiene cycle queued; release timing is the maintainer's call

---

## [0.3.36] — 2026-05-20 — drift baseline cleanup — strict-drift is PASS again (F-18e951)

**Hygiene cycle.** After three consecutive LLM-refinement cycles (v0.3.33–v0.3.35) the drift baseline had accumulated 13 error + 1 warn findings — all leftover from the v0.3.29 production-grade scan refactor (855-line `src/cli/scan.ts` → 12 focused modules under `src/cli/scan/`). Five feature shards still pointed at the pre-refactor paths, F-2de65d.AC-004 lacked an explicit `condition` field, and `src/core/` was undeclared in `spec/architecture.yaml`. v0.3.36 fixes all three so `runDrift({strict: true})` reports `pass: true` for the first time since v0.3.29.

### Fixed

- **Five scan-feature shards remapped** onto the post-v0.3.29 module tree:
  - `scan-bfs-walk` → `src/cli/scan/{walker,thresholds}.ts`
  - `scan-conventions` → `src/cli/scan/{conventions,index,llm}.ts` + `src/cli/{init,clad}.ts`
  - `scan-polyglot` → `src/cli/scan/{thresholds,conventions}.ts`
  - `scan-residuals` → `src/cli/scan/{architecture,stats}.ts` + `src/cli/init.ts`
  - `scan-source-roots` → `src/cli/scan/{roots,architecture,llm}.ts` + `src/cli/{init,clad}.ts`
- **F-2de65d.AC-004 (drive-auto-rollback)** — EARS `unwanted` schema requires a `condition:` line starting with "if"; added `condition: if a halt class other than RETRY_THRESHOLD ends the loop` between `ears` and `action`. The text already carried the same conditional phrase, but the AC_DRIFT detector reads the structured field
- **`spec/architecture.yaml` foundation tier** — added `core` alongside spec/agents/events/hitl/optimizer/router/ui. `src/core/checkpoint.ts` + `src/core/postmortem.ts` are foundation utilities that the stage layer wraps

### Notes

- `runDrift({strict: true})` — **18 findings (13 error + 1 warn + 3 info) → 3 findings (all info), `pass: true`**
- The remaining 3 info-severity findings (`PERFORMANCE_DRIFT`, `EVIDENCE_MISMATCH`, `STALE_EVIDENCE`) are opt-in detectors that report "missing audit log artifacts" — baseline state of a project that hasn't run stage_3.2 / stage_4 manually, not real drift
- 743/743 tests passing; lint clean; typecheck clean; sync: 110 features valid
- No production code touched — pure spec-shard hygiene plus one architecture-tier declaration

### Roadmap

- v0.3.37+ — LLM-assisted capability extraction (README headings → `spec/capabilities.yaml`)
- v0.3.37+ — sentinel-miss telemetry surfacing in `events.log`

---

## [0.3.35] — 2026-05-20 — scan artifacts (conventions + architecture) inherit LLM refinement (F-17df0a)

**One dispatcher, every artifact.** v0.3.33 refined `docs/project-context.md`. v0.3.34 wired MCP sampling as Priority 1 of the chain. v0.3.35 extends the same chain to the deeper scan artifacts — `docs/conventions.md` and `spec/architecture.yaml` — so a hosted refinement session touches every cladding-authored markdown in one round-trip, not just the forest-level entry document.

### Added

- `src/cli/scan/llm.ts` — `interpretScanWithFallback(scan, dispatcher)` wraps `interpretWithLlm` with the same deterministic-fallback policy as `renderProjectContextMdWithLlm`: dispatcher-null / throw / empty-section all collapse to `deterministicInterpret(scan)` so the resulting artifacts always carry real observed data
- `src/cli/init.ts` — dispatcher is now selected once at the top of `runInit` and the same instance is threaded into both `interpretScanWithFallback` and `renderProjectContextMdWithLlm`, so a hosted environment makes at most two round-trips per init regardless of which artifacts are written
- 5 new tests covering: dispatcher-null path · LLM success · dispatcher throw · empty-architecture sentinel-miss · header-only conventions sentinel-miss

### Notes

- 738 + 5 new tests = **743/743** passing; lint clean; typecheck clean
- Deterministic path is byte-identical to v0.3.34 — projects without an LLM see no change
- The sentinel-miss guard (`!interp.architectureYaml.trim()`) means a malformed LLM reply collapses to the deterministic body instead of writing a broken `spec/architecture.yaml` — `clad sync` continues to load the file successfully

### Roadmap

- v0.3.36+ — LLM-assisted capability extraction (README headings → `spec/capabilities.yaml`)
- v0.3.36+ — sentinel-miss telemetry surfacing in `events.log` so adopters can tune their host's sampling policy

---

## [0.3.34] — 2026-05-20 — MCP sampling dispatcher closes the chain (F-7fa4a7)

**Hosted refinement, zero credentials.** v0.3.33 left Priority 1 of the dispatcher chain as a stub; v0.3.34 wires it through `server.createMessage`. When `clad serve` runs and a sampling-capable client (Claude Code · Cursor · Continue · …) is connected, the host owns the model + credentials and cladding only relays the prompt. Headless / CI environments keep the Anthropic-SDK direct path as fallback.

### Added

- `src/cli/scan/dispatcher.ts` — `createMcpDispatcher(server)` builds a `(prompt: string) => Promise<string>` adapter that round-trips through the registered `SamplingCapableServer`. `selectDispatcher` Priority 1 now returns this dispatcher whenever `getHostMcpServer()` is non-null
- Non-text reply blocks (image / audio / tool_use) return an empty string so the dispatcher contract is honoured; the caller detects the empty payload through sentinel parsing and collapses to the deterministic body
- 4 new dispatcher tests covering: MCP wins over SDK · prompt passed verbatim · empty-string on non-text reply · `--no-llm` still wins over MCP

### Notes

- 734 + 4 new tests = **738/738** passing; lint clean; typecheck clean
- Deterministic path is byte-identical to v0.3.33 — projects without a connected MCP host and without an API key see no change
- The `model` parameter is *advisory* under MCP sampling — the host's `createMessage` may route to whatever model the user has configured, but the dispatcher contract surfaces the parameter for telemetry symmetry with the Anthropic SDK path

### Roadmap

- v0.3.35+ — extend LLM refinement to `docs/conventions.md` + `spec/architecture.yaml` so the deeper scan artifacts also benefit from the chain (currently `interpretWithLlm` exists but `init.ts` does not call it)
- v0.3.35+ — LLM-assisted capability extraction (README headings → `spec/capabilities.yaml`)

---

## [0.3.33] — 2026-05-20 — scan LLM dispatcher chain + project-context refinement (F-417ff0)

**LLM as enhancement, not fallback.** v0.3.32 shipped the deterministic Why/What/Purpose extractor; v0.3.33 layers LLM refinement on top *when an LLM is reachable*, and collapses to the deterministic body on any failure. The dispatcher selection chain (MCP sampling → Anthropic SDK → null) keeps offline/CI environments fully reproducible while letting hosted environments produce polished prose.

### Added

- `src/cli/scan/dispatcher.ts` (new) — `selectDispatcher(opts)` walks MCP sampling first, then a lazy Anthropic-SDK direct dispatcher when `ANTHROPIC_API_KEY` (or `opts.apiKey`) is set, then `null`. `opts.noLlm` is a hard override that skips both branches
- `src/cli/scan/llm.ts` — three new exports for the project-context refinement path:
  - `buildProjectContextPrompt(ctx, projectName)` — sentinel-labelled prompt (`=== WHY === / === WHAT === / === PURPOSE ===`) with the observed README quote, headings, doc links, and representative interfaces packed underneath
  - `parseProjectContextResponse(text)` — sentinel splitter, missing section → empty string
  - `renderProjectContextMdWithLlm(ctx, projectName, dispatcher)` — async; greenfield + dispatcher-null + any error path all return the deterministic body so the artifact is always usable; refined body keeps the raw README quote underneath the prose for audit
- `src/cli/init.ts` — `runInit` is now `async`, selects a dispatcher once, awaits the refined renderer when available, falls back to the synchronous deterministic renderer otherwise
- `src/cli/clad.ts` — `runInitCommand` awaits `runInit` so `process.exit` fires after the artifacts land
- 13 new tests covering the dispatcher chain (5) and the refinement path (8), including greenfield skip, dispatcher-null, and transport-error fallback

### Notes

- 721 + 13 new tests = **734/734** passing; lint clean; typecheck clean
- Deterministic path is byte-identical to v0.3.32 — projects without an LLM see no change
- Anthropic SDK is `require`d lazily so the cold-start of `clad init` stays fast for the deterministic-only majority
- MCP sampling branch is a registration stub in v0.3.33; v0.3.34 wires `server.createMessage` end-to-end. The SDK path runs in the meantime so projects with an API key already get refinement

### Roadmap

- v0.3.34 — MCP sampling dispatcher (`createMessage` through the registered `clad serve` server)
- v0.3.34+ — LLM-assisted capability extraction (README headings → `spec/capabilities.yaml`)

---

## [0.3.32] — 2026-05-20 — docs/project-context.md forest-level entry document (F-c8aef8)

**Forest before trees.** Every cladding workspace now ships a `docs/project-context.md` — the *Why / What / Purpose* document. Cladding's earlier surface (`docs/conventions.md` + `spec/architecture.yaml` + `spec/scenarios/`) covered code conventions and layers but never the project's *raison d'être*. v0.3.32 fills that gap with deterministic extraction (README + sibling docs + representative interfaces) when observable, a fill-in template otherwise. AI maintainers joining a cladding-managed project always find the *why* first.

### Added

- `src/cli/scan/docs.ts` (new) — four deterministic extractors:
  - `extractReadmeFirstParagraph(cwd)` — skips decorative HTML wrappers + badges, returns prose
  - `extractReadmeHeadings(cwd)` — top-10 `## ` headings in document order
  - `extractDocLinks(cwd)` — ARCHITECTURE/CONTRIBUTING/GOVERNANCE/SECURITY/CODE_OF_CONDUCT + `docs/*.md`, top-5 with first content line quoted
  - `extractInterfaceSignatures(filesByLayer)` — top-2 layers by module count, top-3 `export interface`/`export class` per layer
- `src/cli/scan/types.ts` — `ProjectContext` type + `ScanResult.projectContext: ProjectContext | null`
- `src/cli/scan/llm.ts` — `renderProjectContextMd(ctx, projectName)` renders observed body or template fallback (Why / What / Purpose / Top-level capabilities sections)
- `src/cli/init.ts` — `docs/project-context.md` written on every `clad init` (always). Scan artifact gate (`shouldWriteScanArtifacts`) auto-detects: scan only writes `docs/conventions.md` + `spec/architecture.yaml` + scenarios README when ≥ 3 source files observed or `--scan` forced
- 6 new tests covering README extraction, headings, doc links, interface signatures, absent-README null path, and README-only project
- `clad init --scan` description updated — "auto-detect by default, `--no-scan` to skip"

### Notes

- 715 + 6 new tests = **721/721** passing; lint clean; typecheck clean; drift-green at 105 features; bundle 1.1 MB.
- cobra rescan: project-context.md opens with `> Cobra is a library for creating powerful modern CLI applications.` — HTML wrappers stripped.
- fastapi rescan: same — `> FastAPI framework, high performance, easy to learn, fast to code, ready for production` after HTML strip.
- README-absent / source-absent projects get the template (Why / What / Purpose fill-in sections + Top-level capabilities checkboxes).
- Greenfield + brownfield share the same output path — origin differs (template vs observed), location identical.

### Symmetry

Feature + scenario + capabilities are *miniature-map style*: empty at adoption time, grow as the user requests features. `docs/project-context.md` is *forest-level*: always present, observed when possible, template otherwise. The two halves balance — observable surface auto-extracted, declared intent waits for user request.

### Roadmap

- v0.3.33+ — LLM refinement of Why/Purpose (raw README quote → polished prose)
- v0.3.34+ — `clad_create_feature` auto-registers scenario + capability id (LLM dispatcher chain)
- v0.4+ — `spec/capabilities.yaml` tree (capabilities grow miniature-map style as features request them)

## [0.3.31] — 2026-05-20 — Scan audit P1 deterministic fix — cwd resolve + forbidden prune + non-source blacklist (F-aa7197)

**5차 audit P1 residuals closed.** Three deterministic improvements close the remaining noise the 5차 audit (2026-05-20) flagged in the real-world OSS corpus: cobra's `.` layer-name bug, `forbidden_imports` N×N matrix bloat (ripgrep 195 + vitest 380+ entries), and non-source directories (HomebrewFormula / docs_src / formulas / packaging) surfacing as architecture layers.

### Changed

- **I15** — `src/cli/scan/architecture.ts:groupByLayer` calls `basename(resolve(opts.cwd))` instead of `basename(opts.cwd)`. cobra scanned with `cwd = '.'` now produces the layer name `cobra` (was: `.`).
- **I17** — `src/cli/scan/architecture.ts:extractArchitecture` introduces two prune rules: `FORBIDDEN_TRIVIAL_THRESHOLD = 2` skips layers with ≤ 2 files as both importer and target; `FORBIDDEN_TOP_K = 8` caps per-entry width. ripgrep's forbidden_imports rows drop from 13+ to ≤ 8.
- **I18** — `src/cli/scan/thresholds.ts:LAYER_BLACKLIST` adds `homebrewformula`, `formulas`, `packaging`, `docs_src`, `documentation`, `types`. `scripts` / `tools` intentionally NOT blacklisted (trade-off — some projects keep genuine source there).
- 3 new tests in `tests/cli/scan.test.ts` cover the three fixes plus an updated forbidden_imports fixture that now uses non-trivial layers.

### Notes

- 713 + 2 net new tests = **715/715** passing; lint clean; typecheck clean; drift-green at 105 features; bundle 1.1 MB.
- 16-OSS rescan deltas: cobra `.` → `cobra`; ripgrep loses HomebrewFormula and forbidden_imports rows cap at 8; vitest similarly capped; fastapi loses docs_src (still surfaces `scripts/`, intentional trade-off); cladding self-scan unchanged.
- Audit residuals queued for v0.4+: I16 language-specific export patterns (Python `__all__`, Go `package`, Rust `pub`) — needs language-plugin interface; I7 language-specific test locations.

## [0.3.30] — 2026-05-20 — Scenarios auto-generation deprecated + scenarios/README guide (F-cfba0c)

**Paradigm correction.** The 5차 real-world audit (2026-05-20) flagged dir-derived scenarios as a *false signal* — scenarios encode **user journeys** (intent), not architecture layers (observable code). v0.3.30 drops the auto-extraction. Features and scenarios are now *symmetric*: both describe declared intent, both start empty at adoption time, and both grow as the user requests features through `clad_create_feature`. The intent-side artifacts wait for the user; the observable-side artifacts (`docs/conventions.md` + `spec/architecture.yaml`) keep their auto-extraction.

### Changed

- `src/cli/scan/scenarios.ts` — `proposeScenarios` always returns `[]`. The function signature stays so type and call sites are unaffected; v0.3.31+ feature-time auto-registration can swap the body without re-introducing types.
- `src/cli/scan/llm.ts` — `deterministicInterpret` iterates `scan.scenarios` so its `scenarioFlows` Map naturally drops to empty.
- `src/cli/init.ts` — `--scan` branch no longer writes one YAML per layer. Instead writes a single `spec/scenarios/README.md` documenting the policy: scenarios encode user journeys, not architecture, and they enter the spec through `clad_create_feature`, not scan.
- `tests/cli/scan.test.ts` — `scenarios mirror layers` → `scenarios are not auto-extracted (v0.3.30 paradigm)`. Asserts layers detect normally while scenarios = [].

### Notes

- 713/713 tests pass; lint clean; typecheck clean; drift-green at 103 features; bundle 1.1 MB.
- cobra rescan: `spec/scenarios/` holds **only `README.md`**; cladding self-scan + 16-OSS corpus all conform.
- Mental model alignment: feature + scenario are both miniature-map style. Adoption-time output ships zero scenarios + a placeholder feature; both grow when the user declares intent.

### Roadmap

- v0.3.31+ (큰 작업) — `clad_create_feature` auto-registers the scenario its feature belongs to, using the LLM dispatcher chain.
- v0.4+ — optional `clad scenarios --from-readme` verb for adopters who *want* a guess. Default OFF.

## [0.3.29] — 2026-05-20 — Scan production-grade refactor — src/cli/scan/ module split + configurable thresholds (F-1edb38)

**Production-grade structural refactor**, no behaviour change. v0.3.24~v0.3.28 grew the scan pipeline to a 855-line `scan.ts` + `scan-roots.ts` + `scan-llm.ts` flat trio that became hard to extend. v0.3.29 splits the pipeline into `src/cli/scan/<module>.ts` with a single orchestrator entry — every magic number now overrideable through `ScanOptions`, every analyzer in its own focused file.

### Changed

- `src/cli/scan.ts` (855L) + `src/cli/scan-roots.ts` (266L) + `src/cli/scan-llm.ts` (228L) → `src/cli/scan/{index,types,thresholds,walker,roots,conventions,architecture,examples,stats,scenarios,llm,helpers}.ts` (12 focused modules).
- `src/cli/scan/index.ts` — `scanRoot` orchestrator + public re-exports.
- `src/cli/scan/thresholds.ts` — `DEFAULT_MAX_FILES` / `PER_DIR_SOFT_CAP` / `ROOT_PROMOTION_THRESHOLD` / `DEFAULT_EXTENSIONS` / `DEFAULT_IGNORE` / `LAYER_BLACKLIST` / `ENTRYPOINT_NAMES` / `EXT_TO_LANGUAGE` — all tunable.
- `ScanOptions` gains `layerBlacklist`, `entrypoints`, `perDirCap`, `rootPromotionThreshold` so external adopters override without forking scan internals.
- `src/cli/init.ts` import path → `./scan/index.js`.
- Tests: import paths updated, no test-shape change.

### Notes

- **713/713 tests pass** unchanged; lint clean; typecheck clean; drift-green at 102 features; bundle 1.1 MB.
- cladding self-scan + cobra/react/Signal-Android/django/rails rescan produce identical layer/scenario counts to the v0.3.28 baseline — pure structure change.
- v0.3.30+ follow-ups (scenario auto-generation policy, language plugin interface, LLM dispatcher integration, audit P1 residuals I15/I16/I17/I18) build on this clean base.

## [0.3.28] — 2026-05-20 — Scan BFS walk + entrypoint priority + per-directory soft cap (F-31eeb8)

**4차 audit residual fix (I14).** v0.3.27 left one known hole — react's `compiler/` (1858 files) saturated the DFS walker before it could descend into `packages/`, collapsing the architecture view to a single `compiler` layer. v0.3.28 rewrites the walker around three composable strategies:

1. **BFS queue** — directories visited level by level, siblings sampled before deep subtrees.
2. **Per-directory soft cap** (`PER_DIR_SOFT_CAP = 50`) — once a single directory contributes 50 files, the walker moves on; `maxFiles` stays the absolute hard cap.
3. **Entrypoint priority** — within each directory, conventional entry points (`index.*`, `main.*`, `lib.rs`, `mod.rs`, `__init__.py`, `__main__.py`, `Program.cs`, `Main.java`, `App.kt`) sort to the head so layer identity survives when the soft cap truncates the tail.

### Changed

- `src/cli/scan.ts:walk` — DFS recursion → BFS queue + entrypoint sort + per-directory soft cap. New `ENTRYPOINT_NAMES` set + `isEntrypointFile` predicate.
- 4 new tests in a `walk BFS strategy (v0.3.28)` describe block.
- `.cladding/audit/scan-real-world-2026-05-20.md` — 4차 audit table appended with the v0.3.28 react rescan.

### Notes

- 709 + 4 new tests = **713/713** passing; lint clean; typecheck clean; drift-green at 101 features; bundle 1.1 MB.
- **react rescan: 1 → 11 layers**. compiler + packages + scripts + shared + jest-react + react-devtools + flow-typed + internal-test-utils all visible.
- Other repos in the audit corpus (cobra, ripgrep, django, rails, RxSwiftExt, vuejs/core, vitest) keep their v0.3.27 layer sets — small-tree projects never hit the cap.
- Audit residuals I11/I12/I13/I14 all closed deterministically across v0.3.26~v0.3.28.

## [0.3.27] — 2026-05-20 — Scan deterministic residuals — flat _root promotion + workspace direct files + dominant language (F-aee1da)

**3차 audit residuals fix.** v0.3.26 left three known holes — cobra-style flat single-package returned layer 0, react workspace direct files (packages/react/src/ReactAct.js) lost their layer assignment, and polyglot repos reported `language: typescript` because `detectToolchain` always reads package.json first. v0.3.27 closes all three deterministically. The choice (over LLM fallback) preserves reproducibility and avoids adding an external API dependency to the adoption path.

### Added / Changed

- `src/cli/scan.ts` `groupByLayer` — _root bucket promotion. When 5+ source files live directly at cwd (Go single-package layout), the bucket moves to a layer named after `basename(cwd)`.
- `src/cli/scan.ts` `layerOf` — workspace direct file branch. `packages/<ws>/src/x.ts` with no intermediate subdirectory now surfaces under `<ws>` instead of being skipped.
- `src/cli/scan.ts` `ScanStats` — adds `languageCounts: Record<string, number>` (keyed by normalised language name) and `dominantLanguage: string` via the new `EXT_TO_LANGUAGE` map + `buildStats` helper.
- `src/cli/init.ts` — `runInit` prefers the scan dominant language over `detectToolchain` when `--scan` is set, so django reports python, rails reports ruby, RxSwiftExt reports swift, cobra reports go.
- 7 new scan tests across `flat _root promotion` / `workspace direct files` / `language detection` describe blocks.
- `.cladding/audit/scan-real-world-2026-05-20.md` — 3차 audit table appended with v0.3.27 deltas.

### Notes

- 702 + 7 new tests = **709/709** passing; lint clean; typecheck clean; drift-green at 100 features; bundle 1.1 MB.
- Real-world rescan: cobra 0 → **1 layer + lang=go**, django 1 layer + **lang=python**, rails 6 + **lang=ruby**, RxSwiftExt 1 + **lang=swift**, vuejs/core 17 → **29 layers** (workspace direct files now visible).
- Flat src/ cladding-self regression: byte-identical (no cwd-direct files, no workspaces).
- New residual queued for v0.3.28: react's compiler/ holds 1858 files which exhausts the maxFiles=500 cap before walk reaches packages/. Needs per-directory cap or BFS sampling (I14).

## [0.3.26] — 2026-05-20 — Polyglot scan + layer blacklist + per-language docstrings (F-94dda4)

**P0 fix from the 2026-05-20 real-world OSS audit** (`.cladding/audit/scan-real-world-2026-05-20.md`). v0.3.25 walked only .ts/.js/.py so Go (gin, cobra), Rust (ripgrep), Java/Kotlin (Signal-Android), Ruby (rails), C# / PHP / Swift / Dart projects all produced empty `architecture.yaml`. v0.3.26 closes the language gap and removes the layer noise the audit also surfaced.

### Added / Changed

- `src/cli/scan.ts` `DEFAULT_EXTENSIONS` — now walks .ts/.tsx/.js/.jsx/.mjs/.cjs/.py/**.go/.rs/.java/.kt/.kts/.cs/.rb/.php/.swift**/.ex/.exs/.scala/.dart/.cpp/.cc/.cxx/.hpp/.h. cladding's polyglot 9-language promise is now real.
- `src/cli/scan.ts` `LAYER_BLACKLIST` (new) — peer directories (tests, docs, examples, typings, e2e, integration, __fixtures__, fixtures, benchmark/s, bench, playground/s, demo/s, samples) walked for conventions but excluded from the architecture view. Case-insensitive (matches `Tests/`, `Playground/`).
- `src/cli/scan.ts` `detectDocBlockRatio` + `detectDocTagCounts` — six language families: JS/TS/Java/Kotlin/C++/C#/Scala/Dart (classic `/** */`), Python (triple-quoted + Args:/Returns:/Raises:/Examples:), Go (leading `//` block + godoc `Deprecated:`), Rust (`///` + `# Errors` / `# Safety`), Swift (`///`), Ruby (leading `#` block).
- `tests/cli/scan.test.ts` — 11 new tests across 3 describe blocks (polyglot extensions · layer blacklist · multi-language docblock).
- `.cladding/audit/scan-real-world-2026-05-20.md` — 2차 audit table appended with the v0.3.26 rescan deltas.

### Notes

- 691 + 11 new tests = **702/702** passing; lint clean; typecheck clean; drift-green at 99 features; bundle 1.1 MB.
- Rescan verification: gin 0 → **7 layers**, ripgrep 0 → **6 layers**, Signal-Android 3 layers (Kotlin recognised), rails 6 layers (Ruby + monorepo). Flat-`src/` cladding-self regression: byte-identical.
- OSS reuse review: tree-sitter (polyglot AST) deferred to v0.4+ plugin — wasm/native dependency conflicts with cladding's single-bundle philosophy. dependency-cruiser / linguist-js / semgrep all evaluated and declined; current heuristics + new language matrix carries us until external dogfood signals tree-sitter need.
- Known residuals (queued for v0.3.27): cobra-style flat single-package layer 0; workspace `<ws>/src/*.js` direct files miss layer assignment (react); language detection still package.json-biased so polyglot repos report `language: typescript`.

## [0.3.25] — 2026-05-20 — Scan source-root inference + forbidden_imports candidates (F-c48eb2)

**Closes the `src/`-only limitation in v0.3.24.** External adopters with a TypeScript monorepo, a Python project keeping its package at root, a Go layout (`cmd/` / `internal/` / `pkg/`), or a Rust workspace (`crates/<x>/src/`) all hit the same wall: scan only knew about flat `src/<layer>/`. v0.3.25 introduces manifest-driven source-root inference plus deterministic `forbidden_imports` candidates so the generated `spec/architecture.yaml` no longer ships an empty list.

### Added

- `src/cli/scan-roots.ts` (new) — `inferSourceRoots` reads `package.json#workspaces` (array + `{packages}`), `pyproject.toml` packages list, `Cargo.toml` `[workspace] members` (or single-crate `src/`), and `go.mod` (surfacing `cmd/` + `internal/` + `pkg/`); falls back to directory heuristics (`src/`, `lib/`, `app/`, `pkg/`, `cmd/`, `internal/`, `packages/*/src/`, `apps/*/src/`, `crates/*/src/`). An explicit `--roots a/src,b/src` override skips both phases.
- `src/cli/scan.ts` `layerOf` now takes the inferred `SourceRoot[]` and prefixes monorepo layers with their workspace name (`<workspaceName>:<layer>`) so two workspaces sharing an internal layer name keep distinct identities.
- `src/cli/scan.ts` `extractArchitecture` records every unobserved layer-pair under `forbiddenImportCandidates`; `scan-llm.ts` `renderArchitectureYaml` writes them into `spec/architecture.yaml` `forbidden_imports` lists with a comment noting they are reviewer-pruned candidates.
- `--roots <list>` CLI flag on `clad init` for explicit overrides.
- 13 new scan-roots tests + 5 new scan tests (3 root inference + 2 forbidden candidates) = 18 additions.

### Notes

- 673 + 18 new tests = **691/691** passing; lint clean; typecheck clean; drift-green at 99 features; bundle 1.1 MB.
- Flat-`src/` projects (cladding itself included) keep byte-identical layer names — the v0.3.24 dogfood smoke is unaffected.
- forbidden_imports candidates are coarse — every unobserved pair surfaces — so the comment in architecture.yaml explicitly tells reviewers to prune. v0.3.26 (planned) will let the LLM dispatcher rank them.
- MCP sampling dispatcher integration (originally scoped to v0.3.25) deferred to v0.3.26. Tier-2 audit progress: (#1) Pulse UI v0.3.23, Existing Project v0.3.24, **scan robustness v0.3.25 (this PR)**.

## [0.3.24] — 2026-05-20 — `clad init --scan` observed-conventions extractor (F-9b643e)

**Existing Project 시나리오 도입 (ironclad-design 07-ssot-init §3 B).** External projects adopting cladding no longer face an empty spec.yaml + no conventions doc. A single `clad init --scan` walks the source tree, extracts 14 deterministic convention signals plus representative example modules per layer, and writes three artifacts so AI maintainers can keep the project in the same shape the original authors used — same function signatures, same comment style, same module boilerplate.

### Added

- `src/cli/scan.ts` (new) — deterministic walker + 14-convention extractor (indent, quote, semicolon, naming exports + constants, docblock ratio + tag counts, import order, export pattern, error handling, type-def location, file header pattern, test location, module boilerplate). Picks the longest non-test module per layer as the representative example, paired with its sibling test when present.
- `src/cli/scan-llm.ts` (new) — `buildPrompt` + `parseLlmResponse` + `interpretWithLlm` (LLM path, dispatcher injectable) + `deterministicInterpret` (`--no-llm` fallback). Three labelled sections (`CONVENTIONS_MD` / `ARCHITECTURE_YAML` / `SCENARIO_FLOWS`) so the prompt-shape stays stable across v0.3.24 (deterministic) and v0.3.25 (MCP sampling wiring).
- `src/cli/init.ts` — `--scan` branch writes `docs/conventions.md`, `spec/architecture.yaml`, and one `spec/scenarios/<slug>.yaml` per layer. Existing files divert to `.cladding/scan/<basename>.proposal` instead of overwriting authored content (same propose pattern as v0.3.19 `--propose-archive`).
- `src/cli/clad.ts` — `--scan` and `--no-llm` flags on the `init` subcommand.
- `tests/cli/scan.test.ts` + `tests/cli/scan-llm.test.ts` (new) — 14 convention branches + LLM prompt/response + deterministic fallback + 1 new CLI test for `--scan` + `--no-llm` flow.

### Notes

- v0.3.24 default = deterministic interpreter for `--scan`. The LLM dispatcher injection (specialist persona via MCP sampling) lands in v0.3.25.
- feature 자동 추출 안 함 — scenario placeholder만. feature 는 작업자가 `clad_create_feature` 호출 시 점진 추가 (미니맵 확장식).
- Tier-2 audit progress: (#1) ✓ Pulse UI v0.3.23, (#2) Territory Minimap deferred, **(new) ✓ Existing Project 시나리오 v0.3.24 — 작업 가이드라인 자동 추출**.

## [0.3.23] — 2026-05-20 — Pulse UI progressive in drive loop (F-ba4b7a)

**First Tier-2 audit fix** (ironclad-design 03-ux §4.1). Until v0.3.22 a `clad drive` invocation staring at a slow agent dispatch looked frozen — the terminal sat idle until the next transition emitted a `pulse` line. v0.3.23 introduces an in-place progressive surface so the user sees which phase is running while it runs, without breaking the original `tail -f`-friendly `pulse` contract.

### Added

- `src/ui/pulse.ts` — two new exports: `pulseProgress(stage, label, detail?)` writes a clear-line ANSI sequence + status (no trailing newline) so successive calls overwrite the same TTY row; `pulseProgressEnd(kind, label, detail?)` commits the final transition with a newline. On non-TTY both surfaces are silent until `pulseProgressEnd`, which emits one line equivalent to `pulse` — captured stdout stays a clean append-only stream.
- `src/drive/loop.ts` — emits `pulseProgress('drive', ready.id, …)` for the four phases (specialist · L1 gates · reviewer · UAT) and `pulseProgressEnd('pass'|'fail', …)` on every exit path (happy completion, gate fail with retry counter, reviewer collision, transport failure, UAT, retry-threshold rollback).
- 7 new pulse tests + 2 new drive-loop tests = 9 additions.

### Notes

- 638 + 9 new tests = **647/647** passing; lint clean; typecheck clean; drift-green at 97 features; bundle 1.1 MB.
- Original `pulse` function unchanged — existing CI consumers and `tail -f` workflows see byte-identical output.
- The fail branch's detail string carries the retry counter (`retry N/3`) so the user knows how many attempts remain before auto-rollback.
- `clad check` (13 stage) progressive coverage is a separate patch candidate.

## [0.3.22] — 2026-05-20 — Iron Law backbone Phase 3.3: Librarian post-mortem on auto-rollback (F-5d3ed2)

**Third and final patch** of the Iron Law backbone (ironclad-design 02-iron-law §2.5). v0.3.20 shipped the event surface, v0.3.21 wired the drive loop's auto-rollback, and v0.3.22 closes the loop with a Librarian-authored post-mortem so the next session has a maintainer-readable brief instead of just an audit-log entry.

### Added

- `src/core/postmortem.ts` (new) — `writePostMortem(cwd, ctx)` creates `.cladding/post-mortems/` on demand and writes `post-mortem-<F-id>-<sanitised-ts>.md`. Body captures feature id, last failed gate, retry count, checkpoint git head + spec digest, maintainer-runnable recovery command, and the `librarian` author tag. Two rollbacks of the same feature produce two files (no overwrite).
- `src/drive/loop.ts` — tracks the last failed gate per feature in a `lastFailedGate` Map and, immediately after `recordRollback`, calls `writePostMortem` with the failure context. Skipped when no prior checkpoint exists (defensive, matches the rollback contract).
- 6 new postmortem unit tests + 2 new drive-loop tests = 8 additions.

### Phase 3.3 boundary

Cladding writes the post-mortem to disk but does **not** inject it into the next agent dispatch's context. AgentContext shape changes are a v0.3.x+ follow-up; v0.3.22 keeps the file authoring surface minimal so a maintainer can read it manually without upstream context-injection wiring.

### Notes

- 630 + 8 new tests = **638/638** passing; lint clean; typecheck clean; drift-green at 96 features; bundle 1.1 MB.
- Sanitised timestamp: `2026-05-20T12:34:56.789Z` → filename segment `2026-05-20T12-34-56-789Z` (colon + period replaced).
- No-git-head checkpoint fallback: the recovery block reads `restore spec.yaml manually from VCS history` instead of a `git checkout` command, so the post-mortem stays usable in projects cladding tracked outside a git repo.
- Tier-1 audit complete: (1) ✓ Atomic AC fan-out (v0.3.18), (2) ✓ Phased Decommissioning Tier 2 (v0.3.19), (3.1) ✓ Checkpoint event surface (v0.3.20), (3.2) ✓ Drive auto-rollback (v0.3.21), **(3.3) ✓ Librarian post-mortem (this PR)**. The ironclad-design 02-iron-law §2.5 Iron Law backbone is operational end-to-end.

## [0.3.21] — 2026-05-20 — Iron Law backbone Phase 3.2: drive loop auto-rollback (F-2de65d)

**Second of three patches** completing the Iron Law backbone. v0.3.20 shipped the event surface (`feature_checkpoint`, `feature_rolled_back`) and manual CLI verbs. v0.3.21 hooks the autonomous loop into it: every ready feature gets a checkpoint pinned before the first specialist dispatch, and every `RETRY_THRESHOLD` halt now records a rollback to that feature's latest checkpoint. The Iron Law §2.5 contract ("auto-rollback after self-healing budget exhausted") is now operational on every `clad drive` invocation.

### Changed

- `src/drive/loop.ts` — calls `recordCheckpoint(cwd, ready.id)` immediately after `featuresTouched.push()` and before the specialist agent dispatch.
- `src/drive/loop.ts` — when `checkBudget` returns a `RETRY_THRESHOLD` halt, the loop now locates the exhausted feature in the `retries` map, fetches its latest checkpoint via `findLatestCheckpoint`, and (when non-null) calls `recordRollback` with the reason `"retry budget exhausted after N attempts"`. The halt is then returned via `finish()` so the audit-log order stays checkpoint → drift_detected* → feature_rolled_back → halt.

### Notes

- 626 + 4 new drive-loop tests = **630/630** passing; lint clean; typecheck clean; drift-green at 95 features; bundle 1.1 MB.
- Defensive: when `findLatestCheckpoint` returns null (fresh repo, missing prior checkpoint), the rollback record is skipped so the audit trail never references a checkpoint that never existed.
- Non-RETRY_THRESHOLD halts (MAX_ITERATIONS, WALL_CLOCK, BUDGET_EXCEEDED, transport classes, ALL_FEATURES_DONE) finish without a rollback event — the rollback event is reserved for the one transition that genuinely needs the Iron Law fallback.
- Tier-1 audit progress: (1) ✓ Atomic AC fan-out, (2) ✓ Phased Decommissioning Tier 2, (3.1) ✓ Checkpoint event surface, **(3.2) ✓ Drive auto-rollback (this PR)**, (3.3) Librarian post-mortem queued (v0.3.22).

## [0.3.20] — 2026-05-20 — Iron Law backbone Phase 1: checkpoint event infrastructure (F-c2c996)

**Third Tier-1 audit fix, Phase 1 of 3.** ironclad-design 02-iron-law §2.5 ("Integrity Checkpoint & Rollback") names the Iron Law backbone: every `work` should pin a SSoT + code snapshot, and a failed self-healing cycle should fall back to it. Cladding had **none** of that — the prior conversation grep showed `rollback`/`checkpoint`/`snapshot`/`stash`/`post-mortem` all at zero hits. v0.3.20 lays the *event* surface; later patches (v0.3.21, v0.3.22) hook the drive loop and Librarian post-mortem on top.

### Added

- `src/core/checkpoint.ts` (new) — exposes `recordCheckpoint(cwd, featureId)`, `findLatestCheckpoint(cwd, featureId)`, and `recordRollback(cwd, featureId, target, reason?)`. The checkpoint tuple holds `{featureId, gitHead, specDigest, timestamp}`; `computeSpecDigest` is a deterministic SHA-256 over `spec.yaml` + sorted `spec/features/*.yaml` + sorted `spec/scenarios/*.yaml` contents and relative paths.
- `src/events/log.ts` — `EventType` union grows from 6 to 8 entries with `feature_checkpoint` and `feature_rolled_back`. Existing 6 entries stay in the same order so jsonl consumers do not regress.
- `src/cli/clad.ts` — two new subcommands: `clad checkpoint <featureId>` records and prints the head/digest summary; `clad rollback <featureId> --reason <reason>` records the rollback event and prints the maintainer-runnable `git checkout` for the latest checkpoint. The verb list expands from 8 to 10 in stable insertion order.
- `tests/core/checkpoint.test.ts` (new, 11 unit tests) + 5 new CLI tests covering exit codes, mock dispatch, and the createProgram-verb count.

### Phase 1 boundary

Cladding **does not** execute the actual `git checkout` or spec restore. Branch policy varies — force-with-lease vs reset --hard vs revert commits — and the right choice depends on the working-tree state. v0.3.20 records the transition and surfaces the git command; the maintainer (or, in v0.3.21+, the drive loop) runs it.

### Notes

- 609 + 17 new tests = **626/626** passing; lint clean; typecheck clean; drift-green at 94 features; bundle 1.1 MB.
- Tier-1 audit progress: (1) ✓ Atomic AC fan-out (v0.3.18), (2) ✓ Phased Decommissioning Tier 2 (v0.3.19), **(3) ⚙ Auto-rollback Phase 1 (this PR)**, (3.2) drive-loop auto-rollback queued, (3.3) Librarian post-mortem queued.

## [0.3.19] — 2026-05-20 — Phased Decommissioning Tier 2 (F-b99577)

**Second of three Tier-1 fixes** from the 2026-05-20 ironclad-design audit. `STALE_SPECIFICATION` had been emitting warn-only findings since v0.1.x — the maintainer (or anyone reading `clad check`) saw the noise but the path to fixing it was manual. The structural reason was that `DriftFinding` exposed only `severity` + `message`; there was no field for a machine-actionable remediation hint. v0.3.19 introduces that field (`suggestion`) and uses it to wire the first Phased Decommissioning Tier 2 (ironclad-design 07-ssot-init §5) entry point.

### Added

- `src/stages/types.ts` — new `DriftSuggestion` interface (`{action: string, args?: Record<string, unknown>}`) and optional `suggestion` field on `DriftFinding`. Existing 24 detectors stay unaffected because the field is optional.
- `src/stages/detectors/stale-specification.ts` — emits `propose-archive` suggestions on three lifecycle-inconsistency branches:
  - `archived_at` set with non-archived status
  - `superseded_by` set without `archived_at`
  - **new**: non-final feature (planned/in_progress) whose every declared module has vanished from disk
- `src/cli/clad.ts` — new `clad sync --propose-archive` flag. Runs the detector, filters findings whose `suggestion.action === 'propose-archive'`, prints one Pulse note per candidate with `featureId + reason`, then a summary. Exit 0 either way — the maintainer (or Librarian agent) decides whether to write `archived_at`.
- `src/agents/librarian.md` — explicit Tier 2 responsibility documented: walk `clad sync --propose-archive` candidates, confirm each, write `archived_at + archive_reason`. Never archive silently.
- 5 new STALE_SPECIFICATION tests + 2 new CLI tests = 7 net additions.

### Notes

- 602 + 7 new tests = **609/609** passing; lint clean; typecheck clean; drift-green at 93 features; bundle 1.1 MB.
- The `archived feature with surviving modules` branch deliberately stays unsuggested — removal cadence is project-owned, so the warning surfaces but no automated action is proposed.
- ironclad-design Tier-1 audit recap: (1) ✓ Atomic AC fan-out (v0.3.18), **(2) ✓ Phased Decommissioning Tier 2 (this PR)**, (3) Auto-rollback / Checkpoint (v0.4.0 minor, queued).

## [0.3.18] — 2026-05-20 — Atomic AC evidence fan-out in drive loop (F-12d740)

**Closes the AC-granularity gap in the anti-self-cert guard.** The HITL evidence framework (v0.2.x) added `Evidence.acId` to the schema and `anti-self-cert.checkAc()` filters by `e.acId === acId`, but the drive loop never populated the field — every `clad drive` evidence entry was feature-scoped, so the guard saw only unattributed tool/LLM evidence and could not tell which AC was missing its human-author sign-off. v0.3.18 fans the per-feature L1-pass evidence out into one entry per acceptance criterion, completing the Atomic AC chain (ironclad-design 11-ssot-refinement §4.1 + 02-iron-law §2.4).

### Changed

- `src/drive/loop.ts` — when a feature declares `acceptance_criteria`, the drive loop now calls `appendEvidence` once per AC with `evidence.acId` populated; features without ACs keep the legacy single feature-scoped entry as a fallback (byte-identical audit-log content for them).
- 3 new drive-loop tests cover the fan-out, the fallback, and the `identity.author=tool` invariant (the fan-out increases granularity, not authority — anti-self-cert still requires a separate human evidence on top).

### Notes

- 599 + 3 new tests = **602/602** passing; lint clean; typecheck clean; drift-green at 92 features; bundle 1.1 MB.
- Identity `author=tool, name=clad-drive` stays on every drive-loop evidence — the fan-out is a granularity refinement, not a self-cert loophole.
- ironclad-design audit (2026-05-20) recap — three Tier-1 vision gaps identified: **(1) Atomic AC fan-out (this PR, done)**, (2) Phased Decommissioning Tier 2 (v0.3.x patch, queued), (3) Auto-rollback / Checkpoint (v0.4.0 minor, queued).

## [0.3.17] — 2026-05-20 — Detector-count auto-recompute (F-092)

**Second of two automations** closing the concurrent-modification audit (2026-05-20). `.claude-plugin/plugin.json` declared the drift-detector count in two places (`ironclad.current.detectors` and `ironclad.target.detectors`) as a `N/N` string, and every detector addition required a manual edit there. Two contributors each adding a detector on parallel branches merged cleanly on the filesystem but silently left the count at `(N+1)/(N+1)` instead of `(N+2)/(N+2)` — manual edits don't compose. `HARNESS_INTEGRITY` caught the drift after the fact, but the floor was "trust the maintainer to bump twice". v0.3.17 promotes the filesystem itself to source-of-truth.

### Added

- `scripts/build-plugin.mjs` Phase D — counts non-index `.ts` files under `src/stages/detectors/` and rewrites both `ironclad.current.detectors` and `ironclad.target.detectors` in `.claude-plugin/plugin.json` to the resulting `N/N`. Idempotent (no rewrite when already in sync) so `npm run build:plugin` is safe to run on every commit.
- `tests/scripts/build-plugin-detector-count.test.ts` — 4 unit tests covering drift recompute, idempotency, unrelated-parent immunity (anchored regex), and the index.ts exclusion.
- `spec/features/detector-count-auto-recompute-098d3b.yaml` — F-092 spec (4 ACs, status `done`).

### Changed

- `CLAUDE.md` — the detector-count-bump reminder now says "automated; just rerun `npm run build:plugin`" instead of pointing maintainers at manual edits.

### Notes

- 595 + 4 new tests = **599/599** passing; lint clean; typecheck clean; drift-green at 91 features; bundle 1.1 MB.
- The concurrent-modification audit (2026-05-20) found three high-risk sites: version field (v0.3.15 ✓), detector count (v0.3.17 ✓), CHANGELOG Unreleased-block. The third stays deferred — fragment-directory tooling is over-engineering for a 1-maintainer cadence; revisit when multi-dev signal arrives.

## [0.3.16] — 2026-05-20 — Dogfood recovery + maintainer guide (F-091)

**Restores cladding's own dogfood promise.** User audit caught it: v0.3.9 introduced the hash-based spec ID model (`F-<hash6>` filenames + slug field) for external users, but the cladding maintainer (Claude) authored the next nine spec entries (F-082 ~ F-090) by hand with the legacy sequential format. cladding was recommending one pattern to users while practicing another internally.

### Changed (migration)

- 9 spec/features files renamed from `F-NNN.yaml` to `<slug>-<hash6>.yaml`:
  - `F-082` → `gemini-cli-dogfood-b61449`
  - `F-083` → `claude-code-dogfood-6f80e7`
  - `F-084` → `spec-id-multi-dev-safety-67e33f`
  - `F-085` → `spec-id-hash-filename-and-lookup-24062d`
  - `F-086` → `multidev-integration-test-and-scenario-regex-59f093`
  - `F-087` → `scenario-hash-model-d7312b`
  - `F-088` → `architecture-from-spec-42af48`
  - `F-089` → `external-docs-update-v0-3-13-fcece7`
  - `F-090` → `version-bump-script-6d943d`
- `depends_on` cross-references in 5 other feature files rewritten to point at the new hash ids.
- Legacy `F-001` ~ `F-083.yaml` files (pre-v0.3.9) stay sequential — they're stable audit-log identifiers.

### Added

- `scripts/migrate-dogfood-v0.3.16.mjs` — one-shot migration script, committed as a permanent record of what changed.
- `CLAUDE.md` — maintainer-facing guide. Captures the spec-authoring invariant ("DO NOT hand-create F-NNN.yaml — DO use `<slug>-<hash>.yaml`"), the version-bump-script reminder, the detector-count-bump reminder, and the plugin-mirror caveat. Read by AI assistants when working inside the cladding repo.
- `spec/features/dogfood-recovery-v0-3-16-245bd5.yaml` — F-091 spec authored in the hash format as the first worked example of the new authoring rule.

### Notes

- 595/595 vitest pass (no test code changes); lint clean; typecheck clean; drift-green at 90 features; bundle 1.1 MB.
- The `ID_COLLISION` and `SLUG_CONFLICT` detectors stayed silent through the migration — no inadvertent duplicates introduced.
- v0.3.17 plan: `build-plugin.mjs` auto-recomputes the `ironclad.current.detectors` count so the count-bump reminder in `CLAUDE.md` graduates from manual to automatic.

## [0.3.15] — 2026-05-20 — Atomic version-bump script (F-090)

**First of two automations** addressing the concurrent-modification audit (2026-05-20). Until v0.3.15 the cladding version string lived in **seven separate files** (`package.json`, three host-plugin manifests, `src/cli/clad.ts`, `src/serve/server.ts`, `tests/cli/clad.test.ts`) and every patch cycle a maintainer had to hand-edit each one — error-prone, and two contributors bumping in parallel collided on all seven. v0.3.15 collapses the ritual into a single command.

### Added

- `scripts/version-bump.mjs` — accepts one SemVer argument (major.minor.patch) and atomically updates all seven sites. Per-file summary on stdout, errors on stderr, exit-zero is idempotent. Strict-only validation (rejects pre-release / build-metadata strings).
- `npm run version-bump -- 0.3.16` shortcut in `package.json` scripts.
- `tests/scripts/version-bump.test.ts` — 6 unit tests (happy path, idempotent re-run, invalid SemVer, missing arg, broken anchor in one file).
- `spec/features/F-090.yaml` — "Atomic version-bump script" (5 ACs, status `done`).

### Notes

- 589 + 6 new tests = **595/595** passing; lint clean; typecheck clean; drift-green at 89 features; bundle 1.1 MB.
- v0.3.16 plan: `build-plugin.mjs` auto-recomputes `ironclad.current.detectors` count so the second high-risk concurrent-modification site (silent miscalc when two contributors add detectors in parallel) is also closed.
- The audit's third high-risk site (CHANGELOG.md Unreleased-block collision) stays in the deferred bucket — fragment-directory tooling is over-engineering for a 1-maintainer cadence; revisit when multi-dev signal arrives.

## [0.3.14] — 2026-05-20 — External user docs update (F-089)

**Docs-only patch.** READMEs and `docs/spec-ids-multi-dev.md` had drifted to a v0.3.3 snapshot (capability lines, drift-detector count, feature count, version number) while the code raced ahead to v0.3.13. v0.3.14 brings external-facing docs into alignment so users reading the project for the first time get an accurate snapshot.

### Changed

- `README.md` + `README.ko.md` status lines — version bumped to v0.3.13 · test count 509 → 589 · drift-detector count 20 → 24 (lists all 5 cladding extensions now: `FIXTURE_REFERENCE_INVALID`, `SLUG_CONFLICT`, `ID_COLLISION`, `AC_DUPLICATE_WITHIN_FEATURE`, `ARCHITECTURE_FROM_SPEC`) · feature file count 77 → 87. Two new capability lines added: "multi-developer-safe spec IDs" (hash-based F-/S- ids · slug-prefixed filenames · namespace-aware drift detectors) and "spec/architecture.yaml as working invariant" (ARCHITECTURE_FROM_SPEC detector enforces forbidden_imports + layer alignment).
- `docs/spec-ids-multi-dev.md` extended:
  - Scenario id row added to the short-version table (`S-<hash6>`, feature-symmetric since v0.3.12, separate id namespace from features).
  - "How features and scenarios get created" section now mentions `clad_create_scenario` MCP tool with the natural-language example `"Add a scenario for the checkout happy-path"`.
  - New "spec/architecture.yaml — working invariant since v0.3.13" section documenting the three `ARCHITECTURE_FROM_SPEC` invariants (forbidden_imports compliance, undeclared directory, empty layer) with an example yaml.

### Added

- `spec/features/F-089.yaml` — "External user docs update" (3 ACs, status `done`).

### Notes

- 589/589 vitest pass (no test changes — docs-only); lint clean; typecheck clean; drift-green at 88 features; bundle 1.1 MB.
- This patch closes the user-facing visibility gap opened by the v0.3.4 → v0.3.13 internal velocity. External adopters reading READMEs or the multi-dev guide now see what cladding actually ships at v0.3.13.

## [0.3.13] — 2026-05-20 — ARCHITECTURE_FROM_SPEC detector + cladding self-architecture aligned (F-088)

**Resurrects spec/architecture.yaml from dead code.** Until v0.3.13 the layers and forbidden_imports fields were type-loaded but no detector read them — externally visible as production-grade but actually placeholder. v0.3.13 ships the detector that consumes them, and brings cladding's own architecture file into alignment with the live src/ layout.

### Added

- `src/stages/detectors/architecture-from-spec.ts` — `ARCHITECTURE_FROM_SPEC` drift detector. Enforces three invariants:
  - **forbidden_imports compliance (error)** — regex-greps every `src/<from-layer>/**.ts` for `import ... from` statements; matches the path's segments against the rule's `to` layer; one error per file × rule violation.
  - **undeclared directory (warn)** — any 1-depth directory under `src/` not listed in `spec.architecture.layers`.
  - **empty layer (warn)** — any layer named in `spec.architecture.layers` with no matching `src/<layer>/` directory.
- The detector is **toolchain-agnostic** — no madge / import-linter dependency, regex grep only. Coexists with the existing `ARCHITECTURE_VIOLATION` (toolchain-driven, catches cycles).
- `tests/stages/architecture-from-spec.test.ts` — 10 unit tests covering happy path, all three invariants, soft-validator behaviour, multi-rule violations, external-package import exclusion.
- `spec/features/F-088.yaml` — "ARCHITECTURE_FROM_SPEC detector" (6 ACs, status `done`).

### Changed

- `spec/architecture.yaml` — brought into alignment with the live `src/` layout. Lists all 12 src/ 1-depth directories across **4 dependency tiers**:
  1. **Foundation**: `spec` · `agents` · `events` · `hitl` · `optimizer` · `router` · `ui`
  2. **Stage / adapter**: `stages` · `adapters`
  3. **Runtime**: `drive` · `serve`
  4. **Entry**: `cli`
- 9 forbidden_imports rules forbid backward dependencies (`spec → stages/drive/cli/serve`, `stages → drive/cli/serve`, `adapters → drive/cli/serve`).
- `src/stages/detectors/index.ts` — `allDetectors` now lists 24 detectors (23 → 24).
- `.claude-plugin/plugin.json` `ironclad.current.detectors` bumped `23/23` → `24/24` so HARNESS_INTEGRITY count stays green.

### Notes

- 579 + 10 new tests = **589/589** passing; lint clean; typecheck clean; **drift-green at 87 features with the new detector active**; bundle 1.1 MB.
- The detector caught cladding's own architecture-spec ↔ src/ drift on the first run (12 warnings: 10 undeclared dirs + 2 empty layers). Fixing the spec was the first dogfood proof that the detector works end-to-end.
- External adopters writing `spec/architecture.yaml` now get real cross-checks; previously the same yaml was cosmetic.
- v0.3.x cleanup arc is now genuinely closed: multi-dev ID safety (F-084/85/86/87) + architecture invariant (F-088). No remaining dead-code surfaces in the spec layer.

## [0.3.12] — 2026-05-20 — Scenario hash ID model — true final of the multi-dev arc (F-087)

**Symmetry with features.** v0.3.9 → v0.3.11 closed the multi-developer ID-safety loop for *features* but left *scenarios* on the old sequential model (`S-NNN.yaml`, manual id assignment) — user audit caught this gap. v0.3.12 ports the entire hash-id + slug + multi-dev safety pattern to scenarios.

### Added

- `src/spec/new.ts` — `createScenario({slug, title?, features?, cwd?})` internal helper. Same hash-id model as `createFeature`; the hash input adds a `'scenario'` namespace prefix so a feature and a scenario sharing slug + timestamp produce different hashes.
- `src/serve/server.ts` — new MCP tool **`clad_create_scenario(slug, title?, features?)`**. No CLI verb (same surface boundary as `clad_create_feature`).
- `tests/spec/new-scenario.test.ts` — 6 unit tests covering filename layout, yaml shape, defaults, repeat-call distinctness, slug validation, feature/scenario namespace coexistence.
- `tests/stages/slug-conflict.test.ts` — 2 new cases (two scenarios sharing a slug raises error; feature and scenario sharing a slug does NOT raise — separate namespaces).
- `tests/stages/id-collision.test.ts` — 2 new cases (two scenarios sharing an id raises error; feature F- and scenario S- ids do not collide).
- `tests/serve/server.test.ts` — `clad_create_scenario` MCP tool integration test.
- `spec/features/F-087.yaml` — "Scenario hash ID model — same multi-dev safety as features" (5 ACs, status `done`).

### Changed

- `src/spec/schema.json` — scenario `id` regex widened from `^S-\d{3,}$` to `^S-(\d{3,}|[a-f0-9]{6,})$`; new optional scenario `slug` field with kebab-case regex.
- `src/stages/detectors/slug-conflict.ts` — now walks features and scenarios in separate namespaces. Feature and scenario with the same slug do NOT collide.
- `src/stages/detectors/id-collision.ts` — now walks features and scenarios as separate id namespaces. Error messages name the kind (`feature` vs `scenario`).

### Notes

- 568 + 11 new tests = **579/579** passing; lint clean; typecheck clean; drift-green at 86 features; bundle 1.1 MB.
- **Multi-developer ID-safety arc is now genuinely complete.** Features (F-084 / F-085 / F-086) and scenarios (F-087) both have hash ids, slug filenames, namespace-aware detectors, and integration-test coverage. No remaining sequential ID surfaces in the spec layer.
- `docs/spec-ids-multi-dev.md` (from v0.3.10) covers features only — a follow-up patch could extend the same guidance to scenarios, but the model is identical so the existing doc generalises naturally.

## [0.3.11] — 2026-05-20 — Multi-dev concurrent simulation test + scenario regex widening (F-086)

**Final cycle of the multi-developer ID-safety arc.** Closes the verification loop: an integration test simulates two contributors concurrently calling `createFeature` and asserts the safety invariant end-to-end. A 10-axis ID integrity audit caught one stray legacy regex in scenarios (the only fix from the audit), now also closed.

### Added

- `tests/integration/multi-dev-merge.test.ts` — 4 sub-tests covering:
  - **different slugs** simultaneously → file paths distinct, merge clean, no detector findings
  - **same slug** simultaneously across two cwds → file paths distinct (hash entropy), `ID_COLLISION` silent, `SLUG_CONFLICT` raises one error on the merged spec
  - **same cwd repeat call** with same slug → two distinct files, `SLUG_CONFLICT` raises
  - **three contributors** with distinct slugs → three files merge clean
- `tests/spec/load.test.ts` — regression test: a scenario referencing both `F-001` (legacy) and `F-a3f9c2` (hash) loads without schema rejection.
- `spec/features/F-086.yaml` — "Multi-dev concurrent simulation test + scenario regex widening" (4 ACs, status `done`).

### Changed

- `src/spec/schema.json` — scenario `features[]` items pattern widened from `^F-\d{3,}$` to `^F-(\d{3,}|[a-f0-9]{6,})$` (same as feature.id / depends_on / superseded_by). v0.3.9 missed this single pattern; the v0.3.11 audit caught it.

### Notes

- 563 + 5 new tests = **568/568** passing; lint clean; typecheck clean; drift-green at 85 features; bundle 1.1 MB.
- ID integrity audit covered 10 axes (scenario regex, BR/ADR, references, AC composite, audit log, panel/CLI, detectors, AC scope, slug-hash hyphen, plugin manifests). 9 axes already-compatible from v0.3.9 + v0.3.10; only the scenario regex needed a one-line fix.
- **Multi-developer ID-safety arc complete** (F-084 + F-085 + F-086). cladding ships a documented, audited, integration-tested model for distributed concurrent feature creation. No outstanding items in this thread.

## [0.3.10] — 2026-05-20 — Hash filename + slug-friendly lookup + multi-dev guide (F-085)

**Closes the multi-dev concurrency loop.** v0.3.9 introduced the hash-id model but kept the filename at `<slug>.yaml`, meaning two contributors with the same slug still throw on the second `createFeature` call. v0.3.10 moves the hash into the filename itself (`<slug>-<hash6>.yaml`) so file paths are silently unique by construction across branches, and adds slug-friendly lookup tooling so users don't need to remember hex hashes.

### Added

- `docs/spec-ids-multi-dev.md` — external-adopter guide. Covers identifier layers, the no-CLI invocation flow, six lookup scenarios (just-made, partial slug, recent, exact slug, exact id, project activity), three concurrency scenarios (different slugs, same slug simultaneous, same cwd repeated), legacy F-NNN coexistence, and the do-not-override-id guidance.
- `clad_list_features` MCP tool — new `slugSubstring` (case-insensitive contains-match) + `sort: 'alphabetical' | 'recent'` options. "Recent" ranks by `spec/features/<...>.yaml` mtime newest-first.
- `clad_get_feature` MCP tool — now accepts `id` OR `slug`. When a slug matches multiple features, the response carries a `matches` array; the single-match case returns the bare feature for backward compatibility.
- 4 new unit tests on the MCP tool surface (slugSubstring filter, sort=recent shape, slug lookup, missing-arg error).
- `spec/features/F-085.yaml` — "Hash filename + slug-friendly lookup + multi-dev guide" (5 ACs, status `done`).

### Changed

- `src/spec/new.ts` `createFeature` — filename layout changed from `<slug>.yaml` to `<slug>-<hash6>.yaml` where `<hash6>` is the id's 6-char tail. Two simultaneous calls with the same slug now produce **two distinct files** instead of throwing. Throw remains only for the 1/16M hash-coincidence case (caller can retry).
- `tests/spec/new.test.ts` — "rejects when the <slug>.yaml already exists" case removed; replaced with "two consecutive calls with the same slug produce two distinct files (different hashes)".
- `MINIMAL_SPEC` fixture in `tests/serve/server.test.ts` — added `slug:` fields so the new slug-substring filter is exercised by integration tests.

### Notes

- 559 + 4 new tests = **563/563** passing; lint clean; typecheck clean; drift-green at 84 features; bundle 1.1 MB.
- The semantic conflict (two contributors picking the same slug) is no longer a `createFeature` failure — it's a `SLUG_CONFLICT` detector finding surfaced on the next `clad check --strict`, with human resolution. File-level uniqueness is by construction; semantic intent stays a human decision.
- v0.3.11 plan: `tests/integration/multi-dev-merge.test.ts` — git-worktree simulation that drives the whole loop (two concurrent contributors → merge → drift detector reports no false positive on file path, but raises SLUG_CONFLICT when slug coincides).

## [0.3.9] — 2026-05-20 — Multi-developer-safe spec ID system (F-084)

**Phase 1 of the multi-dev ID safety arc.** Two contributors creating new features simultaneously on separate branches used to collide on `spec/features/F-084.yaml` (same filename) and `AC-259` (globally sequential). This patch introduces a slug-filename + content-hash-id model that makes concurrent feature creation collision-safe by construction.

### Added

- `src/spec/new.ts` — internal `createFeature({slug, title?, status?, cwd?})` helper. Writes `spec/features/<slug>.yaml` with `id: F-<6-hex-hash>` where the hash bundles slug + OS user + hostname + ms timestamp + hrtime so two simultaneous invocations produce different ids by construction. Validates slug shape (`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`); rejects when the file already exists.
- `src/serve/server.ts` — new MCP tool **`clad_create_feature(slug, title?, status?)`** that calls `createFeature`. **No `clad spec new` CLI verb by design** — the user never types a shell command, the host LLM invokes the MCP tool in response to natural-language requests like "add a feature for login-flow".
- Three new drift detectors:
  - `SLUG_CONFLICT` — two features sharing a slug → error.
  - `ID_COLLISION` — two features sharing an id → error (catches the 1/16M hash coincidence and legacy hand-typed duplicates).
  - `AC_DUPLICATE_WITHIN_FEATURE` — same AC id appearing twice inside one feature → error. AC ids are now **feature-scoped**, so `F-001.AC-001` and `F-002.AC-001` coexist freely; only intra-feature duplicates trip the detector.
- 39 new unit tests covering `createFeature` (12), slug-conflict (4), id-collision (5), ac-duplicate-within-feature (6), `clad_create_feature` MCP tool (2). Tests pass: 520 + 39 = **559/559**.
- `spec/features/F-084.yaml` — "Multi-developer-safe spec ID system" (7 ACs, status `done`). First cladding feature authored with a slug-filename and slug field.

### Changed

- `src/spec/schema.json` — `id` regex widened from `^F-\d{3,}$` to `^F-(\d{3,}|[a-f0-9]{6,})$` so both legacy F-NNN and new F-<hash> validate. Same widening for `depends_on` and `superseded_by` references. New optional `slug` field with kebab-case regex.
- `src/stages/detectors/index.ts` — `allDetectors` now lists 23 detectors (20 → 23).
- `.claude-plugin/plugin.json` `ironclad.current.detectors` bumped `20/20` → `23/23` so `HARNESS_INTEGRITY` count check stays green.

### Notes

- 559/559 vitest pass; lint clean; typecheck clean; drift-green at 83 features; bundle 1.1 MB.
- Legacy `F-001 ~ F-083` files and their global `AC-001 ~ AC-258` numbering are untouched. Two models coexist; new features use the new model, old features keep the old.
- The path forward (per the approved plan): v0.3.10 adds the external-user guide doc, v0.3.11 adds a git-worktree-based integration test that simulates two concurrent contributors. v0.4.0 universal generator stays deferred.

## [0.3.8] — 2026-05-20 — Claude Code external-host dogfood report + cross-host parity (F-083)

**Second external-host verification.** Pairs with the v0.3.7 Gemini CLI report so the multi-host claim now rests on two-host evidence, not single-host coincidence. The same four MCP tools round-trip with the same output shape on both hosts.

### Added

- `docs/dogfood/claude-code-2026-05-20.md` — dated dogfood report for Claude Code `2.1.145` running cladding `v0.3.6+`. Same checklist as the Gemini report; all 6 surfaces ✅, 0 cladding-side issues.
- Documents the headless-mode invocation pattern: `--allowedTools mcp__cladding__<tool>` + prompt piped via stdin (the auto-mode classifier blocks `--dangerously-skip-permissions`, and `--allowedTools` as nargs+ swallows a positional prompt).
- States cross-host parity as a verified claim — same 4 MCP tools return the same output shape on Gemini CLI and Claude Code, proving `clad serve` is genuinely host-agnostic.
- Documents the OpenAI Codex CLI deferral honestly: `which codex → not found` on the verifier machine; the cladding-side artifacts (`plugins/codex/` + 11 skills) are present and `HARNESS_INTEGRITY` validates them on every `clad check --strict`, so the cladding side is verification-ready and only host-side execution waits on Codex CLI install.
- `spec/features/F-083.yaml` — "Claude Code external-host dogfood report" (4 ACs, status `done`).

### Notes

- 520/520 vitest pass; lint clean; typecheck clean; drift-green at 82 features; bundle 1.1 MB.
- **0 cladding code changes** triggered by the verification — multi-host plugin rollout holds across two hosts without follow-up.
- Predicate for v0.4.0 generator (drift incident across hosts) — not triggered.
- v0.3.9 plan: Codex CLI dogfood report once the CLI is installed; cycle 3 of the external-host evidence collection.

## [0.3.7] — 2026-05-20 — Gemini CLI external-host dogfood report (F-082)

**First external-host verification of the multi-host plugin rollout.** v0.3.0 → v0.3.6 shipped cladding as a first-class plugin on three agentic CLIs and added the audit detectors; this patch is the first *evidence* that the rollout actually works end-to-end against a real external host.

### Added

- `docs/dogfood/gemini-cli-2026-05-20.md` — dated dogfood report for Gemini CLI `0.42.0` running cladding `v0.3.6`. Sections:
  - **Environment** — host version, auth model (Google account, free tier), install paths.
  - **Setup steps** — `npm link` + symlink commands reproducible by any reviewer.
  - **Checklist results** — 7 surfaces verified (extension load · MCP server auto-spawn · 3 MCP tool calls · persona prompt fetch · 6 skill TOMLs); every surface ✅.
  - **Issues found** — cladding-side: 0. Host-side observations (ripgrep fallback, YOLO mode) are unrelated to cladding.
  - **What this proves / does NOT prove** — explicit scope boundary (host-bound F-049 AC-091 verified · `clad drive` sampling end-to-end NOT yet verified).
  - **Reproduction recipe** — three `gemini -p` invocations a reviewer can replay.
- `spec/features/F-082.yaml` — "Gemini CLI external-host dogfood report" (4 ACs, status `done`).

### Notes

- 520/520 vitest pass; lint clean; typecheck clean; drift-green at 81 features; bundle 1.1 MB.
- **0 cladding code changes** triggered by this verification. The multi-host rollout (v0.3.1 → v0.3.6) holds against an external host without follow-up.
- Predicate for v0.4.0 generator (drift incident) — not triggered: the verification found no manifest drift.
- v0.3.8 plan: Claude Code + Codex dogfood reports as cycle 2 of the external-host evidence collection.

## [0.3.6] — 2026-05-19 — SKILL.md → TOML build-time transpile for Gemini (F-081)

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

## [0.3.5] — 2026-05-19 — HARNESS_INTEGRITY · multi-host manifest schema + version drift (F-080)

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

## [0.3.4] — 2026-05-19 — CLI text + docs cleanup (F-079)

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

## [0.3.3] — 2026-05-19 — Gemini CLI extension (F-078)

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

## [0.3.2] — 2026-05-19 — Codex plugin manifest (F-077)

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

## [0.3.1] — 2026-05-19 — Claude Code plugin formalization (F-076)

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
