<!-- Cladding · Tier C · Derived — observed from code · Refreshed by: clad init --scan -->

# Cladding — Project Conventions

Cladding's existing code-style guide lives at [`docs/code-style.md`](./code-style.md). This document points at it and lists the cladding-specific augmentations applied by `clad init --scan`.

## Style baseline

See [`docs/code-style.md`](./code-style.md) for the canonical style rules. Key points:

| Key | Value |
|---|---|
| Indent | two-space |
| Quote | single |
| Semicolons | present |
| Naming (exports) | camelCase |
| File extensions in imports | `.js` (TypeScript ESM → `.js` at import sites, even from `.ts` sources) |
| Test framework | vitest |
| Lint | eslint |

## Cladding-specific augmentations

These conventions are unique to cladding (not in `code-style.md`):

- **Tier banner on line 1**: Every Tier A/B/C/D artifact opens with `# Cladding · Tier <X> · ...` (YAML) or `<!-- Cladding · Tier <X> · ... -->` (markdown). Personas + tools identify tier via `head -1`.
- **Hash-based feature ids**: New features use `F-<hash6>` (six hex). Generate via `node -e "console.log('F-' + require('node:crypto').randomBytes(3).toString('hex'))"`.
- **Sharded spec**: `spec.yaml` carries `features: []`; per-feature shards live at `spec/features/<slug>-<hash6>.yaml`.
- **No emoji in code or docs unless explicitly requested**.
- **PR commit message**: `feat(F-<hash>): <one-line summary>` for new features; `release(vX.Y.Z): ...` for releases.

## When in doubt

Default to `docs/code-style.md`. When that doc is silent, match the surrounding file's style (`src/cli/init.ts` is a representative example for TypeScript modules; `tests/scenarios/_helpers.ts` for tests).
