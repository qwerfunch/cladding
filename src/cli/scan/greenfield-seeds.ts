// Cladding · scan · greenfield-seeds — toolchain-default templates for
// the three scan-derived artifacts when there is no code yet to observe
//
// Background:
// `clad init` already writes `spec.yaml` (placeholder feature), the
// `spec/scenarios/README.md` policy doc, and a `docs/project-context.md`
// template on every greenfield init. Until v0.3.42 the three scan
// artifacts — `docs/conventions.md`, `spec/architecture.yaml`,
// `spec/capabilities.yaml` — were only written when `clad init --scan`
// produced observed signals (auto-trigger at ≥3 source files).
// That left a greenfield workspace half-finished: half the spec/docs
// surface was always present, the other half was conditional.
//
// This module fills the gap with **deterministic toolchain-default
// seeds**. The seeds carry an SEED header that names the language they
// were built for and tells the user that re-running `clad init --scan`
// after writing initial code will divert the observed body to
// `.cladding/scan/*.proposal` for review (existing `writeArtifact`
// divert behaviour in `src/cli/init.ts`). Personas can therefore treat
// every scan artifact as always-present, dropping the "if absent"
// branch from their guidance.
//
// The seed conventions table is byte-for-byte the same shape as the
// observed table from `renderConventionsTable` in `llm.ts`, so a
// reader who has only ever seen one or the other gets a consistent
// visual surface; only the header marker differs.

import type {Conventions} from './types.js';

/**
 * Tier banner prepended to greenfield seed bodies. The first line
 * follows the cladding-wide tier convention (see docs/ssot-model.md)
 * so a reading persona can identify Tier + authority from `head -1`
 * without loading the body.
 */
const SEED_HEADER = (language: string): string =>
  '<!-- Cladding · Tier C · derived from observed code (greenfield seed for ' +
  language +
  ') · Refreshed by: clad init --scan -->\n' +
  '<!-- Greenfield seed: no code observed yet. Re-run `clad init --scan` after writing\n' +
  '     initial code; the observed body will divert this seed to\n' +
  '     `.cladding/scan/conventions.md.proposal` for review. -->';

interface LanguageDefaults {
  /** Display name shown in the seed body. */
  readonly displayName: string;
  /** 14-signal `Conventions` shape filled with the language's idiomatic defaults. */
  readonly conventions: Conventions;
  /** Inline one-line URL to the canonical style guide for the language. */
  readonly styleGuideUrl: string;
  /**
   * Comment lines describing the typical directory baseline for
   * `spec/architecture.yaml`. Each entry is one comment line (no
   * leading `#` — the renderer prepends it).
   */
  readonly architectureBaseline: readonly string[];
}

const TS_CONVENTIONS: Conventions = {
  indent: 'two-space',
  quote: 'single',
  semicolon: 'present',
  namingExports: 'camelCase',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'node-first',
  exportPattern: 'named-only',
  errorHandling: 'throw-primary',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'tests-dir',
  moduleBoilerplate: null,
};

const PYTHON_CONVENTIONS: Conventions = {
  indent: 'four-space',
  quote: 'double',
  semicolon: 'absent',
  namingExports: 'snake_case',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'throw-primary',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'tests-dir',
  moduleBoilerplate: null,
};

const GO_CONVENTIONS: Conventions = {
  indent: 'tab',
  quote: 'double',
  semicolon: 'absent',
  namingExports: 'PascalCase',
  namingConstants: 'camelCase',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'result-pattern',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'sibling-test',
  moduleBoilerplate: null,
};

const RUST_CONVENTIONS: Conventions = {
  indent: 'four-space',
  quote: 'double',
  semicolon: 'present',
  namingExports: 'snake_case',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'result-pattern',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'sibling-test',
  moduleBoilerplate: null,
};

const RUBY_CONVENTIONS: Conventions = {
  indent: 'two-space',
  quote: 'single',
  semicolon: 'absent',
  namingExports: 'snake_case',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'throw-primary',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'tests-dir',
  moduleBoilerplate: null,
};

const JAVA_CONVENTIONS: Conventions = {
  indent: 'four-space',
  quote: 'double',
  semicolon: 'present',
  namingExports: 'camelCase',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'throw-primary',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'tests-dir',
  moduleBoilerplate: null,
};

