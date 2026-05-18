# cladding

> What makes code iron-clad.
> Reference implementation of the [Ironclad](https://github.com/qwerfunch/ironclad) standard.

[![ironclad](https://img.shields.io/badge/ironclad-L0%20bootstrap-lightgrey)](https://github.com/qwerfunch/ironclad)
[![spec](https://img.shields.io/badge/spec-v0.0.23-blue)](https://github.com/qwerfunch/ironclad)
[![license](https://img.shields.io/badge/license-MIT-lightgrey)](LICENSE)

Cladding is a multi-agent development harness for Claude Code, and the reference implementation of the Ironclad standard for graded, falsifiable consistency among spec, code, and tests. It is the successor to harness-boot — the seed project from which the Ironclad standard was distilled. Where harness-boot proved the idea, Cladding ships it.

## Status

**Spec pinned (L1).** Building toward Ironclad L4 (`iron-law: L4, detectors: 19/19, ears: full`) one Lego brick at a time.

Each Level adds a verifiable capability:

| Level | Capability | Status |
|---|---|---|
| L0 | Repository skeleton | ✓ |
| L1 | Spec reference pinned (v0.0.23, commit `883ff01`) | ✓ |
| L2-L7 | L1 Iron Law conformance (6 stages + 19 detectors) | TBD |
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
