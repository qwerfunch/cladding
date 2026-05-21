// Cladding · spec · inventory (v0.3.56, F-5b9f9f)
//
// Auto-maintained shard counts. `clad sync` rewrites the `inventory:`
// block of spec.yaml on every run so AI agents can grep ONE file
// and see the project's whole scale instead of walking spec/features/,
// spec/scenarios/, tests/, etc.
//
// Last-synced uses ISO date (YYYY-MM-DD) only — keeps spec.yaml
// commit-stable across multiple runs on the same day.

import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import yaml from 'yaml';

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
function countTestFiles(testsRoot: string): number {
  if (!existsSync(testsRoot)) return 0;
  let count = 0;
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
        count++;
      }
    }
  }
  return count;
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
 * Computes the current inventory by reading the disk. Uses ISO date
 * (YYYY-MM-DD) for `last_synced` so multiple sync runs on the same
 * day produce identical output (commit-stable).
 */
export function computeInventory(cwd: string = '.'): Inventory {
  const features = countYamlShards(join(cwd, 'spec', 'features'));
  const scenarios = countYamlShards(join(cwd, 'spec', 'scenarios'));
  const capabilities = countCapabilities(cwd);
  const test_files = countTestFiles(join(cwd, 'tests'));
  const last_synced = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return {features, scenarios, capabilities, test_files, last_synced};
}

/**
 * Rewrites the `inventory:` block at the bottom of spec.yaml. If no
 * block exists, appends one. Preserves all other lines + comments.
 *
 * Strategy: split the file body at the first `^inventory:` line, drop
 * the inventory block (everything up to the next top-level key or EOF),
 * then re-emit. This is line-based to keep comments + ordering of
 * other top-level keys (`features:`, etc.) intact.
 */
export function writeInventoryToSpecYaml(cwd: string, inventory: Inventory): void {
  const path = join(cwd, 'spec.yaml');
  if (!existsSync(path)) return;
  const body = readFileSync(path, 'utf8');
  const rebuilt = upsertInventoryBlock(body, inventory);
  if (rebuilt !== body) {
    writeFileSync(path, rebuilt);
  }
}

/** Pure function — used both by writeInventoryToSpecYaml and by tests. */
export function upsertInventoryBlock(body: string, inventory: Inventory): string {
  const lines = body.split('\n');
  const inventoryStart = lines.findIndex((line) => /^inventory:\s*$/.test(line));

  // Render the new inventory block.
  const newBlock: string[] = [
    '# Auto-maintained by `clad sync` (F-5b9f9f). Do not edit by hand.',
    'inventory:',
    `  features: ${inventory.features ?? 0}`,
    `  scenarios: ${inventory.scenarios ?? 0}`,
    `  capabilities: ${inventory.capabilities ?? 0}`,
    `  test_files: ${inventory.test_files ?? 0}`,
    `  last_synced: ${JSON.stringify(inventory.last_synced ?? '')}`,
  ];

  if (inventoryStart < 0) {
    // No existing block — append to end (trim trailing newlines first).
    let trimmed = body.replace(/\n+$/, '');
    if (trimmed.length > 0) trimmed += '\n';
    return `${trimmed}\n${newBlock.join('\n')}\n`;
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
  return [...before, ...newBlock, '', ...after.filter((l, i) => !(i === 0 && l.trim() === ''))].join('\n').replace(/\n{3,}/g, '\n\n');
}
