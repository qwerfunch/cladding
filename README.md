# cladding

> What makes code iron-clad.
> Reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard.

[![ironclad](https://img.shields.io/badge/ironclad-L0%20bootstrap-lightgrey)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding is a multi-agent development harness for Claude Code, and the reference implementation of the Ironclad standard for graded, falsifiable consistency among spec, code, and tests. It is the successor to harness-boot — the seed project from which the Ironclad standard was distilled. Where harness-boot proved the idea, Cladding ships it.

## Status

**T4 integrity batch (L6d).** HARNESS_INTEGRITY (#17), META_INTEGRITY (#19), AC_DRIFT (#3 minimal). Detectors **11/19** — every detector implementable without T7 (stage_2.x) or T9 (LLM) is now wired. Native track T4 at 9/12; OSS-wrap T3 at 2/7. HARNESS_INTEGRITY caught its own circular-import drift during authoring (lazy fix: filesystem-based count instead of `allDetectors` import). Building toward Ironclad L4 (`iron-law: L4, detectors: 19/19, ears: full`) one Lego brick at a time.

Each Level adds a verifiable capability:

| Level | Capability | Status |
|---|---|---|
| L0 | Repository skeleton | ✓ |
| L1 | Spec reference pinned (v0.0.23, commit `883ff01`) | ✓ |
| L2 | stage_1.1 Type (TypeScript, self-dogfooded) | ✓ |
| L3 | stage_1.2 Lint (ESLint, self-dogfooded) | ✓ |
| L4a | stage_1.3 Drift core (registry + aggregator, empty) | ✓ |
| L4b | Polyglot toolchain adapter — 9 languages, execa-backed | ✓ |
| L4c | stage_1.6 Secret + HARDCODED_SECRET detector (1/19) | ✓ |
| L4d | stage_1.4 Commit (git clean tree, language-agnostic) | ✓ |
| L4e | stage_1.5 Arch + ARCHITECTURE_VIOLATION detector (2/19) — **T1 complete** | ✓ |
| L5a | spec.yaml schema + parser + validator (T2a) | ✓ |
| L5b | cladding own spec.yaml (T2b) — 10 features · 16 ACs · 2 scenarios | ✓ |
| L6a | MISSING_IMPLEMENTATION detector (3/19) — first Ironclad-native (T4 kickoff) | ✓ |
| L6b | UNMAPPED_ARTIFACT detector (4/19) — spec ↔ file mirror | ✓ |
| L6c | T4 batch — TECH_STACK_MISMATCH · STATUS_DRIFT · STALE_SPECIFICATION · REFERENCE_INTEGRITY (8/19) | ✓ |
| L6d | T4 integrity batch — HARNESS_INTEGRITY · META_INTEGRITY · AC_DRIFT (11/19) | ✓ |
| L7 | T5 EARS syntactic validator (5 patterns) | TBD |
| L8 | T6 L1 conformance fixture suite + v0.1.0 main release | TBD |
| L9+ | T7/T8/.../T12 (L2/L3/L4 stages · HITL · Agents · CLI · TokenOpt · v1.0 graduation) | TBD |
| L8 | Claude Code adapter (host integration) | TBD |
| L9-L10 | L2 + L3 conformance | TBD |
| L11-L13 | L4 conformance (HITL infrastructure + AI-era barriers) | TBD |
| L14+ | Multi-host, falsifications, autonomous loop | TBD |

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

When the Ironclad spec advances, this pin updates via a deliberate sync step (not auto-follow) — see `GOVERNANCE.md` (TBD) for the sync policy.

## CLI

The Cladding CLI is invoked as `clad`:

```
clad init     # initialize a Cladding workspace
clad work     # run a feature's development cycle
clad drive    # autonomous loop (Ironclad-bounded)
clad sync     # synchronize spec and code
clad check    # run the drift detector catalog
```

Not yet shipped — placeholder until L8.

## Vocabulary

- **`ironclad`** — the standard (the agreed-upon result state)
- **`cladding`** — this project (the implementation, the tooling)
- **`clad`** — the CLI verb (the action)

## License

MIT. See [LICENSE](LICENSE).

## Related

- [Ironclad](https://github.com/qwerfunch/ironclad) — the standard this implements
- [harness-boot](https://github.com/qwerfunch/harness-boot) — the seed project (historical reference)
