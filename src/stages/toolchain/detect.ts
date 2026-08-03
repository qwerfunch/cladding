// Cladding · toolchain · manifest detection
//
// Walks the priority chain `package.json → pyproject.toml → setup.py →
// Cargo.toml → go.mod → pom.xml → build.gradle → composer.json → mix.exs →
// .csproj → Gemfile` and returns the first match. Each language has a
// curated default per gate (chosen as the *most common* tool, not the only
// one — users override per-stage via `CommandStageOptions`). For TS/JS,
// explicit package scripts and config files refine those defaults so Cladding
// runs the workflow the project declared; detection never installs.
//
// This is the polyglot adapter: cladding itself stays language-agnostic;
// the *user project* decides which language tools run.

import {existsSync, readFileSync, readdirSync} from 'node:fs';
import type {Dirent} from 'node:fs';
import {join} from 'node:path';

import {kotlinCoverageTask} from './coverage-tool.js';
import type {Language, Toolchain, ToolchainGates, ToolSpec} from './types.js';

interface Entry {
  readonly language: Language;
  readonly manifests: readonly string[];
  /**
   * Per-gate commands. A function form receives the project root so the
   * gates can depend on runtime state (Kotlin resolves `./gradlew` vs the
   * bare `gradle` executable per project).
   */
  readonly gates: ToolchainGates | ((cwd: string) => ToolchainGates);
  /**
   * Optional discriminator: file extensions (with leading dot) at least one
   * of which must exist under the project before this entry matches. Used by
   * Kotlin, which shares Gradle/Maven manifests with Java — a `.kt`/`.kts`
   * file is what tells the two apart. When absent, the manifest match alone
   * wins.
   */
  readonly requiresSource?: readonly string[];
}

/** package.json fields that affect TS/JS gate selection. */
interface PackageManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly eslintConfig?: unknown;
  readonly jest?: unknown;
  readonly madge?: unknown;
}

/** npx must resolve only already-installed/cacheable tools and never touch the network. */
const NPX_LOCAL_ONLY = ['--offline', '--no-install'] as const;

/**
 * Prefers the committed Gradle wrapper (`./gradlew`) over a bare `gradle`
 * on PATH. The wrapper pins the Gradle version per project and is the
 * idiomatic invocation for JVM repos; falling back to `gradle` keeps the
 * gate runnable on wrapper-less checkouts (absent tool → npx-style skip).
 */
export function gradleCmd(cwd: string): string {
  return existsSync(join(cwd, 'gradlew')) ? './gradlew' : 'gradle';
}

function kotlinGates(cwd: string): ToolchainGates {
  const g = gradleCmd(cwd);
  return {
    type: {cmd: g, args: ['compileKotlin', 'compileTestKotlin']},
    lint: {cmd: g, args: ['ktlintCheck']},
    test: {cmd: g, args: ['test']},
    // Coverage tool is selectable: explicit `.cladding/config.yaml`
    // gate.coverage, else Kover auto-detect, else jacoco. @see coverage-tool.ts
    coverage: {cmd: g, args: [kotlinCoverageTask(cwd)]},
    secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    // No `arch` gate: the Kotlin/JVM compiler enforces acyclic module
    // imports, and forbidden-layer rules are enforced spec-side by the
    // ARCHITECTURE_FROM_SPEC detector (dotted-import matcher).
  };
}

/**
 * Dart vs Flutter share the `pubspec.yaml` manifest; the SDK in use is what
 * tells them apart. A Flutter package declares the flutter SDK (a `flutter:`
 * stanza or a `sdk: flutter` dependency), so its gates run through the
 * `flutter` wrapper (which bundles the Flutter-aware analyzer + test harness);
 * a pure-Dart package gates with the bare `dart` CLI. Gates are a thunk so the
 * pubspec is read once per detection.
 */
