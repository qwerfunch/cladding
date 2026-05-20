// Cladding · one-shot migration script (v0.3.16, F-091)
//
// Migrates F-082 ~ F-090 from sequential ID format to the hash-based
// model that v0.3.9 introduced. These nine spec files were authored
// AFTER v0.3.9 but the cladding maintainer (Claude) bypassed
// `clad_create_feature` and `Write`-d sequential filenames directly,
// breaking the dogfood promise.
//
// This script is invoked **once** to restore consistency. It is
// committed as a permanent record of what changed; future feature
// creation flows through `clad_create_feature` (or its CLAUDE.md-
// documented manual equivalent).
//
// Operations:
//   1. For each (oldId, slug, newId) in MIGRATIONS:
//      - Read spec/features/<oldId>.yaml
//      - Replace `id: <oldId>` with `id: <newId>`
//      - Ensure a `slug: <slug>` line is present (insert after id if missing)
//      - Write to spec/features/<slug>-<hash>.yaml
//      - Delete the old <oldId>.yaml
//   2. Walk every spec/features/*.yaml and every CHANGELOG.md /
//      README.md / docs/**.md file, replacing references to the old
//      IDs in `depends_on` arrays with the new hash IDs. The pattern
//      is narrowed to "F-NNN" inside yaml depends_on lists; freeform
//      prose references (CHANGELOG history, README, docs) stay as
//      legacy identifiers because they describe past releases.

import {existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * @type {ReadonlyArray<{oldId: string; slug: string; newId: string}>}
 */
const MIGRATIONS = [
  {oldId: 'F-082', slug: 'gemini-cli-dogfood', newId: 'F-b61449'},
  {oldId: 'F-083', slug: 'claude-code-dogfood', newId: 'F-6f80e7'},
  {oldId: 'F-084', slug: 'spec-id-multi-dev-safety', newId: 'F-67e33f'},
  {oldId: 'F-085', slug: 'spec-id-hash-filename-and-lookup', newId: 'F-24062d'},
  {oldId: 'F-086', slug: 'multidev-integration-test-and-scenario-regex', newId: 'F-59f093'},
  {oldId: 'F-087', slug: 'scenario-hash-model', newId: 'F-d7312b'},
  {oldId: 'F-088', slug: 'architecture-from-spec', newId: 'F-42af48'},
  {oldId: 'F-089', slug: 'external-docs-update-v0-3-13', newId: 'F-fcece7'},
  {oldId: 'F-090', slug: 'version-bump-script', newId: 'F-6d943d'},
];

const FEATURES_DIR = 'spec/features';

function migrateFile({oldId, slug, newId}) {
  const oldPath = join(FEATURES_DIR, `${oldId}.yaml`);
  if (!existsSync(oldPath)) {
    console.log(`  ${oldId}: file already missing (already migrated?)`);
    return;
  }
  const hash = newId.slice(2);
  const newPath = join(FEATURES_DIR, `${slug}-${hash}.yaml`);
  let body = readFileSync(oldPath, 'utf8');

  // Replace id: line.
  body = body.replace(new RegExp(`^id:\\s*${oldId}\\b`, 'm'), `id: ${newId}`);

  // Insert slug line if missing.
  if (!/^slug:/m.test(body)) {
    body = body.replace(/^(id: \S+)\n/m, `$1\nslug: ${slug}\n`);
  }

  writeFileSync(newPath, body);
  unlinkSync(oldPath);
  console.log(`  ${oldId} → ${newId} (${slug}) · ${newPath}`);
}

function rewriteCrossReferences() {
  const idMap = new Map(MIGRATIONS.map((m) => [m.oldId, m.newId]));
  const files = readdirSync(FEATURES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .map((f) => join(FEATURES_DIR, f));
  let edits = 0;
  for (const file of files) {
    const original = readFileSync(file, 'utf8');
    let body = original;
    for (const [oldId, newId] of idMap) {
      // Match the id only when it appears as a list element inside a
      // depends_on or similar block: `  - F-NNN` or `[F-NNN, ...]`.
      // Keep prose references in title/text/response unchanged.
      body = body.replace(new RegExp(`(\\n\\s*-\\s+)${oldId}\\b`, 'g'), `$1${newId}`);
      body = body.replace(new RegExp(`\\[${oldId}\\b`, 'g'), `[${newId}`);
      body = body.replace(new RegExp(`,\\s*${oldId}\\b`, 'g'), (match) =>
        match.replace(oldId, newId),
      );
    }
    if (body !== original) {
      writeFileSync(file, body);
      edits++;
    }
  }
  console.log(`  cross-references updated in ${edits} file(s)`);
}

console.log('cladding v0.3.16 dogfood-recovery migration\n');
console.log('1. Renaming files + writing new ids:');
for (const m of MIGRATIONS) migrateFile(m);
console.log('\n2. Rewriting depends_on cross-references:');
rewriteCrossReferences();
console.log('\nDone. Verify with: node bin/clad sync && node bin/clad check --strict');
