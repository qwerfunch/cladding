---
project: cladding
component: stages
ironclad-stages-implemented:
  - stage_1.1
ironclad-stages-target:
  - stage_1.1
  - stage_1.2
  - stage_1.3
  - stage_1.4
  - stage_1.5
  - stage_1.6
---

# stages

## [CLAIM]

Ironclad iron-law stage implementations. One module per stage.

## [IMPLEMENTED]

| stage | file | pass criteria (Ironclad spec) | determinism |
|---|---|---|---|
| stage_1.1 Type | `type.mjs` | type checker exit 0, no errors | deterministic |

## [INTERFACE]

Every stage exports a `run<Name>(opts)` function returning a `StageResult`:

```
StageResult = {
  stage: string,        // 'stage_1.1' etc.
  pass: boolean,
  exit_code: number,
  stderr?: string       // only when !pass
}
```

JSON-serializable. Machine-readable.

## [CLI]

```
node stages/type.mjs       # runs from current directory
```

Output: one-line JSON on stdout, exit code matches stage result.

## [DEPENDENCIES]

Zero npm dependencies. Node.js stdlib only (`node:child_process`). Type checker resolution (`npx tsc`) defers to project's own toolchain.
