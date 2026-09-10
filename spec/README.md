---
project: cladding
component: spec
language: typescript
ironclad-tier: T2a (schema + parser + validator)
spec-schema-version: "0.2"
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
| `spec/scenarios/<slug>-<hash8>.yaml` | **A** | sealed (edit-friendly) | schema 0.1: `clad init <intent>` onboarding (v0.3.45+) + `clad_create_feature` binding. Schema 0.2: a journey names at least one feature, so onboarding stages its draft in `.cladding/scan/` and the journey is created once that feature exists |
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

Schema 0.2 — what `clad init` scaffolds. `spec.yaml` holds the project; features,
capabilities, architecture, and scenarios are separate files.

```yaml
# spec.yaml
schema: "0.2"
project:
  name: <string>
  language: <string>
  purpose: <string>                 # required — why this project exists
  assurance_level: L1 | L2 | L3 | L4
  scenario_policy: off | advisory | required

# spec/capabilities.yaml — the single source of capability ids
capabilities:
  - id: <kebab-slug>
    title: <string>
    outcome: <string>               # the outcome a user gets

# spec/architecture.yaml — ordered ranks of peer layers + forbidden-import rules
layers: [[<layer>, <layer>, ...], ...]
rules:
  - id: AR-a5c11e02                 # exactly 8 lowercase hex
    kind: forbidden_import
    from: <layer>
    to: <layer>
    rationale: <string>             # required — why the import would break the design

# spec/features/<slug>-<hash8>.yaml — one file per feature
id: F-a11ce001                      # exactly 8 lowercase hex
title: <string>
status: planned | in_progress | done | blocked | archived
purpose: <string>                   # required — what this feature is for
modules: [<path>, ...]
depends_on: [F-deadbeef, ...]
capability_refs: [<kebab-slug>, ...]
acceptance_criteria:
  - id: AC-acce5510                 # address is criterion:F-a11ce001/AC-acce5510
    kind: behavior | quality | constraint
    statement: <EARS sentence>
    constraint_refs: [AR-a5c11e02, ...]   # constraint criteria only
    oracle_refs: [<path>, ...]
    evidence_refs: [<path>, ...]

# spec/scenarios/<slug>-<hash8>.yaml — one user journey per file
id: S-c0ff1e01
title: <string>
actor: <string>
goal: <string>
success: <string>
steps: [<string>, ...]
feature_refs: [F-a11ce001, ...]
```

Criteria carry no `test_refs`: a test declares what it covers where it lives, in
its own title — `[covers:F-a11ce001/AC-acce5510]`.

Schema 0.1 files stay readable; `clad init --schema 0.1` still scaffolds one.
Its shape — inline `features:` with `ears`/`condition`/`action`/`response`/`text`
criteria, `architecture.forbidden_imports` pairs, and `scenarios[].flow` — is
described in [`docs/spec-ids-multi-dev.md`](../docs/spec-ids-multi-dev.md).

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
