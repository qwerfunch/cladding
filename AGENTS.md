# AGENTS.md

This file is the cross-tool entry point for any AI coding agent working on cladding (OpenAI Codex, Cursor, Cline, Aider, Continue, GitHub Copilot, Gemini CLI, JetBrains Junie, Windsurf, and the other tools that read the [agents.md](https://agents.md/) standard). Claude Code reads this too — there is no separate CLAUDE.md.

## 1. Project

cladding is the reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard. Multi-agent dev harness; 13 Iron Law stages; 35 drift detectors; polyglot toolchain (9 languages). Successor to harness-boot.

## 2. Setup

End-user install:

```
npm install -g cladding
```

Contributor install (clones the repo and pulls dev dependencies):

```
git clone https://github.com/qwerfunch/cladding && cd cladding && npm install
```

Requires Node ≥ 20.

## 3. Verify before pushing

Run all four. The first three must pass cleanly; the fourth must show 13/13 stages on a clean working tree.

```
npm test
npm run typecheck
npm run lint
node bin/clad check
```

## 4. Code & comment style

Apply [Google Style Guides](https://google.github.io/styleguide/) for every language cladding supports, and the comment policy summarised below. The full per-language table and the six comment principles live in [`docs/code-style.md`](docs/code-style.md) — that's the SSoT; this section is the entry pointer.

Comment policy in one paragraph: *why* over *what*, full doc-tag set on every export (TSDoc / JSDoc / pydoc / rustdoc / godoc / Javadoc), spec linkage via `@see spec/features/F-NNN.yaml AC-NNN` or `@see ironclad-design/<section>.md` whenever a decision traces to an external source, explicit invariants when non-obvious, self-documenting code first, no TODO markers / no date-bound notes / no comments that paraphrase the code.

## 5. PR policy

Branch off `develop`, never `main`. Open the PR against `develop`. The maintainer fast-forwards `main` only at explicit release time. Full contract: `GOVERNANCE.md` §4.3.

## 6. Agent personas

cladding ships five persona definitions under `src/agents/`. **Planning intents** (deciding scope · drafting acceptance criteria · drawing a roadmap) are librarian-territory and surface through natural language to the host AI tool, not through a fixed CLI verb. `clad drive` is for *executing* an already-defined plan as a feature group, not for *making* a plan.

Each file is markdown with a YAML frontmatter that declares two parallel keys:

- `tools:` — the Claude Code subagent tool enum.
- `capabilities:` — the provider-agnostic capability set (`read`, `write`, `edit`, `exec`, `dispatch`).

Non-Claude-Code hosts (Cursor, Cline, Continue, …) should map `capabilities:` onto their own permission model and ignore `tools:`.

## 7. Multi-host policy

cladding does **not** require an API key by default. The default agent dispatch mode is `host` — cladding runs inside the user's existing AI tool (Claude Code with the Max/Pro subscription, Cursor, Cline, Continue, generic-MCP, …) and the host environment handles the LLM call.

SDK adapters (Anthropic / OpenAI / Gemini) read their respective environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) only when explicitly selected via `agent.mode = sdk` in `.cladding/config.yaml` or the `CLADDING_AGENT_MODE` env var. Full roadmap: `docs/multi-provider-roadmap.md`.

## 8. Soft Shell rule

User-facing output uses business language: feature titles ("Login flow"), stage names ("Drift", "UAT"), plain sentences. Internal identifiers (`F-NNN`, `AC-NNN`, `stage_X.Y`, `HUMAN_REQUIRED` and the rest of the halt enum) belong in the audit log and behind `--internal` / `--json` flags.

Convert every internal id at the user surface boundary via `src/ui/softShell.ts`: `featureLabel(featureId, spec)`, `haltMessage(haltReason, spec)`, `gateLabel(stageId)`. Background: `ironclad-design/03-ux-routing.md` §1.2 and `docs/ux-routing-coverage.md`.

## 9. Where to look

- `GOVERNANCE.md` — sync policy, versioning, contributor policy, PR contract, v1.0 graduation criteria.
- `CONTRIBUTING.md` — first-PR walkthrough.
- `CODE_OF_CONDUCT.md`, `SECURITY.md` — community standards + private security reports.
- `docs/code-style.md` — per-language Google Style Guides table + comment policy in full.
- `docs/ux-routing-coverage.md` — applied-status of `ironclad-design/03-ux-routing.md` prescriptions.
- `docs/multi-provider-roadmap.md` — host vs sdk adapter model + adapter matrix + how to add one.
- `src/agents/` — five persona definitions.
- `spec/` — sharded SSoT (features × scenarios × architecture).
- `src/stages/detectors/README.md` — drift detector inventory + status policy.
- `conformance/` — contributor self-audit tool (`npm run conformance` after a dev install). The end-user install does not ship it; the L1–L4 conformance claim travels through release notes instead.
