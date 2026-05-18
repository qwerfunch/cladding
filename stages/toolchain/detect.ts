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
import {join} from 'node:path';

import type {Language, Toolchain, ToolchainGates} from './types.js';

interface Entry {
  readonly language: Language;
  readonly manifests: readonly string[];
  readonly gates: ToolchainGates;
}

const CHAIN: readonly Entry[] = [
  {
    language: 'typescript',
    manifests: ['package.json'],
    gates: {
      type: {cmd: 'npx', args: ['tsc', '--noEmit']},
      lint: {cmd: 'npx', args: ['eslint', '.']},
      test: {cmd: 'npx', args: ['vitest', 'run']},
      coverage: {cmd: 'npx', args: ['vitest', 'run', '--coverage']},
      secret: {cmd: 'npx', args: ['secretlint', '**/*']},
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
    if (manifest) {
      return {language: entry.language, manifest, gates: entry.gates};
    }
  }
  return UNKNOWN;
}
