// Cladding · spec · inventory (v0.3.56, F-5b9f9f)
//
// Auto-maintained shard counts. `clad sync` rewrites the `inventory:`
// block of spec.yaml on every run so AI agents can grep ONE file
// and see the project's whole scale instead of walking spec/features/,
// spec/scenarios/, tests/, etc.
//
// The block is counts only — an unchanged-count re-sync is
// byte-identical, so parallel branches never conflict on it.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';

import yaml, {parse} from 'yaml';

import {requiredRootSchema} from './transaction.js';
import type {Inventory} from './types.js';

/** Counts a directory's .yaml children, excluding README.md. */
function countYamlShards(dir: string): number {
  if (!existsSync(dir)) return 0;
  try {
    return readdirSync(dir).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml')).length;
  } catch {
    return 0;
  }
}

/** Walks tests/ recursively for *.test.ts(x). */
function testFileNames(testsRoot: string, cwd: string): readonly string[] {
  if (!existsSync(testsRoot)) return [];
  const names: string[] = [];
  const queue: string[] = [testsRoot];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: readonly string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name === '.cladding' || name.startsWith('.')) continue;
      const abs = join(dir, name);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        queue.push(abs);
      } else if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) {
        names.push(relative(cwd, abs).replace(/\\/g, '/'));
      }
    }
  }
  return names.sort();
}

/** Returns the sorted test-file census used by the inventory projection. */
export function inventoryTestFileNames(cwd: string = '.'): readonly string[] {
  return testFileNames(join(cwd, 'tests'), cwd);
}

/** One coherent test-file census for migration review and derived inventory. */
export interface InventoryTestFileCensus {
  /** Sorted workspace-relative test names. */
  readonly names: readonly string[];
  /** Count from exactly the same names array. */
  readonly count: number;
  /** SHA-256 of exactly the same names array. */
  readonly digest: string;
}

/** Takes the test census once so count and digest cannot describe different scans. */
export function inventoryTestFileCensus(cwd: string = '.'): InventoryTestFileCensus {
  const names = inventoryTestFileNames(cwd);
  return {names, count: names.length, digest: createHash('sha256').update(JSON.stringify(names)).digest('hex')};
}

/** Returns the reviewed test-file-set digest used by a schema migration preview. */
export function inventoryTestFileSetDigest(cwd: string = '.'): string {
  return inventoryTestFileCensus(cwd).digest;
}

