// Cladding · scan · shared types
//
// Public type surface for the scan pipeline. Every cli/scan/<module>
// imports its types from here so the orchestrator (index.ts) and
// downstream consumers (init.ts, scan-llm) see a single shape.

import type {SourceRoot} from './roots.js';

/** Per-call config for {@link scanRoot}. */
export interface ScanOptions {
  /** Project root cladding is adopting into. */
  readonly cwd: string;
  /** File extensions to analyse. Override the v0.3.26 polyglot default. */
  readonly extensions?: readonly string[];
  /** Directory names ignored at walk time (tooling caches, etc.). */
  readonly ignore?: readonly string[];
  /** Layer-blacklist override — peer dirs walked but hidden from layers. */
  readonly layerBlacklist?: ReadonlySet<string>;
  /** Entrypoint name override — file stems sorted to the head of each dir. */
  readonly entrypoints?: ReadonlySet<string>;
  /** Hard cap on files scanned to keep cost predictable. */
  readonly maxFiles?: number;
  /** Per-directory soft cap before BFS walker moves on. */
  readonly perDirCap?: number;
  /** _root-bucket promotion threshold for flat single-package projects. */
  readonly rootPromotionThreshold?: number;
  /**
   * Explicit source-root override (e.g. `--roots packages/a/src,packages/b/src`).
   * When unset, {@link inferSourceRoots} probes manifests + heuristics.
   */
  readonly roots?: readonly string[];
}

/** Deterministic convention observations. */
export interface Conventions {
  readonly indent: 'two-space' | 'four-space' | 'tab' | 'mixed';
  readonly quote: 'single' | 'double' | 'mixed';
  readonly semicolon: 'present' | 'absent' | 'mixed';
  readonly namingExports: 'camelCase' | 'snake_case' | 'PascalCase' | 'mixed';
  readonly namingConstants: 'UPPER_SNAKE' | 'camelCase' | 'mixed';
  readonly docBlockRatio: number;
  readonly docTagCounts: Readonly<Record<string, number>>;
  readonly importOrder: 'node-first' | 'external-first' | 'mixed' | 'unknown';
  readonly exportPattern: 'named-only' | 'default-mixed' | 'default-primary' | 'unknown';
  readonly errorHandling: 'throw-primary' | 'result-pattern' | 'mixed';
  readonly typeDefLocation: 'inline' | 'types-file' | 'mixed';
  readonly fileHeaderPattern: string | null;
  readonly testLocation: 'sibling-test' | 'tests-dir' | 'tests-and-sibling' | 'none';
  readonly moduleBoilerplate: string | null;
}

/** A top-level directory treated as one architectural layer. */
export interface Layer {
  readonly name: string;
  readonly dir: string;
  readonly moduleCount: number;
}

/** One directed edge in the inferred import graph. */
export interface ImportEdge {
  readonly from: string;
  readonly to: string;
  readonly count: number;
}

export interface ArchitectureScan {
  readonly layers: readonly Layer[];
  readonly importGraph: readonly ImportEdge[];
  /**
   * Layer pairs with no observed import edge — surfaces as
   * `forbidden_imports` candidates in the generated
   * `spec/architecture.yaml`. Reviewer (or future LLM dispatcher)
   * prunes the list before committing.
   */
  readonly forbiddenImportCandidates: Readonly<Record<string, readonly string[]>>;
}

export interface ScenarioStub {
  readonly slug: string;
  readonly dir: string;
  readonly moduleCount: number;
}

/** Representative module quoted directly into docs/conventions.md. */
export interface ExampleQuote {
  readonly layer: string;
  readonly modulePath: string;
  readonly moduleContent: string;
  readonly testPath?: string;
  readonly testContent?: string;
}

/**
 * Forest-level project context extracted from README + sibling docs.
 * Lives at `docs/project-context.md` once init renders it. Null when
 * the project has no README — caller renders the template instead.
 *
 * v0.3.32 — every field is observed text (no LLM inference yet);
 * v0.3.33+ adds a parallel LLM-refined section so the "Why" and
 * "Purpose" surface as clean prose instead of raw README quotes.
 */
export interface ProjectContext {
  /** First paragraph of README.md, raw quoted. Null if no README. */
  readonly readmeFirstParagraph: string | null;
  /** `## ` heading list from README, top-10 in document order. */
  readonly readmeHeadings: readonly string[];
  /** Sibling docs found (ARCHITECTURE.md, CONTRIBUTING.md, docs/*.md), top-5. */
  readonly docLinks: readonly {readonly path: string; readonly firstLine: string}[];
  /** TS interface/class signatures from the two largest layers, top-3 each. */
  readonly interfaceSignatures: readonly {readonly layer: string; readonly signatures: readonly string[]}[];
}

export interface ScanResult {
  readonly conventions: Conventions;
  readonly architecture: ArchitectureScan;
  readonly scenarios: readonly ScenarioStub[];
  readonly examples: readonly ExampleQuote[];
  readonly stats: ScanStats;
  /** Forest-level context (v0.3.32). Null when README is absent. */
  readonly projectContext: ProjectContext | null;
}

export interface ScanStats {
  readonly filesScanned: number;
  readonly languagesSeen: readonly string[];
  readonly languageCounts: Readonly<Record<string, number>>;
  readonly dominantLanguage: string;
  readonly sourceRoot: string;
}

/** Internal walker output — kept here so per-module helpers share the shape. */
export interface SourceFile {
  readonly path: string;
  readonly relPath: string;
  readonly content: string;
  readonly loc: number;
}

export type {SourceRoot};
