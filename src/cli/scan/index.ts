// Cladding · `clad init --scan` — orchestrator
//
// Single public entry: {@link scanRoot}. Composes the focused
// modules under cli/scan/ into a {@link ScanResult} ready for the
// caller (init.ts deterministic write or the LLM interpretation
// path in scan/llm.ts).
//
// The orchestrator is intentionally thin — every analyzer module
// owns a single responsibility, threshold defaults live in
// thresholds.ts, and types are centralised in types.ts. Adding a
// new analyzer or swapping a language detector means touching one
// file plus this composition.
//
// @see ironclad-design/07-ssot-init.md §3 B
// @see ironclad-design/14-agent-orchestration.md §2.1 #5 — minimum
//   context injection (scan output feeds AgentContext)

import {extractArchitecture, groupByLayer} from './architecture.js';
import {extractConventions} from './conventions.js';
import {extractProjectContext} from './docs.js';
import {pickExamples} from './examples.js';
import {inferSourceRoots} from './roots.js';
import {proposeScenarios} from './scenarios.js';
import {buildStats} from './stats.js';
import {walk} from './walker.js';
import type {ScanOptions, ScanResult} from './types.js';

/**
 * Walks the project, collects 14 convention signals, infers
 * architecture layers + forbidden_imports candidates, and selects
 * the representative module per layer. Returns a structured
 * {@link ScanResult} ready for {@link deterministicInterpret} (in
 * llm.ts) or an LLM dispatcher.
 *
 * The function is side-effect free — file writes happen in
 * init.ts so callers can preview the diff via `--dry-run` before
 * touching the working tree.
 *
 * @example
 *   const result = scanRoot({cwd: '/path/to/repo'});
 *   result.architecture.layers.map((l) => l.name); // ['cli', 'core', …]
 *
 * @see walker.ts · roots.ts · conventions.ts · architecture.ts
 *   · examples.ts · stats.ts · scenarios.ts
 */
export function scanRoot(opts: ScanOptions): ScanResult {
  const roots = inferSourceRoots({cwd: opts.cwd, override: opts.roots});
  const files = walk({
    root: opts.cwd,
    extensions: opts.extensions,
    ignore: opts.ignore,
    maxFiles: opts.maxFiles,
    perDirCap: opts.perDirCap,
    entrypoints: opts.entrypoints,
  });
  const filesByLayer = groupByLayer(files, roots, {
    cwd: opts.cwd,
    rootPromotionThreshold: opts.rootPromotionThreshold,
    layerBlacklist: opts.layerBlacklist,
  });
  return {
    conventions: extractConventions(files),
    architecture: extractArchitecture(files, filesByLayer, roots),
    scenarios: proposeScenarios(filesByLayer),
    examples: pickExamples(filesByLayer),
    stats: buildStats(files, opts.cwd),
    projectContext: extractProjectContext(opts.cwd, filesByLayer),
  };
}

// Public re-exports for callers (init.ts, scan-llm consumers, tests).
export {layerOf} from './architecture.js';
export {isEntrypointFile, walk} from './walker.js';
export {inferSourceRoots} from './roots.js';
export type {SourceRoot, InferenceOptions} from './roots.js';
export {
  buildPrompt,
  buildProjectContextPrompt,
  deterministicInterpret,
  interpretWithLlm,
  parseLlmResponse,
  parseProjectContextResponse,
  renderProjectContextMd,
  renderProjectContextMdWithLlm,
  type InterpretedScan,
  type ScanLlmDispatcher,
} from './llm.js';
export {selectDispatcher, type DispatcherOptions} from './dispatcher.js';
export {
  DEFAULT_EXTENSIONS,
  DEFAULT_IGNORE,
  DEFAULT_MAX_FILES,
  ENTRYPOINT_NAMES,
  EXT_TO_LANGUAGE,
  LAYER_BLACKLIST,
  PER_DIR_SOFT_CAP,
  ROOT_PROMOTION_THRESHOLD,
} from './thresholds.js';
export {
  extractDocLinks,
  extractInterfaceSignatures,
  extractProjectContext,
  extractReadmeFirstParagraph,
  extractReadmeHeadings,
} from './docs.js';
export type {
  ArchitectureScan,
  Conventions,
  ExampleQuote,
  ImportEdge,
  Layer,
  ProjectContext,
  ScanOptions,
  ScanResult,
  ScanStats,
  ScenarioStub,
  SourceFile,
} from './types.js';
