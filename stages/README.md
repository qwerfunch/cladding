---
project: cladding
component: stages
language: typescript
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
| stage_1.1 Type | `type.ts` | type checker exit 0, no errors | deterministic |

## [INTERFACE]

```typescript
export interface StageResult {
  stage: string;
  pass: boolean;
  exit_code: number;
  stderr?: string;
}

export function runType(opts?: RunTypeOptions): StageResult;
```

JSON-serializable. Machine-readable.

## [CLI]

```
npm run stage:type       # tsx stages/type.ts (from current directory)
npx tsx stages/type.ts   # direct
```

Output: one-line JSON on stdout, exit code matches stage result.

## [DEPENDENCIES]

| dep | purpose |
|---|---|
| `typescript` (dev) | type checker (also the target of stage_1.1 itself — self-dogfood) |
| `tsx` (dev) | direct .ts execution (no precompiled dist/) |
| `@types/node` (dev) | Node.js stdlib types |

Runtime: zero. Each stage module uses Node stdlib only (`node:child_process`) and defers heavy lifting to the project's own toolchain.

## [SELF_DOGFOOD]

stage_1.1 applies to cladding itself: `npm run typecheck` invokes `tsc --noEmit` over `stages/**/*.ts` per `tsconfig.json`. Pass = cladding passes its own stage_1.1.