function dartGates(cwd: string): ToolchainGates {
  let isFlutter = false;
  try {
    isFlutter = /(^|\n)\s*flutter\s*:|sdk:\s*flutter/.test(readFileSync(join(cwd, 'pubspec.yaml'), 'utf8'));
  } catch {
    /* unreadable pubspec → treat as pure Dart */
  }
  const lint: ToolSpec = {cmd: 'dart', args: ['format', '--output=none', '--set-exit-if-changed', '.']};
  const secret: ToolSpec = {cmd: 'gitleaks', args: ['detect', '--no-banner']};
  return isFlutter
    ? {
        type: {cmd: 'flutter', args: ['analyze']},
        lint,
        test: {cmd: 'flutter', args: ['test']},
        coverage: {cmd: 'flutter', args: ['test', '--coverage']},
        secret,
      }
    : {
        type: {cmd: 'dart', args: ['analyze']},
        lint,
        test: {cmd: 'dart', args: ['test']},
        coverage: {cmd: 'dart', args: ['test', '--coverage=coverage']},
        secret,
      };
  // No `arch` gate: Dart/Flutter package imports are resolved acyclically by
  // the SDK build, mirroring the rust/go/kotlin "compiler enforces it" stance.
}

/** Directories never worth descending into when probing for source files. */
const SOURCE_PROBE_IGNORE = new Set([
  'node_modules', '.git', '.gradle', '.idea', 'build', 'target', 'dist', 'out', '.cladding',
]);

/**
 * Bounded BFS that answers "does a file with one of these suffixes exist
 * anywhere under cwd?". Kotlin sources nest deep (`src/main/kotlin/<pkg>/`),
 * so a flat `readdirSync` is not enough; the walk is capped so detection
 * stays O(small) even on large trees.
 */
function hasSourceFile(cwd: string, suffixes: readonly string[]): boolean {
  const queue: string[] = [cwd];
  let visited = 0;
  const CAP = 4000;
  while (queue.length > 0 && visited < CAP) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, {withFileTypes: true});
    } catch {
      continue;
    }
    for (const e of entries) {
      visited++;
      if (e.isDirectory()) {
        if (SOURCE_PROBE_IGNORE.has(e.name) || e.name.startsWith('.')) continue;
        queue.push(join(dir, e.name));
      } else if (suffixes.some((s) => e.name.endsWith(s))) {
        return true;
      }
    }
  }
  return false;
}

