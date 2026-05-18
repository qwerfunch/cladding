# AGENTS.md

This file is the cross-tool entry point for any AI coding agent working on cladding (OpenAI Codex, Cursor, Cline, Aider, Continue, GitHub Copilot, Gemini CLI, JetBrains Junie, Windsurf, and the other tools that read the [agents.md](https://agents.md/) standard). Claude Code reads this too — there is no separate CLAUDE.md.

## 1. Project

cladding is the reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard. Multi-agent dev harness; 13 Iron Law stages; 19 drift detectors; polyglot toolchain (9 languages). Successor to harness-boot.

## 2. Setup

```
npm install
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

## 4. Code style

Apply [Google Style Guides](https://google.github.io/styleguide/) per language. For languages without an official Google guide, follow the most-widely-adopted community style.

| language | guide |
|---|---|
| TypeScript / JavaScript | Google TypeScript / JavaScript Style |
| Python | Google Python Style |
| Java | Google Java Style |
| Go | Google Go Style |
| Shell / Bash | Google Shell Style |
| C++ / Objective-C | Google C++ / Objective-C Style |
| Rust | `rustfmt` default + Rust API Guidelines |
| PHP | PSR-12 |
| Ruby | community Ruby Style Guide |
| Elixir | `mix format` default + community style |
| .NET / C# | Microsoft C# coding conventions |

Polyglot toolchain detection lives in `stages/toolchain/detect.ts`.

## 5. Comment style (2026)

Six principles. Apply to source code in every language; doc-strings (TSDoc / JSDoc / pydoc / rustdoc / godoc / Javadoc) use the same principles in the language's native syntax.

1. **Why > What.** Write the intent, the decision rationale, and the constraint. Do not restate what the code already shows.
2. **Use the full documentation field set.** TSDoc / JSDoc and equivalents: `@param`, `@returns`, `@throws`, `@example`, `@see`, `@deprecated`, `@since`, `@internal`. Every exported symbol gets a meaningful doc block.
3. **Spec linkage.** When a decision traces to an external source of truth, cite it: `@see spec/features/F-NNN.yaml AC-NNN`, `@see ironclad-design/<section>.md`, `@see iron-law.md stage_X.Y`. The next agent that patches this code recovers the decision context from these links — this is the AI-era reinforcement.
4. **Invariant / precondition / assumption.** State the non-obvious ones explicitly. Example: *"caller guarantees the cwd is a git repo."* Things a future reader (human or AI) cannot infer from the code alone.
5. **Self-documenting code first.** Meaningful names, short functions, types, enums. Comments fill the gaps those cannot fill.
6. **Forbidden.** TODO markers, "임시" / "tentative", date-bound notes ("last year we…"), comments that paraphrase the code, anything that goes stale on the next edit.

## 6. PR policy

Branch off `develop`, never `main`. Open the PR against `develop`. The maintainer fast-forwards `main` only at explicit release time. Full contract: `GOVERNANCE.md` §4.3.

## 7. Agent personas

cladding ships five persona definitions under `agents/`. Each file is markdown with a YAML frontmatter that declares two parallel keys:

- `tools:` — the Claude Code subagent tool enum.
- `capabilities:` — the provider-agnostic capability set (`read`, `write`, `edit`, `exec`, `dispatch`).

Non-Claude-Code hosts (Cursor, Cline, Continue, …) should map `capabilities:` onto their own permission model and ignore `tools:`.

## 8. Multi-host policy

cladding does **not** require an API key by default. The default agent dispatch mode is `host` — cladding runs inside the user's existing AI tool (Claude Code with the Max/Pro subscription, Cursor, Cline, Continue, generic-MCP, …) and the host environment handles the LLM call.

SDK adapters (Anthropic / OpenAI / Gemini) read their respective environment variable (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`) only when explicitly selected via `agent.mode = sdk` in `.cladding/config.yaml` or the `CLADDING_AGENT_MODE` env var. Full roadmap: `docs/multi-provider-roadmap.md`.

## 9. Soft Shell rule

User-facing output uses business language: feature titles ("Login flow"), stage names ("Drift", "UAT"), plain sentences. Internal identifiers (`F-NNN`, `AC-NNN`, `stage_X.Y`, `HUMAN_REQUIRED` and the rest of the halt enum) belong in the audit log and behind `--internal` / `--json` flags.

Convert every internal id at the user surface boundary via `ui/softShell.ts`: `featureLabel(featureId, spec)`, `haltMessage(haltReason, spec)`, `gateLabel(stageId)`. Background: `ironclad-design/03-ux-routing.md` §1.2 and `docs/ux-routing-coverage.md`.

## 10. Where to look

- `GOVERNANCE.md` — sync policy, versioning, contributor policy, PR contract, v1.0 graduation criteria.
- `CONTRIBUTING.md` — first-PR walkthrough.
- `CODE_OF_CONDUCT.md`, `SECURITY.md` — community standards + private security reports.
- `docs/ux-routing-coverage.md` — applied-status of `ironclad-design/03-ux-routing.md` prescriptions.
- `docs/multi-provider-roadmap.md` — host vs sdk adapter model + adapter matrix + how to add one.
- `agents/` — five persona definitions.
- `spec/` — sharded SSoT (features × scenarios × architecture).
- `stages/detectors/README.md` — drift detector inventory + status policy.
