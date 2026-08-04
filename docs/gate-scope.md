# Module-scoped gate (Gradle monorepos)

In a monorepo, running the whole-repo aggregate gate on every feature is slow
and brittle: an unrelated module turns the gate RED and you pay for compiling
and testing code your change never touched. Cladding scopes the gate to the
**focus feature's modules** so only the relevant Gradle projects run.

This applies to the four command stages: **type** (`stage_1.1`), **lint**
(`stage_1.2`), **unit** (`stage_2.1`), and **coverage** (`stage_2.2`). Drift,
arch, secret, and the spec/oracle stages are unaffected.

## How scope is chosen

| Entry point | Focus | Default scope |
|---|---|---|
| `clad done <id>` | the feature's `modules[]` | scoped (auto) |
| `clad check --feature <id>` | the named feature's `modules[]` | scoped (opt-in) |
| `clad check` (no flag) | — | whole-repo (unchanged; CI/`tier=all` stays full) |

A feature with **no `modules[]`** runs whole-repo — the original behavior.

## Module path → Gradle project

Each repo-relative entry in `modules[]` is resolved to a Gradle project path by
walking **up** to the nearest ancestor directory that has BOTH a build script
(`build.gradle` / `build.gradle.kts`) AND a `gradle.properties`. A file path is
normalized to its owning directory first. Path separators become colons, with a
leading colon:

```
worker/statistics-aggregator/application  →  :worker:statistics-aggregator:application
worker/statistics-aggregator              →  :worker:statistics-aggregator
worker/ingest/src/main/kotlin/Foo.kt      →  :worker:ingest        (file → its module)
```

Projects are de-duplicated and sorted, then run in a **single batched**
invocation — e.g. `./gradlew :a:test :b:test` — never one call per module.

A module path that resolves to **no** Gradle project (no qualifying ancestor, or
it escapes the repo root) is a **loud error** — the gate fails with a clear
message rather than silently widening back to the whole repo.

### Per-stage tasks

| Stage | Scoped tasks (per project `:p`) |
|---|---|
| type | `:p:compileKotlin :p:compileTestKotlin` |
| lint | `:p:ktlintCheck` |
| unit | `:p:test` |
| coverage | `:p:koverXmlReport` (Kover) or `:p:jacocoTestReport` (fallback) |

### Coverage: Kover or JaCoCo (selectable)

Kotlin coverage runs through **Kover** (`koverXmlReport`,
`build/reports/kover/report.xml`) or **JaCoCo** (`jacocoTestReport`,
`build/reports/jacoco/test/jacocoTestReport.xml`). Both emit the same
JaCoCo-format XML, so one parser serves both — only the task and report path
differ. The tool is chosen, highest precedence first:

1. **Explicit** — `.cladding/config.yaml` `gate.coverage: kover | jacoco`. This
   sets BOTH the Gradle task and the report path the `COVERAGE_DROP` detector
   reads, for the whole-repo gate and (applied to every module) the scoped gate.
2. **Auto-detect** — the Kover plugin id referenced anywhere a build declares
   plugins: the root build, `settings.gradle[.kts]`, the version catalog
   (`gradle/libs.versions.toml`), or a `buildSrc` / `build-logic` convention
   plugin. (Text-scan, because Kover is often applied via a convention plugin
   rather than the module build itself.) Under the scoped gate the detection is
   per-module.
3. **Default** — JaCoCo (the pre-existing behavior; no regression).

The `COVERAGE_DROP` detector reads the report by probing Kover-first then
JaCoCo by existence, so it always finds whichever tool actually ran. Under the
scoped gate it collects every module's report and **merges** their LINE
counters into one aggregate percentage.

To pin the tool explicitly (recommended when Kover is applied via a convention
plugin the auto-scan can't see):

```yaml
gate:
  coverage: kover     # or jacoco
```

## Config override — `.cladding/config.yaml`

The `gate:` block is optional. With no config file, the default is
`{ scope: feature }` — automatic module scoping with no command override.

```yaml
gate:
  scope: feature            # feature (default) | repo (force whole-repo)
  coverage: kover           # optional — kover | jacoco (else auto-detect, default jacoco)
  commands:                 # optional — REPLACES toolchain auto-detection
    test: ["./gradlew", "{modules:test}"]
    coverage: ["./gradlew", "{modules:koverXmlReport}", "--continue"]
```

- **`scope: repo`** forces the root aggregate even when a focus feature has
  modules — the pre-module behavior, kept as an escape hatch.
- **`coverage: kover | jacoco`** pins the Kotlin coverage tool explicitly,
  overriding auto-detection for both the task and the report path. Omit it to
  auto-detect (Kover plugin present → Kover, else JaCoCo).
- **`commands.{type,lint,test,coverage}`** are command templates that replace
  the auto-detected gate. The **`{modules:TASK}`** token expands to one
  `:project:TASK` argument per focus project; static (token-less) elements pass
  through verbatim. A `{modules:…}` template invoked with **no** focus modules
  falls back to the repo-level gate (the token would otherwise vanish and
  silently widen scope).

Precedence, highest first: explicit per-call `cmd` override → `gate.commands` →
auto module-scope → repo gate.

## Architecture stage — what it scans in a TS/JS project

The circular-dependency scan runs from the repository root and **skips generated
build output** — `dist/`, `build/`, `out/`, `coverage/`, `target/`, `.next/`,
`.nuxt/`, `.output/`, `.svelte-kit/`, `.vite/` — matched at the root only, so a
source directory that merely happens to be named `build/` deeper in the tree is
still scanned. A bundler's output legitimately contains mutual imports, and
scanning it reports cycles that exist in no hand-written file.

**To control this yourself**, declare a `.madgerc` (or a `madge` block in
`package.json`) with your own `excludeRegExp`. When you do, cladding passes no
exclusion of its own and your rules are the only ones in force — madge *replaces*
its configured exclusions with a command-line flag rather than merging them, so
the two cannot coexist.

## Backward compatibility

Non-Gradle languages, modules-less features, and `gate.scope: repo` all run
exactly as before. The mapping/resolution hook is language-neutral; scoping for
non-Gradle build tools (Maven, …) and dependency-graph-based impact analysis
(auto-including dependents) are follow-ups.