const KOTLIN_CONVENTIONS: Conventions = {
  indent: 'four-space',
  quote: 'double',
  semicolon: 'absent',
  namingExports: 'camelCase',
  namingConstants: 'UPPER_SNAKE',
  docBlockRatio: 0.5,
  docTagCounts: {'@param': 0, '@returns': 0, '@throws': 0, '@example': 0, '@see': 0, '@deprecated': 0},
  importOrder: 'external-first',
  exportPattern: 'named-only',
  errorHandling: 'throw-primary',
  typeDefLocation: 'inline',
  fileHeaderPattern: 'purpose header — what the module does + why it exists',
  testLocation: 'tests-dir',
  moduleBoilerplate: null,
};

/**
 * Per-language seed mapping. Adding a new toolchain means appending
 * one entry to this object — both renderers read from the same source.
 * Unknown languages fall back to TypeScript defaults, which are the
 * most common cladding-managed toolchain.
 */
const DEFAULTS: Readonly<Record<string, LanguageDefaults>> = {
  typescript: {
    displayName: 'TypeScript',
    conventions: TS_CONVENTIONS,
    styleGuideUrl: 'https://google.github.io/styleguide/tsguide.html',
    architectureBaseline: [
      '  src/cli/   — entry points, argument parsing',
      '  src/core/  — domain logic, pure functions',
      '  src/lib/   — shared utilities',
      '  src/ui/    — user-facing renderers',
    ],
  },
  javascript: {
    displayName: 'JavaScript',
    conventions: TS_CONVENTIONS,
    styleGuideUrl: 'https://google.github.io/styleguide/jsguide.html',
    architectureBaseline: [
      '  src/cli/   — entry points, argument parsing',
      '  src/core/  — domain logic, pure functions',
      '  src/lib/   — shared utilities',
      '  src/ui/    — user-facing renderers',
    ],
  },
  python: {
    displayName: 'Python',
    conventions: PYTHON_CONVENTIONS,
    styleGuideUrl: 'https://peps.python.org/pep-0008/',
    architectureBaseline: [
      '  src/<package>/  — your package module',
      '  tests/          — pytest discovery root',
    ],
  },
  go: {
    displayName: 'Go',
    conventions: GO_CONVENTIONS,
    styleGuideUrl: 'https://go.dev/doc/effective_go',
    architectureBaseline: [
      '  cmd/<binary>/  — main entry points',
      '  pkg/           — publicly importable packages',
      '  internal/      — private packages (compiler-enforced)',
    ],
  },
  rust: {
    displayName: 'Rust',
    conventions: RUST_CONVENTIONS,
    styleGuideUrl: 'https://doc.rust-lang.org/1.0.0/style/',
    architectureBaseline: [
      '  src/lib.rs     — crate root',
      '  src/main.rs    — binary entry point (if applicable)',
      '  src/bin/       — additional binaries',
      '  tests/         — integration tests',
    ],
  },
  ruby: {
    displayName: 'Ruby',
    conventions: RUBY_CONVENTIONS,
    styleGuideUrl: 'https://rubystyle.guide/',
    architectureBaseline: [
      '  lib/<gem>/     — library code',
      '  spec/          — RSpec test suite',
    ],
  },
  java: {
    displayName: 'Java',
    conventions: JAVA_CONVENTIONS,
    styleGuideUrl: 'https://google.github.io/styleguide/javaguide.html',
    architectureBaseline: [
      '  src/main/java/<package>/   — production code',
      '  src/test/java/<package>/   — JUnit tests',
    ],
  },
  kotlin: {
    displayName: 'Kotlin',
    conventions: KOTLIN_CONVENTIONS,
    styleGuideUrl: 'https://kotlinlang.org/docs/coding-conventions.html',
    architectureBaseline: [
      '  src/main/kotlin/<package>/   — production code',
      '  src/test/kotlin/<package>/   — JUnit / Kotest tests',
    ],
  },
};

function resolveDefaults(language: string): LanguageDefaults {
  return DEFAULTS[language.toLowerCase()] ?? DEFAULTS.typescript;
}

/**
 * Renders the greenfield seed body for `docs/conventions.md`.
 * Shape matches the observed table in `llm.ts::renderConventionsTable`
 * so the on-disk surface stays consistent across modes — only the
 * SEED header differs.
 *
 * @param language Toolchain language as detected by `detectToolchain`.
 * @param projectName The basename used in the seed title.
 */
