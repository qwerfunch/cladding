# cladding

> What makes code iron-clad.
> Reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard.

[![ironclad](https://img.shields.io/badge/ironclad-L4%20conformant-brightgreen)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding is a multi-agent development harness for Claude Code, and the reference implementation of the Ironclad standard for graded, falsifiable consistency among spec, code, and tests. It is the successor to harness-boot — the seed project from which the Ironclad standard was distilled. Where harness-boot proved the idea, Cladding ships it.

> AI tools (Claude Code, OpenAI Codex, Cursor, Cline, Aider, Continue, Copilot, Gemini CLI, …): see [`AGENTS.md`](AGENTS.md) for the cross-tool agent entry point.

## Install

```
npm install -g cladding
```

Then, in any project directory:

```
clad init     # scaffold a cladding workspace
clad check    # run every Iron Law stage + drift suite
clad panel    # see the feature × stage Integrity Panel
```

Same command surface inside Claude Code, OpenAI Codex CLI, Google Gemini CLI, Cursor, Cline, Continue, and any other tool that reads [`AGENTS.md`](AGENTS.md). Requires Node ≥ 20.

## Status

**Ironclad L4 conformant (L21) · self-spec sharded (L21.8) · v0.2.18 ships at 404/404 tests · 93.89% line coverage (whole-codebase scope) · every source dir ≥ 90% · MISSING_TESTS now hard-error · controlled benchmark in docs/benchmarks/.** Cladding ships the full Ironclad surface: 13 Iron Law stages (L1 Type / Lint / Drift / Commit / Arch / Secret · L2 Unit / Cov · L3 Smoke / Perf / Visual · L4 Audit / UAT) — every stage runner carrying a dedicated unit test (stage chapter closed v0.2.12) — plus **20 drift detectors** (3 always-error + 16 conditional + 1 cladding extension `FIXTURE_REFERENCE_INVALID`) all at 100% line coverage (detector chapter closed v0.2.9); severity matrix in [`src/stages/detectors/README.md`](src/stages/detectors/README.md); EARS syntactic validator, HITL infrastructure (identity · audit · anti-self-cert), 5 agent personas, polyglot toolchain for 9 languages, Intent Router, clad CLI, Token Optimizer (87.9% reduction measured), conformance fixtures 33/33 matched (26 baseline + 7 documentary→runnable promotions). Cladding's own spec is sharded (`spec/features/F-NNN.yaml` × 66, `spec/scenarios/S-NNN.yaml` × 2, `spec/architecture.yaml`) — the same layout external adopters get when their spec outgrows a single file.

Each Level adds a verifiable capability:

| Level | Capability | Status |
|---|---|---|
| L0 | Repository skeleton | ✓ |
| L1 | Spec reference pinned (v0.0.23, commit `883ff01`) | ✓ |
| L2 | stage_1.1 Type (TypeScript, self-dogfooded) | ✓ |
| L3 | stage_1.2 Lint (ESLint, self-dogfooded) | ✓ |
| L4a | stage_1.3 Drift core (registry + aggregator, empty) | ✓ |
| L4b | Polyglot toolchain adapter — 9 languages, execa-backed | ✓ |
| L4b' | Detector severity matrix (v0.2.2) — "3 always-error + 16 conditional", not "19 undifferentiated" | ✓ |
| L4c | stage_1.6 Secret + HARDCODED_SECRET detector (1/19) | ✓ |
| L4d | stage_1.4 Commit (git clean tree, language-agnostic) | ✓ |
| L4e | stage_1.5 Arch + ARCHITECTURE_VIOLATION detector (2/19) — **T1 complete** | ✓ |
| L5a | spec.yaml schema + parser + validator (T2a) | ✓ |
| L5b | cladding own spec.yaml (T2b) — 10 features · 16 ACs · 2 scenarios | ✓ |
| L6a | MISSING_IMPLEMENTATION detector (3/19) — first Ironclad-native (T4 kickoff) | ✓ |
| L6b | UNMAPPED_ARTIFACT detector (4/19) — spec ↔ file mirror | ✓ |
| L6c | T4 batch — TECH_STACK_MISMATCH · STATUS_DRIFT · STALE_SPECIFICATION · REFERENCE_INTEGRITY (8/19) | ✓ |
| L6d | T4 integrity batch — HARNESS_INTEGRITY · META_INTEGRITY · AC_DRIFT (11/19) | ✓ |
| L7 | T5 EARS syntactic validator (5 patterns, AC_DRIFT enrichment) | ✓ |
| L8 | T6 L1 conformance fixture suite — **`iron_law: L1` declared** | ✓ |
| L9 | T7a stage_2.1 Unit + MISSING_TESTS + vitest self-dogfood (23 tests) | ✓ |
| L10 | T7b stage_2.2 Cov + STALE_TESTS + COVERAGE_DROP | ✓ |
| L11 | T7c stage_3.1 Smoke + 3.2 Perf + 3.3 Visual + PERFORMANCE_DRIFT | ✓ |
| L12 | T2c Spec sharding (multi-file SSoT support) | ✓ |
| L13 | T8a HITL infrastructure (identity · audit · anti-self-cert) | ✓ |
| L14 | T8b stage_4.1 Audit + 4.2 UAT + EVIDENCE_MISMATCH + STALE_EVIDENCE | ✓ |
| L15 | T9a 5-agent personas (orchestrator · librarian · reviewer · observability · specialists) | ✓ |
| L16 | T9b UNTESTED_AC + CONVENTION_DRIFT — **19/19 detectors** | ✓ |
| L17 | T10a Intent Router (NL → CLI verb) | ✓ |
| L18 | T10b clad CLI + Pulse UI + Integrity Panel | ✓ |
| L19 | T11a Token Optimizer (prune · preamble · tail) | ✓ |
| L20 | T11b events.log + benchmark CLI (87.9% reduction measured on F-008) | ✓ |
| L21 | L2/L3/L4 conformance fixtures — **iron-law L4 declared (26/26 matched)** | ✓ |
| L21.5 | Release preparation (CHANGELOG · README.ko · commands · bin field) | ✓ |
| L22 | v0.1.0 main release | gated on user instruction |

## Evidence

Cladding's headline claim — that an **EARS-locked sharded spec forces edge cases into code, not assumptions** — is backed by a controlled A/B/C benchmark documented in [`docs/benchmarks/event-store-trap-catch.md`](docs/benchmarks/event-store-trap-catch.md).

The benchmark builds the same event-sourcing store three times: once with no scaffolding (vanilla Claude Code), once with harness-boot's gate cycle, and once with cladding's EARS-locked spec. The spec contains **22 normal ACs + 8 intentional ambiguities** ("traps") it deliberately does not pin. Result on the 8 traps:

| variant | trap catch (code) | covered (code + docs) | silent gaps |
|---|---|---|---|
| vanilla | 2/8 (25%) accidental | 2/8 | **6 silent** |
| harness-boot | 2/8 (same code as vanilla) | 7/8 documented | 1 silent |
| **cladding** | **8/8 (100%) explicit** | **8/8** | **0** |

Each cladding trap becomes a first-class EARS `unwanted` or `state` AC (see [`event-store-spec-with-traps.md`](docs/benchmarks/event-store-spec-with-traps.md)), which the implementation then has to satisfy. **+50% source LOC vs vanilla buys zero silent edges.** Full methodology, trap-by-trap matrix, and 8-axis comparison are in the linked benchmark.

## Status & roadmap

**v0.1.0 — what is shipped vs deferred.** Cladding ships the full Ironclad **machinery** today: 13 Iron Law stages, 19 drift detectors, EARS validator, HITL guard, agent persona definitions, conformance fixtures, and the CLI surface. Two scoped deferrals are tracked openly:

| Capability | v0.1.0 state | v0.2.0 epic |
|---|---|---|
| `clad drive` autonomous loop | **deterministic floor** — iterates ready features, materialises module stubs, runs L1 gates (`type` · `lint` · `arch`). No LLM is invoked. See [F-048](spec/features/F-048.yaml) AC-083. | [F-049](spec/features/F-049.yaml) — invoke the five agent personas, enforce reviewer ≠ author at runtime, wire the `HUMAN_REQUIRED` / `LLM_UNAVAILABLE` halt classes. |
| Iron Law L4 in flight | Conformance fixtures 26/26 + human signoff on Cladding's own audit log prove the **L4 machinery** is correct. | Demonstrate the L4 machinery catching an LLM-authored implementation — requires F-049 to land first. |
| Agent persona orchestration | Five subagent prompts ship under `src/agents/*.md`. | Runtime dispatch from `src/drive/loop.ts` (part of F-049). |

The Ironclad standard's v1.0 graduation requires two independent reference implementations passing L1–L4 fixtures ([Ironclad GOVERNANCE](https://github.com/qwerfunch/ironclad/blob/main/GOVERNANCE.md) §1). Cladding's fixture-level conformance counts toward that bar today; the qualitative "L4 catching LLM authoring" claim is a separate v0.2.0 milestone.

## Spec Reference

Cladding implements the Ironclad standard. The exact spec version this codebase targets is pinned in `.claude-plugin/plugin.json`:

```json
"ironclad": {
  "spec-version": "0.0.23",
  "spec-tag": "v0.0.23",
  "spec-commit": "883ff01d0360b7c989fe16214c69a324f049c8cd",
  "spec-url": "https://github.com/qwerfunch/ironclad"
}
```

When the Ironclad spec advances, this pin updates via a deliberate sync step (not auto-follow) — see [`GOVERNANCE.md`](GOVERNANCE.md) §1 for the 5-step sync procedure.

### Spec layout (sharded)

Cladding's own spec uses the sharded layout — one yaml file per feature:

| where | what |
|---|---|
| `spec.yaml` | master · `schema` + `project` metadata only |
| `spec/features/F-NNN.yaml` | one file per feature (47 total) |
| `spec/scenarios/S-NNN.yaml` | one file per scenario (2 total) |
| `spec/architecture.yaml` | layer + forbidden-imports policy |
| `src/spec/schema.json` | JSON Schema (draft-07) |

`src/spec/load.ts` auto-detects this layout and merges children back into one Spec object on every load. To inspect the merged view:

| intent | command |
|---|---|
| validate merged spec | `npm run spec:validate` |
| feature + dependencies (JSON) | `clad benchmark F-NNN` |
| coverage at a glance | `clad panel` |
| raw dump | `cat spec/features/*.yaml` |

Inline-features layout (single `spec.yaml`) also works — `src/spec/load.ts` falls back automatically. New projects start unsharded; `scripts/shard-spec.ts` migrates when the master grows past ~1k lines.

## CLI

```
clad init [--name N] [--force]  # scaffold a cladding workspace (spec.yaml seed · .cladding/ · .gitignore)
clad work <verb>         # run a stage or natural-language intent
clad drive [goal]        # autonomous loop — deterministic floor; LLM dispatch arrives with F-049 in v0.2
clad sync                # validate spec.yaml against schema
clad check               # run every Iron Law stage + drift suite
clad panel               # render the feature × stage Integrity Panel
clad route <prompt>      # classify a natural-language prompt to a verb
clad benchmark <feature> # naive vs optimized spec token cost
```

After install, the `clad` binary is on `PATH` via the `bin` field in `package.json`. During development the shim at `bin/clad` invokes `src/cli/clad.ts` through tsx.

## Vocabulary

- **`ironclad`** — the standard (the agreed-upon result state)
- **`cladding`** — this project (the implementation, the tooling)
- **`clad`** — the CLI verb (the action)

## License

MIT. See [LICENSE](LICENSE).

## Related

- [Ironclad](https://github.com/qwerfunch/ironclad) — the standard this implements
- [harness-boot](https://github.com/qwerfunch/harness-boot) — the seed project (historical reference)
