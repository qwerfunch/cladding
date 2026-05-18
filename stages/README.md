---
project: cladding
component: stages
language: typescript
ironclad-stages-implemented:
  - stage_1.1
  - stage_1.2
  - stage_1.3
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

Ironclad iron-law stage implementations. One module per stage. Shared types in `types.ts`.

## [IMPLEMENTED]

| stage | file | pass criteria (Ironclad spec) | determinism | default tool |
|---|---|---|---|---|
| stage_1.1 Type | `type.ts` | type checker exit 0, no errors | deterministic | `npx tsc --noEmit` |
| stage_1.2 Lint | `lint.ts` | linter exit 0, no errors | deterministic | `npx eslint .` |
| stage_1.3 Drift (core) | `drift.ts` | zero error-severity findings | deterministic | plug-in registry (empty in L4a) |

## [INTERFACE]

```typescript
// stages/types.ts — shared by every stage runner
export interface StageResult {
  readonly stage: string;       // 'stage_1.1', 'stage_1.2', ...
  readonly pass: boolean;
  readonly exitCode: number;    // 0 iff pass
  readonly stderr?: string;     // populated only on failure
}

export interface CommandStageOptions {
  readonly cwd?: string;        // default '.'
  readonly cmd?: string;        // stage-specific default (npx, etc.)
  readonly args?: readonly string[];  // stage-specific default
}

// per stage
export function runType(opts?: CommandStageOptions): StageResult;
export function runLint(opts?: CommandStageOptions): StageResult;
export function runDrift(opts?: CommandStageOptions): DriftReport;

// stage_1.3 extends the shape with a finding list and a plug-in registry.
export interface DriftFinding {
  readonly detector: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly path?: string;
  readonly line?: number;
  readonly message: string;
}
export interface DriftReport extends StageResult {
  readonly findings: readonly DriftFinding[];
}
export interface DriftDetector {
  readonly name: string;
  run(opts: CommandStageOptions): readonly DriftFinding[];
}
export function registerDetector(detector: DriftDetector): void;
```

JSON-serializable. Machine-readable. Field names follow camelCase (Google TS Style Guide).

## [CLI]

```
npm run stage:type       # tsx stages/type.ts
npm run stage:lint       # tsx stages/lint.ts
npm run stage:drift      # tsx stages/drift.ts
npx tsx stages/<name>.ts # direct
```

Output: one-line JSON on stdout, exit code matches stage result.

## [DEPENDENCIES]

| dep | purpose |
|---|---|
| `typescript` (dev) | type checker; also the target of stage_1.1 (self-dogfood) |
| `tsx` (dev) | direct .ts execution (no precompiled dist/) |
| `eslint` + `typescript-eslint` (dev) | linter; also the target of stage_1.2 (self-dogfood) |
| `@types/node` (dev) | Node.js stdlib types |

Runtime: zero. Each stage module uses Node stdlib only (`node:child_process`) and defers heavy lifting to the project's own toolchain.

## [SELF_DOGFOOD]

| stage | command | applies to |
|---|---|---|
| stage_1.1 | `npm run typecheck` | `stages/**/*.ts` via tsconfig.json |
| stage_1.2 | `npm run lint` | `stages/**/*.ts` via eslint.config.js |
| stage_1.3 | `npm run stage:drift` | empty registry in L4a — passes trivially; detectors land in L4b+ |

Pass on all = cladding meets its own L1 stages so far.