export function renderGreenfieldConventionsMd(language: string, projectName: string): string {
  const defaults = resolveDefaults(language);
  const c = defaults.conventions;
  const lines: string[] = [
    SEED_HEADER(defaults.displayName),
    '',
    `# ${projectName} — project conventions`,
    '',
    `_Mode: greenfield seed (language: ${defaults.displayName}). Re-scan to replace._`,
    '',
    `## Recommended baseline (per ${defaults.displayName} style guide — ${defaults.styleGuideUrl})`,
    '',
    '| key | value |',
    '|---|---|',
    `| indent | ${c.indent} |`,
    `| quote | ${c.quote} |`,
    `| semicolon | ${c.semicolon} |`,
    `| naming (exports) | ${c.namingExports} |`,
    `| naming (constants) | ${c.namingConstants} |`,
    `| docblock ratio | ${c.docBlockRatio.toFixed(2)} |`,
    `| import order | ${c.importOrder} |`,
    `| export pattern | ${c.exportPattern} |`,
    `| error handling | ${c.errorHandling} |`,
    `| type def location | ${c.typeDefLocation} |`,
    `| test location | ${c.testLocation} |`,
    `| file header | ${c.fileHeaderPattern ?? '(none)'} |`,
    '',
    '## Comments & documentation — Why > What',
    '',
    'Comment the **decision and the non-obvious why**, not a restatement of the code. Every exported',
    'function, type, and module carries a doc comment (JSDoc / docstring / rustdoc as the language',
    'dictates) stating its purpose and any non-obvious contract, and each file opens with a one-line',
    'purpose header. Skip comments that merely echo the code — highest quality is a documented public',
    'surface and a clear *why*, not a comment on every line.',
    '',
    '## Adding a new module',
    '',
    `Match the baseline above unless the team has agreed otherwise. After writing initial code, re-run \`clad init --scan\` — the observed 14-signal table will divert this seed to \`.cladding/scan/conventions.md.proposal\` so you can diff seed vs reality.`,
    '',
  ];
  return lines.join('\n');
}

/**
 * Renders the greenfield seed body for `spec/architecture.yaml`.
 * `layers: []` stays empty so the user has to opt in to layer
 * declarations; the header comment lists a typical toolchain baseline
 * the maintainer can copy into the array when ready.
 *
 * @param language Toolchain language as detected by `detectToolchain`.
 */
export function renderGreenfieldArchitectureYaml(language: string): string {
  const defaults = resolveDefaults(language);
  const lines: string[] = [
    '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify',
    '# Greenfield seed — no import graph observed yet. Re-run',
    '# `clad init --scan` after creating your source layout to capture',
    '# observed layers + forbidden_imports candidates; the observed body',
    '# will divert to `.cladding/scan/architecture.yaml.proposal` for review.',
    '#',
    `# Typical ${defaults.displayName} baseline:`,
    ...defaults.architectureBaseline.map((line) => `#${line}`),
    '#',
    '# Keep it efficient: a pure, dependency-light core; no premature abstraction —',
    '# add a layer only when it earns its existence. Highest quality is the simplest',
    '# structure that holds the domain, not the most layers.',
    '#',
    '# Edit `layers` below to match your project. Each entry shape:',
    '#   - name: <layer>',
    '#     modules: ["<dir>/**"]',
    '#     forbidden_imports: [<layer>, …]',
    'layers: []',
    '',
  ];
  return lines.join('\n');
}

/**
 * Renders the greenfield seed body for `spec/capabilities.yaml`.
 * Language-independent: the artifact mirrors README ## headings once
 * one exists, and capabilities are user-facing concepts not derived
 * from code conventions.
 *
 * @param projectName The basename surfaced in the guidance comment.
 */
export function renderGreenfieldCapabilitiesYaml(projectName: string): string {
  const lines: string[] = [
    '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init / clad clarify',
    '# Greenfield seed — no README ## headings observed yet. Re-run',
    '# `clad init --scan` after writing your README; this file will be',
    '# regenerated from observed headings and divert to',
    '# `.cladding/scan/capabilities.yaml.proposal` for review.',
    '#',
    `# Until then, list ${projectName}'s user-facing capabilities here.`,
    '# Each entry shape (v0.3.45+ adds optional `features:` for the',
    '# CAPABILITIES_FEATURE_MAPPING detector — see docs/ssot-model.md):',
    '#   - id: <kebab-slug>',
    '#     title: "<verbatim heading or feature name>"',
    '#     summary: "<one sentence — what this capability does>"',
    '#     surface: feature | platform | tool | infrastructure',
    '#     features: [F-<hash6>, ...]  # bind to spec.yaml features',
    'schema: "0.1"',
    'source: README.md',
    'capabilities: []',
    '',
  ];
  return lines.join('\n');
}
