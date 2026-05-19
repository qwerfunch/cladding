# Changelog

All notable changes to Cladding are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

## [0.2.6] — Unreleased — Detector unit tests batch 1 (F-055)

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

## [0.2.5] — Unreleased — Documentary → runnable promotion batch 1 (F-054)

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

## [0.2.4] — Unreleased — Fixture registry + 56-AC evidence cleanup (F-053)

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

## [0.2.3] — Unreleased — `test_refs` / `evidence_refs` split (F-052)

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

## [0.2.2] — Unreleased — Detector honesty patch

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
