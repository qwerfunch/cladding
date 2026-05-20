// Cladding · scan · representative module selection
//
// pickExamples chooses one representative module per architectural
// layer — the one quoted directly into docs/conventions.md so AI
// maintainers see the prevailing idiom. Centrality is approximated
// as LOC (the densest non-test module per layer usually reflects
// the idiom most strongly). A sibling test file is paired when its
// basename matches `<module>.test.<ext>`.

import {basename, extname} from 'node:path';

import type {ExampleQuote, SourceFile} from './types.js';

/**
 * Picks the longest non-test module per layer + its paired test.
 *
 * @example
 *   const examples = pickExamples(filesByLayer);
 *   examples[0] // { layer: 'core', modulePath: 'src/core/main.ts', ... }
 */
export function pickExamples(
  filesByLayer: ReadonlyMap<string, SourceFile[]>,
): readonly ExampleQuote[] {
  const out: ExampleQuote[] = [];
  for (const [layer, files] of filesByLayer) {
    if (layer === '_root') continue;
    const code = files
      .filter((f) => !/\.test\.[jt]sx?$/.test(f.relPath))
      .sort((a, b) => b.loc - a.loc)[0];
    if (!code) continue;
    const base = basename(code.relPath, extname(code.relPath));
    const test = files.find(
      (f) =>
        /\.test\.[jt]sx?$/.test(f.relPath) &&
        basename(f.relPath, extname(f.relPath)).startsWith(`${base}.test`),
    );
    out.push({
      layer,
      modulePath: code.relPath,
      moduleContent: code.content.split('\n').slice(0, 80).join('\n'),
      testPath: test?.relPath,
      testContent: test ? test.content.split('\n').slice(0, 60).join('\n') : undefined,
    });
  }
  out.sort((a, b) => a.layer.localeCompare(b.layer));
  return out;
}
