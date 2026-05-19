---
project: cladding
component: spec
language: typescript
ironclad-tier: T2a (schema + parser + validator)
spec-schema-version: "0.1"
---

# spec

## [CLAIM]

The SSoT (Single Source of Truth) data layer. Defines what a cladding spec.yaml *is*, reads it, and validates it against a JSON Schema. The 12 Ironclad-native drift detectors (T4) read from this module — without it they have no input.

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
  - id: F-NNN
    title: <string>
    status: planned | in_progress | done | blocked | archived
    modules: [<path>, ...]
    acceptance_criteria:
      - id: AC-NNN
        ears: ubiquitous | event | state | optional | unwanted
        condition: <EARS Trigger>
        action: <EARS Action>
        response: <EARS Result>
        text: <user-facing rendered sentence>
        test_refs: [<test-id>, ...]
        notes: <free-form>
        adr_refs: [ADR-NNN, ...]
    depends_on: [F-NNN, ...]
    archived_at: <date-time>
    archive_reason: <string>
    superseded_by: F-NNN
scenarios:           # optional (T2c sharding)
  - id: S-NNN
    title: <string>
    flow: <string>
    features: [F-NNN, ...]
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

EARS (Easy Approach to Requirements Syntax — 5 patterns: ubiquitous, event, state, optional, unwanted) is the way Ironclad keeps Iron Core (`AC-001` ids) and Soft Shell (rendered natural-language sentences) coexisting. The schema accepts both `condition`/`action`/`response` triples (for system synthesis) and `text` (pre-rendered for user display). Either fills the AC; both is best.

See: `ironclad-design/11-ssot-refinement-ears.md` · `ironclad/ears.md`.

## [NEXT BRICKS]

- **T2b** — author the cladding's own complete `spec.yaml` (every shipped feature, every AC)
- **T2c** — multi-file sharding: `spec.yaml` (master) + `scenarios/*.yaml` + `features/*.yaml` + `architecture/*.yaml`
- **T4** — the 12 Ironclad-native detectors that read this module (`AC_DRIFT`, `UNTESTED_AC`, `STATUS_DRIFT`, `MISSING_IMPLEMENTATION`, …)
- **T5** — full EARS validator (5-pattern syntactic check on `condition`/`action`/`response` strings)
