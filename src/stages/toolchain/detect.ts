// Cladding · toolchain · manifest detection
//
// Walks the priority chain `package.json → pyproject.toml → setup.py →
// Cargo.toml → go.mod → pom.xml → build.gradle → composer.json → mix.exs →
// .csproj → Gemfile` and returns the first match. Each language has a
// curated default per gate (chosen as the *most common* tool, not the only
// one — users override per-stage via `CommandStageOptions`).
//
// This is the polyglot adapter: cladding itself stays language-agnostic;
// the *user project* decides which language tools run.

import {existsSync, readdirSync} from 'node:fs';
import type {Dirent} from 'node:fs';
import {join} from 'node:path';

import type {Language, Toolchain, ToolchainGates} from './types.js';

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
    coverage: {cmd: g, args: ['jacocoTestReport']},
    secret: {cmd: 'gitleaks', args: ['detect', '--no-banner']},
    // No `arch` gate: the Kotlin/JVM compiler enforces acyclic module
    // imports, and forbidden-layer rules are enforced spec-side by the
    // ARCHITECTURE_FROM_SPEC detector (dotted-import matcher).
  };
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
      // --no-install everywhere (0.6.0, battery NOTE 1): a bare `npx tsc`
      // AUTO-INSTALLS the typosquat package `tsc@2.0.4` (not TypeScript) on
      // toolchain-less machines — the gate must never fetch and execute an
      // unpinned third-party package. Absent tool → npx exits non-zero with
      // "not found" → the stage's missing-tool classification → skip (exit 2),
      // which the strict demand table (F-67d2e9) escalates when the spec
      // relies on the stage.
      type: {cmd: 'npx', args: ['--no-install', 'tsc', '--noEmit']},
      lint: {cmd: 'npx', args: ['--no-install', 'eslint', '.']},
      test: {cmd: 'npx', args: ['--no-install', 'vitest', 'run']},
      coverage: {cmd: 'npx', args: ['--no-install', 'vitest', 'run', '--coverage']},
      secret: {cmd: 'npx', args: ['--no-install', 'secretlint', '**/*']},
      arch: {cmd: 'npx', args: ['--no-install', 'madge', '--circular', '--extensions', 'ts', '.']},
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
    const gates = typeof entry.gates === 'function' ? entry.gates(cwd) : entry.gates;
    return {language: entry.language, manifest, gates};
  }
  return UNKNOWN;
}
