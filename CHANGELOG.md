# Changelog

All notable changes to Cladding are documented here.

Format: [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/).
Versioning: [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).

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

[0.1.5]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.5
[0.1.4]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.4
[0.1.3]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.3
[0.1.2]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.2
[0.1.1]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.1
[0.1.0]: https://github.com/qwerfunch/cladding/releases/tag/v0.1.0