/** Parses spec/capabilities.yaml and counts the capabilities[] entries. */
function countCapabilities(cwd: string): number {
  const path = join(cwd, 'spec', 'capabilities.yaml');
  if (!existsSync(path)) return 0;
  try {
    const parsed = yaml.parse(readFileSync(path, 'utf8')) as {capabilities?: readonly unknown[]} | null;
    return Array.isArray(parsed?.capabilities) ? parsed.capabilities.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Computes the current inventory by reading the disk. Counts only —
 * no timestamp — so repeated syncs on unchanged shards produce
 * identical output (commit-stable).
 */
export function computeInventory(cwd: string = '.'): Inventory {
  const features = countYamlShards(join(cwd, 'spec', 'features'));
  const scenarios = countYamlShards(join(cwd, 'spec', 'scenarios'));
  const capabilities = countCapabilities(cwd);
  const test_files = inventoryTestFileNames(cwd).length;
  return {features, scenarios, capabilities, test_files};
}

/**
 * Renders the `inventory:` block at the bottom of spec.yaml. If no block
 * exists, appends one while preserving all other lines and comments. Product
 * writes go through the F4 transaction boundary in `spec/edit.ts`.
 */
export function upsertInventoryBlock(body: string, inventory: Inventory): string {
  // CRLF-safe: split on either ending so no `\r` survives on a line, do all the
  // line surgery in LF, then restore the file's original ending at the single
  // exit. A git-autocrlf checkout on Windows otherwise left mixed endings here.
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const inventoryStart = lines.findIndex((line) => /^inventory:\s*$/.test(line));

  // Render the new inventory block.
  const newBlock: string[] = [
    '# Auto-maintained by `clad sync` (F-5b9f9f). Do not edit by hand.',
    'inventory:',
    `  features: ${inventory.features ?? 0}`,
    `  scenarios: ${inventory.scenarios ?? 0}`,
    `  capabilities: ${inventory.capabilities ?? 0}`,
    `  test_files: ${inventory.test_files ?? 0}`,
  ];

  const withEol = (lf: string): string => (eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf);

  if (inventoryStart < 0) {
    // No existing block — append to end (trim trailing newlines first).
    let trimmed = lines.join('\n').replace(/\n+$/, '');
    if (trimmed.length > 0) trimmed += '\n';
    return withEol(`${trimmed}\n${newBlock.join('\n')}\n`);
  }

  // Existing block — drop it (and the comment line right above, if it
  // matches our marker), then splice in the new block at the same spot.
  let blockStart = inventoryStart;
  if (blockStart > 0 && /Auto-maintained by `clad sync`/.test(lines[blockStart - 1])) {
    blockStart -= 1;
  }
  // Find end of block: first line that doesn't start with `  ` or `#`
  // (top-level key or blank line at end of file).
  let blockEnd = inventoryStart + 1;
  while (blockEnd < lines.length && (lines[blockEnd].startsWith('  ') || lines[blockEnd].trim() === '')) {
    if (lines[blockEnd].trim() === '' && blockEnd > inventoryStart + 1) break;
    blockEnd++;
  }
  // Replace.
  const before = lines.slice(0, blockStart);
  const after = lines.slice(blockEnd);
  // Ensure exactly one blank line before the new block (and after, before next content).
  while (before.length > 0 && before[before.length - 1].trim() === '') before.pop();
  before.push('');
  return withEol(
    [...before, ...newBlock, '', ...after.filter((l, i) => !(i === 0 && l.trim() === ''))]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n'),
  );
}

/**
 * F-37b4a8 — generated feature index. With sharding, "which feature owns X"
 * was an N-file directory scan (the extended A/B's H10 caveat); this emits
 * spec/index.yaml with ONE id-sorted line per feature so lookup is a 1-file
 * grep at any shard count. Committed-but-derived (Tier C): regenerated on
 * every sync; line-per-feature keeps git merges union-friendly. Unsharded
 * specs (no spec/features/ dir) get no index — they already fit in one file.
 */
export function renderFeatureIndexYaml(cwd: string = '.'): string | null {
  if (existsSync(join(cwd, 'spec.yaml')) && requiredRootSchema(cwd) === '0.2') {
    throw new Error('Schema 0.2 feature indexes are compiler-owned; use the compiler transaction projection.');
  }
  const featuresDir = join(cwd, 'spec', 'features');
  if (!existsSync(featuresDir)) return null;
  const rows: string[] = [];
  for (const file of readdirSync(featuresDir).sort()) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    try {
      const doc = parse(readFileSync(join(featuresDir, file), 'utf8')) as {
        id?: string;
        slug?: string;
        status?: string;
        modules?: unknown[];
      } | null;
      if (!doc?.id) continue;
      const slug = doc.slug ?? file.replace(/\.(ya?ml)$/, '');
      rows.push(`  ${doc.id}: {slug: ${slug}, status: ${doc.status ?? 'planned'}, modules: ${(doc.modules ?? []).length}}`);
    } catch {
      continue; // unparseable shard → ABSENCE_OF_GOVERNANCE owns that signal
    }
  }
  rows.sort();
  return (
    '# Cladding · Tier C — generated feature index (`clad sync`). Do not edit by hand.\n' +
    '# One line per feature → 1-file lookup + line-independent merges\n' +
    '# (suggested .gitattributes: `spec/index.yaml merge=union`).\n' +
    'features:\n' +
    rows.join('\n') +
    '\n'
  );
}
