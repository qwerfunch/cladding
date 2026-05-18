---
project: cladding
component: stages
language: typescript
ironclad-stages-implemented:
  - stage_1.1
  - stage_1.2
  - stage_1.3
  - stage_1.6
detectors-registered:
  - HARDCODED_SECRET
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
| stage_1.1 Type | `type.ts` | type checker exit 0, no errors | deterministic | polyglot chain (TS→tsc · Py→mypy · Rust→cargo check · …) |
| stage_1.2 Lint | `lint.ts` | linter exit 0, no errors | deterministic | polyglot chain (TS→eslint · Py→ruff · Rust→clippy · …) |
| stage_1.3 Drift (core) | `drift.ts` | zero error-severity findings | deterministic | plug-in registry (1/19 detector wired) |
| stage_1.6 Secret | `secret.ts` | no hardcoded secrets in tracked code | deterministic | toolchain chain (TS→secretlint · others→gitleaks) |

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
export function runSecret(opts?: CommandStageOptions): StageResult;

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
npm run stage:drift      # tsx stages/drift.ts (all registered detectors)
npm run stage:secret     # tsx stages/secret.ts
npx tsx stages/<name>.ts # direct
```

Output: one-line JSON on stdout, exit code matches stage result.

## [DEPENDENCIES]

| dep | purpose |
|---|---|
| `execa` (dev) | cross-platform spawn wrapper (replaces `node:child_process.spawnSync`) |
| `typescript` (dev) | type checker; also the target of stage_1.1 (self-dogfood) |
| `tsx` (dev) | direct .ts execution (no precompiled dist/) |
| `eslint` + `typescript-eslint` (dev) | linter; also the target of stage_1.2 (self-dogfood) |
| `secretlint` + `@secretlint/secretlint-rule-preset-recommend` (dev) | secret scanner used for TS projects in stage_1.6 / HARDCODED_SECRET |
| `@types/node` (dev) | Node.js stdlib types |

Runtime: zero. Each stage module defers heavy lifting to the project's own toolchain (resolved by `toolchain/detect.ts`).

## [POLYGLOT]

Cladding is language-agnostic. Stages `type`, `lint`, `test`, `coverage`, `secret` resolve the actual tool by scanning the project for a recognized manifest, in priority order:

| manifest | language | type | lint | test | coverage | secret |
|---|---|---|---|---|---|---|
| `package.json` | typescript | `tsc` | `eslint` | `vitest` | `vitest --coverage` | `secretlint` |
| `pyproject.toml` · `setup.py` · `requirements.txt` | python | `mypy` | `ruff` | `pytest` | `coverage` | `detect-secrets` |
| `Cargo.toml` | rust | `cargo check` | `cargo clippy` | `cargo test` | `cargo llvm-cov` | `gitleaks` |
| `go.mod` | go | `go vet` | `golangci-lint` | `go test` | `go test -cover` | `gitleaks` |
| `pom.xml` · `build.gradle` | java | `mvn compile` | `checkstyle` | `mvn test` | `jacoco` | `gitleaks` |
| `composer.json` | php | `phpstan` | `phpcs` | `phpunit` | `phpunit --coverage-text` | `gitleaks` |
| `Gemfile` | ruby | `srb tc` | `rubocop` | `rspec` | `rspec` | `gitleaks` |
| `mix.exs` | elixir | `mix dialyzer` | `mix credo` | `mix test` | `mix coveralls` | `gitleaks` |
| `.csproj` · `.sln` | dotnet | `dotnet build` | `dotnet format` | `dotnet test` | `dotnet test --collect` | `gitleaks` |
| (none) | unknown | — | — | — | — | — |

`unknown` is not a failure — stage runners return `exitCode: 2` with a descriptive `stderr`, which callers treat as `skipped`. Users can override per-call via `CommandStageOptions.cmd` / `args` to run any tool the chain doesn't list.

## [OSS_POLICY]

Cladding implements Ironclad's *shape* and delegates everything else to existing OSS. Three layers:

| layer | scope | examples |
|---|---|---|
| 1. language-agnostic OSS | all projects | `gitleaks` · `semgrep` · `tree-sitter` · `git` · `cloc` · `ripgrep` |
| 2. language-delegated OSS (auto-detect) | the matched language only | `tsc` · `mypy` · `cargo check` · `go vet` · `javac` · `phpstan` … |
| 3. Ironclad-native (self-implemented) | spec.yaml ↔ code semantics | `AC_DRIFT` · `UNTESTED_AC` · `STATUS_DRIFT` · `EARS_VIOLATION` · HITL infra |

Rule: write own code only when the layer-3 semantics demand it. For everything else, wrap a battle-tested OSS.

## [SELF_DOGFOOD]

| stage | command | applies to |
|---|---|---|
| stage_1.1 | `npm run typecheck` | `stages/**/*.ts` via tsconfig.json |
| stage_1.2 | `npm run lint` | `stages/**/*.ts` via eslint.config.js |
| stage_1.3 | `npm run stage:drift` | 1/19 detector wired (HARDCODED_SECRET); scans cladding's own tree |
| stage_1.6 | `npm run stage:secret` | secretlint scans cladding's own tree via `.secretlintrc.json` |

Pass on all = cladding meets its own L1 stages so far.

## [DETECTORS]

| # | name | severity | axis | OSS | source |
|---|---|---|---|---|---|
| 11 | HARDCODED_SECRET | error | code_vs_test | secretlint (TS) / gitleaks (others) | `detectors/hardcoded-secret.ts` |

Registered through `detectors/index.ts → allDetectors`. To add a new detector: implement the `DriftDetector` interface, then append to that list.
