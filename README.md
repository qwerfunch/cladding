# cladding

> What makes code iron-clad.
> Reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard.

[![ironclad](https://img.shields.io/badge/ironclad-L0%20bootstrap-lightgrey)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding is a multi-agent development harness for Claude Code, and the reference implementation of the Ironclad standard for graded, falsifiable consistency among spec, code, and tests. It is the successor to harness-boot — the seed project from which the Ironclad standard was distilled. Where harness-boot proved the idea, Cladding ships it.

## Status

**Cladding's own spec.yaml authored (L5b · T2b).** 10 features · 16 EARS-structured ACs · 2 scenarios · architecture layers — every shipped capability is now documented in the SSoT. This is the input the upcoming T4 Ironclad-native detectors (MISSING_IMPLEMENTATION, AC_DRIFT, UNTESTED_AC, …) will read. Track T1 (L1 stages) closed in L4e — 6/6 stages, 2/19 detectors. Building toward Ironclad L4 (`iron-law: L4, detectors: 19/19, ears: full`) one Lego brick at a time.

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
| L5c-L7 | sharding (T2c) · 17 detectors (T3+T4) · EARS validator (T5) · L1 conformance (T6) | TBD |
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