const CHAIN: readonly Entry[] = [
  {
    language: 'typescript',
    manifests: ['package.json'],
    gates: {
      // --offline + --no-install everywhere: a bare `npx tsc`
      // AUTO-INSTALLS the typosquat package `tsc@2.0.4` (not TypeScript) on
      // toolchain-less machines — the gate must never fetch and execute an
      // unpinned third-party package. Absent tool → npx exits non-zero with
      // "not found" → the stage's missing-tool classification → skip (exit 2),
      // which the strict demand table (F-67d2e9) escalates when the spec
      // relies on the stage.
      type: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'tsc', '--noEmit']},
      lint: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'eslint', '.']},
      test: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'vitest', 'run']},
      coverage: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'vitest', 'run', '--coverage']},
      secret: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'secretlint', '**/*']},
      // .tsx/.jsx/.js alongside .ts so circular-dependency detection covers
      // React/JSX component trees, not only plain .ts (F-47b8bee5). madge
      // excludes node_modules by default, so widening extensions does not pull
      // the dependency tree into the scan.
      arch: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'madge', '--circular', '--extensions', 'ts,tsx,js,jsx', '.']},
      smoke: {cmd: 'npm', args: ['run', '--silent', 'smoke']},
      perf: {cmd: 'npm', args: ['run', '--silent', 'perf']},
      visual: {cmd: 'npm', args: ['run', '--silent', 'visual']},
    },
  },
  {
    language: 'python',
    manifests: ['pyproject.toml', 'setup.py', 'requirements.txt'],
    gates: {
      type: {cmd: 'mypy', args: ['.']},
      lint: {cmd: 'ruff', args: ['check', '.']},
      test: {cmd: 'pytest', args: []},
      coverage: {cmd: 'coverage', args: ['run', '-m', 'pytest']},
      secret: {cmd: 'detect-secrets', args: ['scan']},
      arch: {cmd: 'lint-imports', args: []},
    },
  },
  {
    language: 'rust',
    manifests: ['Cargo.toml'],
    gates: {
      type: {cmd: 'cargo', args: ['check']},
      lint: {cmd: 'cargo', args: ['clippy', '--', '-D', 'warnings']},
      test: {cmd: 'cargo', args: ['test']},
      coverage: {cmd: 'cargo', args: ['llvm-cov']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    language: 'go',
    manifests: ['go.mod'],
    gates: {
      type: {cmd: 'go', args: ['vet', './...']},
      lint: {cmd: 'golangci-lint', args: ['run']},
      test: {cmd: 'go', args: ['test', './...']},
      coverage: {cmd: 'go', args: ['test', '-cover', './...']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    // Kotlin shares Gradle/Maven manifests with Java, so it must be probed
    // *before* the Java entry and only matches when a .kt/.kts source file is
    // actually present — otherwise a pure-Java/Maven repo would be misread.
    // Gates are a thunk: the gradle command (`./gradlew` vs `gradle`) is
    // resolved per project at detection time.
    language: 'kotlin',
    manifests: ['build.gradle.kts', 'build.gradle', 'pom.xml'],
    requiresSource: ['.kt', '.kts'],
    gates: kotlinGates,
  },
  {
    language: 'java',
    manifests: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    gates: {
      type: {cmd: 'mvn', args: ['compile', '-q']},
      lint: {cmd: 'mvn', args: ['checkstyle:check', '-q']},
      test: {cmd: 'mvn', args: ['test', '-q']},
      coverage: {cmd: 'mvn', args: ['jacoco:report', '-q']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    language: 'php',
    manifests: ['composer.json'],
    gates: {
      type: {cmd: 'phpstan', args: ['analyse']},
      lint: {cmd: 'phpcs', args: []},
      test: {cmd: 'phpunit', args: []},
      coverage: {cmd: 'phpunit', args: ['--coverage-text']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    language: 'ruby',
    manifests: ['Gemfile'],
    gates: {
      type: {cmd: 'srb', args: ['tc']},
      lint: {cmd: 'rubocop', args: []},
      test: {cmd: 'bundle', args: ['exec', 'rspec']},
      coverage: {cmd: 'bundle', args: ['exec', 'rspec', '--format', 'documentation']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    language: 'elixir',
    manifests: ['mix.exs'],
    gates: {
      type: {cmd: 'mix', args: ['dialyzer']},
      lint: {cmd: 'mix', args: ['credo']},
      test: {cmd: 'mix', args: ['test']},
      coverage: {cmd: 'mix', args: ['coveralls']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    language: 'dotnet',
    manifests: ['.csproj', '.sln', '.fsproj'],
    gates: {
      type: {cmd: 'dotnet', args: ['build', '--nologo', '-v', 'q']},
      lint: {cmd: 'dotnet', args: ['format', '--verify-no-changes']},
      test: {cmd: 'dotnet', args: ['test', '--nologo']},
      coverage: {cmd: 'dotnet', args: ['test', '--collect:"XPlat Code Coverage"']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    // Swift Package Manager. Xcode-only apps (no Package.swift) gate via a
    // `.cladding/config.yaml::gate.commands` xcodebuild override — matching
    // `.xcodeproj` here would wrongly point `swift build` at a project SPM
    // cannot drive. No `arch` gate: SPM resolves module imports acyclically.
    language: 'swift',
    manifests: ['Package.swift'],
    gates: {
      type: {cmd: 'swift', args: ['build']},
      lint: {cmd: 'swiftlint', args: ['lint']},
      test: {cmd: 'swift', args: ['test']},
      coverage: {cmd: 'swift', args: ['test', '--enable-code-coverage']},
      secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    },
  },
  {
    // Dart + Flutter share pubspec.yaml; the gates thunk reads it to pick the
    // `flutter` wrapper vs the bare `dart` CLI. @see dartGates.
    language: 'dart',
    manifests: ['pubspec.yaml'],
    gates: dartGates,
  },
];

/** Empty toolchain returned when no manifest matches. */
const UNKNOWN: Toolchain = {
  language: 'unknown',
  manifest: '',
  gates: {},
};

function findMatchingFile(cwd: string, candidates: readonly string[]): string | undefined {
  for (const name of candidates) {
    if (existsSync(join(cwd, name))) return name;
  }
  return undefined;
}

function hasExtensionFile(cwd: string, suffix: string): string | undefined {
  try {
    const entries = readdirSync(cwd);
    return entries.find((e) => e.endsWith(suffix));
  } catch {
    return undefined;
  }
}

/**
 * TypeScript/JavaScript linter resolution by config-file presence (F-b2094740).
 *
 * `package.json` maps to one language ('typescript'), but the JS/TS ecosystem
 * has several common linters. Rather than hardcode eslint, run the project's
 * explicit `scripts.lint` first, then detect a configured biome/oxlint/eslint.
 * With no declaration, omit the gate: a package.json alone is not evidence
 * that ESLint is installed or configured.
 *
 * `--offline --no-install` is kept on every gate: detection only decides WHICH
 * tool to invoke, it NEVER installs one or contacts a registry. An absent linter resolves
 * to skip via stage_1.2's missing-tool path (lint.ts), which `--strict`'s
 * skip-policy escalates when the spec relies on lint.
 *
 * CAVEAT — detection is by config-file PRESENCE, not content. A biome.json with
 * `linter.enabled: false` (biome used only for formatting) still resolves to the
 * biome lint gate, and `biome lint` then exits 0 — a filename cannot distinguish
 * "configured to lint" from "configured to format only". A project that lints
 * with a different tool overrides via CommandStageOptions (the cmd/args seam).
 */
const TS_LINTERS: ReadonlyArray<{readonly configs: readonly string[]; readonly gate: ToolSpec}> = [
  {configs: ['biome.json', 'biome.jsonc'], gate: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'biome', 'lint', '.']}},
  // oxlint auto-detects all three filenames in cwd (oxc.rs config reference).
  {configs: ['.oxlintrc.json', '.oxlintrc.jsonc', 'oxlint.config.ts'], gate: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'oxlint']}},
];

const ESLINT_CONFIGS: readonly string[] = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
  'eslint.config.mts',
  'eslint.config.cts',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.cjs',
  '.eslintrc.json',
  '.eslintrc.yaml',
  '.eslintrc.yml',
];

/**
 * Generated build output, excluded from the circular-dependency scan (AC-caa9471d).
 *
 * A bundler's output legitimately contains mutual imports — that is what bundling
 * produces — so scanning it reports cycles that exist in no hand-written file. On one
 * adopter this blocked the gate five times, every one of them inside a version-ignored
 * bundle; the recorded root cause was wrong and the issue stayed open for sixteen days.
 *
 * Anchored at the repository root (`^`) so a source directory that merely happens to be
 * named `build/` deeper in the tree is still scanned.
 */
const BUILD_OUTPUT_EXCLUDE =
  '^(dist|build|out|coverage|target|\\.next|\\.nuxt|\\.output|\\.svelte-kit|\\.vite)/';

/**
 * Files that mean "this project configures the dependency scanner itself".
 * `rc` resolves `.madgerc` and its typed variants; `package.json#madge` is the
 * inline form.
 */
const MADGE_CONFIGS: readonly string[] = ['.madgerc', '.madgerc.json', '.madgerc.js', '.madgerc.yaml', '.madgerc.yml'];

/** Reads package.json once for gate refinement; malformed input declares nothing. */
function readPackageManifest(cwd: string): PackageManifest {
  try {
    return JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as PackageManifest;
  } catch {
    return {};
  }
}

/** True when a non-empty npm script is explicitly declared. */
function packageScript(pkg: PackageManifest, name: string): string | undefined {
  const script = pkg.scripts?.[name];
  return typeof script === 'string' && script.trim().length > 0 ? script.trim() : undefined;
}

/** True when package.json declares a dependency in any installable section. */
function hasPackageDependency(pkg: PackageManifest, name: string): boolean {
  return [pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies]
    .some((group) => group?.[name] !== undefined);
}

/**
 * The TS/JS architecture gate, with build output excluded unless the project
 * configures the scanner itself (AC-caa9471d, AC-554d9436).
 *
 * The guard is not politeness — madge REPLACES its configured `excludeRegExp`
 * with the command-line flag rather than merging the two. Passing ours
 * unconditionally would silently delete an adopter's own rules, including the
 * workaround one adopter is currently relying on. When they have declared
 * nothing we supply the default; when they have, we stay out of the way.
 *
 * The scan ROOT is deliberately left at `.` (AC-c04171bd): narrowing it to a
 * named source directory was measured to be worse than the defect it fixes —
 * a missing root makes madge exit with ENOENT, which classifies as a scanner
 * setup gap (advisory), so the whole stage skips and the gate goes green having
 * checked nothing.
 */
function resolveTsArch(cwd: string, base: ToolSpec, pkg: PackageManifest): ToolSpec {
  const projectConfigures =
    pkg.madge !== undefined || MADGE_CONFIGS.some((c) => existsSync(join(cwd, c)));
  if (projectConfigures) return base;
  const args = [...base.args];
  // Before the trailing scan root, so the root stays last as madge expects.
  args.splice(args.length - 1, 0, '--exclude', BUILD_OUTPUT_EXCLUDE);
  return {...base, args};
}

/** The project's declared TS/JS lint gate, or undefined when lint is unconfigured. */
function resolveTsLint(cwd: string, eslintDefault: ToolSpec, pkg: PackageManifest): ToolSpec | undefined {
  if (packageScript(pkg, 'lint')) return {cmd: 'npm', args: ['run', '--silent', 'lint']};
  for (const linter of TS_LINTERS) {
    if (linter.configs.some((c) => existsSync(join(cwd, c)))) return linter.gate;
  }
  if (ESLINT_CONFIGS.some((c) => existsSync(join(cwd, c))) || pkg.eslintConfig !== undefined) {
    return eslintDefault;
  }
  return undefined;
}

/**
 * TypeScript/JavaScript test-runner resolution by config-file presence
 * (F-47b8bee5) — the test-gate analogue of `resolveTsLint`.
 *
 * `package.json` maps to one language, but the test gate defaulted to vitest
 * unconditionally — so a Jest project (CRA, React Native, classic React) hit
 * the Vitest fallback, found nothing, and SILENTLY SKIPPED stage_2.1 /
 * stage_2.2. Detect the Jest the project actually configured and gate with
 * THAT. An explicit non-Jest/Vitest `scripts.test` is authoritative and runs
 * through npm (preserving build steps and Node's built-in runner); its coverage
 * gate exists only when `scripts.coverage` is also declared. Otherwise the
 * historical Jest-config → Jest → Vitest-default chain remains intact.
 *
 * `--offline --no-install` is kept: detection only decides WHICH runner to
 * invoke, never installs one or contacts a registry. An absent Jest resolves to skip via the
 * stage's missing-tool path, which `--strict`'s skip-policy escalates.
 *
 * CAVEAT — by config PRESENCE, not content (mirrors `resolveTsLint`). A project
 * carrying both a jest and a vitest config resolves to jest; one that tests with
 * a different runner overrides via `.cladding/config.yaml::gate.commands`.
 */
const JEST_CONFIGS: readonly string[] = [
  'jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json',
];

/** True when the project configures Jest — a jest.config.* file or a `jest` key in package.json. */
function hasJestConfig(cwd: string, pkg: PackageManifest): boolean {
  if (JEST_CONFIGS.some((c) => existsSync(join(cwd, c)))) return true;
  return pkg.jest !== undefined;
}

/** Runner scripts simple enough to preserve the native Vitest/Jest gate path. */
function simpleTestRunner(script: string): 'vitest' | 'jest' | undefined {
  if (/^(?:(?:npx|npm exec)\s+(?:--offline\s+)?(?:--no-install\s+)?(?:--\s+)?)?vitest(?:\s+run)?$/i.test(script)) {
    return 'vitest';
  }
  if (/^(?:(?:npx|npm exec)\s+(?:--offline\s+)?(?:--no-install\s+)?(?:--\s+)?)?jest$/i.test(script)) {
    return 'jest';
  }
  return undefined;
}

/** Drops one optional gate without mutating the curated base object. */
function withoutGate(base: ToolchainGates, gate: 'lint' | 'coverage'): ToolchainGates {
  const rest = {...base};
  if (gate === 'lint') delete rest.lint;
  else delete rest.coverage;
  return rest;
}

/**
 * Applies TS/JS config-presence detection to the curated TS gates: linter
 * (biome/oxlint/eslint via `resolveTsLint`) and test runner (jest/vitest via
 * `hasJestConfig`). Other gates pass through unchanged.
 */
function resolveTsGates(cwd: string, base: ToolchainGates): ToolchainGates {
  const pkg = readPackageManifest(cwd);
  const lint = base.lint ? resolveTsLint(cwd, base.lint, pkg) : undefined;
  const withArch: ToolchainGates = base.arch
    ? {...base, arch: resolveTsArch(cwd, base.arch, pkg)}
    : base;
  let out: ToolchainGates = lint ? {...withArch, lint} : withoutGate(withArch, 'lint');
  const testScript = packageScript(pkg, 'test');
  const runner = testScript ? simpleTestRunner(testScript) : undefined;

  if (testScript && !runner) {
    out = withoutGate(out, 'coverage');
    return {
      ...out,
      test: {cmd: 'npm', args: ['test']},
      ...(packageScript(pkg, 'coverage')
        ? {coverage: {cmd: 'npm', args: ['run', '--silent', 'coverage']}}
        : {}),
    };
  }

  if (runner === 'jest' || (!testScript && hasJestConfig(cwd, pkg))) {
    return {
      ...out,
      test: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'jest']},
      coverage: {cmd: 'npx', args: [...NPX_LOCAL_ONLY, 'jest', '--coverage']},
    };
  }

  if (runner === 'vitest' && !packageScript(pkg, 'coverage')
      && !hasPackageDependency(pkg, '@vitest/coverage-v8')
      && !hasPackageDependency(pkg, '@vitest/coverage-istanbul')) {
    out = withoutGate(out, 'coverage');
  } else if (runner === 'vitest' && packageScript(pkg, 'coverage')) {
    out = {...out, coverage: {cmd: 'npm', args: ['run', '--silent', 'coverage']}};
  }
  return out;
}

/**
 * Detects the project's toolchain by walking a priority chain of manifests.
 *
 * The first matching language wins. `.csproj` / `.sln` / `.fsproj` are matched
 * by extension because their basenames vary per project. When nothing matches
 * the returned `Toolchain` has `language: 'unknown'` and empty gates; stage
 * runners should treat that as `skipped`, not as failure.
 *
 * @param cwd - Project root to scan. Defaults to `'.'`.
 * @returns The detected toolchain, or the unknown sentinel.
 * @see iron-law.md — polyglot adapter for stages 1.1, 1.2, 1.6, 2.1, 2.2.
 */
export function detectToolchain(cwd: string = '.'): Toolchain {
  for (const entry of CHAIN) {
    let manifest: string | undefined;
    for (const name of entry.manifests) {
      if (name.startsWith('.')) {
        manifest = hasExtensionFile(cwd, name);
      } else {
        manifest = findMatchingFile(cwd, [name]);
      }
      if (manifest) break;
    }
    if (!manifest) continue;
    // Discriminator: a shared-manifest entry (Kotlin) only wins when one of
    // its required source extensions is present; otherwise fall through to
    // the next entry (Java).
    if (entry.requiresSource && !hasSourceFile(cwd, entry.requiresSource)) continue;
    // Kotlin gates are a function of cwd (gradlew vs gradle); resolve first.
    const baseGates = typeof entry.gates === 'function' ? entry.gates(cwd) : entry.gates;
    // TS/JS: prefer declared npm workflows, then configured ecosystem tools.
    // Other languages keep their single curated default.
    const gates = entry.language === 'typescript' ? resolveTsGates(cwd, baseGates) : baseGates;
    return {language: entry.language, manifest, gates};
  }
  return UNKNOWN;
}
