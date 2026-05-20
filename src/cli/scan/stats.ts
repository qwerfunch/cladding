// Cladding · scan · stats + language detection
//
// buildStats produces the {@link ScanStats} record consumed by
// runInit (for the spec.yaml `language:` field) and downstream
// telemetry. dominantLanguage prefers file-extension majority over
// any manifest signal — Python / Go / Ruby projects that ship a
// package.json for tooling no longer get mis-labelled as TypeScript
// (audit I13, v0.3.27).

import {extname} from 'node:path';

import {EXT_TO_LANGUAGE} from './thresholds.js';
import type {ScanStats, SourceFile} from './types.js';

/**
 * Builds the ScanStats record from the walker output.
 *
 * @example
 *   const stats = buildStats(files, '/path/to/repo');
 *   stats.dominantLanguage // 'python'
 */
export function buildStats(files: readonly SourceFile[], cwd: string): ScanStats {
  const counts: Record<string, number> = {};
  for (const f of files) {
    const lang = EXT_TO_LANGUAGE[extname(f.path)] ?? 'other';
    counts[lang] = (counts[lang] ?? 0) + 1;
  }
  let dominant: [string, number] | null = null;
  for (const entry of Object.entries(counts)) {
    if (!dominant || entry[1] > dominant[1]) dominant = entry;
  }
  return {
    filesScanned: files.length,
    languagesSeen: Array.from(new Set(files.map((f) => extname(f.path)))).sort(),
    languageCounts: counts,
    dominantLanguage: dominant?.[0] ?? 'unknown',
    sourceRoot: cwd,
  };
}
