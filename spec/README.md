---
project: cladding
component: spec
language: typescript
ironclad-tier: T2a (schema + parser + validator)
spec-schema-version: "0.1"
---

# spec

## [CLAIM]

The SSoT (Single Source of Truth) data layer. Defines what a cladding spec.yaml *is*, reads it, and validates it against a JSON Schema. The Ironclad-native drift detectors (T4 + extensions) read from this module — without it they have no input.

## [TIER INDEX]

This directory holds artifacts from two tiers of the [4-tier SSoT model](../docs/ssot-model.md):

| Path | Tier | Authority | Refresh trigger |
|---|---|---|---|
| `spec.yaml` (this file + sharded pointer) | **A** Spec SSoT | sealed by Iron Law gates | `clad_create_feature` MCP tool or hand-edit + `clad sync` |
| `spec/features/<slug>-<hash8>.yaml` | **A** | sealed | `clad_create_feature` |
| `spec/scenarios/<slug>-<hash8>.yaml` | **A** | sealed (onboarding output, edit-friendly) | `clad init <intent>` onboarding (v0.3.45+) + `clad_create_feature` binding |
| `spec/architecture.yaml` | **B** Design SSoT | user-decided, cross-validated with A | `clad init` / `clad refine` (LLM-refined or seeded) |
| `spec/capabilities.yaml` | **B** | user-decided, cross-validated with A | `clad init` / `clad refine` (LLM-refined or seeded) |

Tier A = sealed by detectors (`UNMAPPED_ARTIFACT`, `MISSING_IMPLEMENTATION`, `STATUS_DRIFT`, etc.). Tier B = editable, but every Tier B artifact must have a clear consumer — see [`docs/ssot-model.md`](../docs/ssot-model.md) for the consumer registry and the 4-tier governance policy.

## [IMPLEMENTED]

| file | role |
|---|---|
| `types.ts` | TypeScript interfaces — `Spec`, `Feature`, `AcceptanceCriterion`, `Scenario`, `Architecture`, `Project`, `EarsPattern`, `FeatureStatus` |
| `schema.json` | JSON Schema (draft-07) — single source for both runtime validation and editor IntelliSense |
| `parse.ts` | `parseSpec(path)` — read file, parse YAML, return raw object |
| `validate.ts` | `validateSpec(payload)` + `assertSpec(payload)` — Ajv-style validation via `jsonschema` |
| `cli.ts` | CLI entry — `tsx src/spec/cli.ts [path]` → JSON result, exit 0/1/2 |

## [SHAPE]

```yaml
schema: "0.1"
project:
  name: <string>
  language: <string>
features:
  - id: F-a11ce001                # new IDs use exactly 8 lowercase hex; legacy F-NNN / six-or-more-hex remain readable
    title: <string>
    status: planned | in_progress | done | blocked | archived
    modules: [<path>, ...]
    acceptance_criteria:
      - id: AC-acce5510           # new IDs use exactly 8 lowercase hex; address is criterion:F-a11ce001/AC-acce5510
        ears: ubiquitous | event | state | optional | unwanted | complex
        condition: <EARS Trigger>
        action: <EARS Action>
        response: <EARS Result>
        text: <user-facing rendered sentence>
        test_refs: [<test-id>, ...]
        notes: <free-form>
        adr_refs: [ADR-NNN, ...]
    depends_on: [F-deadbeef, ...] # valid feature IDs; legacy readable IDs are also accepted
    archived_at: <date-time>
    archive_reason: <string>
    superseded_by: F-c0ffee12     # valid feature ID; legacy readable IDs are also accepted
scenarios:           # optional (T2c sharding)
  - id: S-c0ff1e01                # new IDs use exactly 8 lowercase hex; legacy S-NNN / six-or-more-hex remain readable
    title: <string>
    flow: <string>
    features: [F-a11ce001, ...]   # valid feature IDs; legacy readable IDs are also accepted
architecture:        # optional
  layers: [[<layer>, <layer>, ...], ...]
  forbidden_imports:
    - {from: <module>, to: <module>}
```

## [CLI]

```
npm run spec:validate             # validates ./spec.yaml
npx tsx spec/cli.ts <path>        # validates the given path
```

Exit codes: 0 = valid · 1 = invalid (errors[] populated) · 2 = read/parse failure.

## [DEPENDENCIES]

| dep | purpose |
|---|---|
| `yaml` (dev) | YAML 1.2 parser (eemeli/yaml — ESM-friendly, no interop quirks) |
| `jsonschema` (dev) | pure-JS draft-07 validator (chosen over ajv for clean ESM behavior) |

## [WHY EARS IN SCHEMA]

EARS (Easy Approach to Requirements Syntax — five basic patterns: ubiquitous, event, state, optional, unwanted; plus compound/complex) is the way Ironclad keeps feature-scoped acceptance-criterion identifiers (new hash8 or legacy-readable) and Soft Shell (rendered natural-language sentences) coexisting. The schema accepts both `condition`/`action`/`response` triples (for system synthesis) and `text` (pre-rendered for user display). Either fills the AC; both is best.

See: `ironclad-design/11-ssot-refinement-ears.md` · `ironclad/ears.md`.

## [NEXT BRICKS]

- **T2b** — author the cladding's own complete `spec.yaml` (every shipped feature, every AC)
- **T2c** — multi-file sharding: `spec.yaml` (master) + `scenarios/*.yaml` + `features/*.yaml` + `architecture/*.yaml`
- **T4** — the 12 Ironclad-native detectors that read this module (`AC_DRIFT`, `UNTESTED_AC`, `STATUS_DRIFT`, `MISSING_IMPLEMENTATION`, …)
- **T5** — full EARS validator (five basic patterns plus compound/complex syntactic checks on `condition`/`action`/`response` strings)
