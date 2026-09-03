#!/usr/bin/env node
// Cladding · attestation v3 compaction (F-6f0a2106 / AC-6f0a2116).
//
// Before the observation-set digest, every `attested_v3` row inlined the whole
// sorted identity list, so `spec/attestation.yaml` grew with
// `features × obligations` — 287 rows reached 76 MB, past GitHub's push
// warning. This rewrites such a row into the shape the current writer mints:
// `observation_set_sha256` (SHA-256 of the compact JSON array of the sorted,
// unique identities) plus `observation_count`, at the exact position the array
// occupied, so the row's key order is the minted key order.
//
// The attestation is not read or written as YAML: `renderAttestation` emits one
// `  <feature>: <JSON.stringify(row)>` line per row and `readAttestation`
// parses those lines with a regex. So this transform is line-based and
// self-contained (no `src/` import, no YAML library) — which is what lets it
// run against any historical checkout during a branch-history rewrite, and
// what makes an already-compact file come back byte-identical.
//
// Usage: node scripts/compact-attestation-v3.mjs <path-to-attestation.yaml>
// Prints `compacted N rows`; a second run over its own output prints
// `compacted 0 rows` and leaves the bytes untouched.

import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

/** Orders identities by UTF-16 code unit, matching the writer's `compareCodeUnits`. */
function compareCodeUnits(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Content-addresses one observation identity set exactly as the writer does.
 *
 * @param {readonly string[]} identities - Stored identities, in any order.
 * @returns {string} SHA-256 of the compact JSON array of the sorted, unique identities.
 */
export function observationSetSha256(identities) {
  return createHash('sha256')
    .update(JSON.stringify([...new Set(identities)].sort(compareCodeUnits)), 'utf8')
    .digest('hex');
}

/**
 * Rebuilds one object with an inlined list replaced by its address, in place.
 *
 * Rebuilding key by key (rather than deleting and appending) is what keeps the
 * rewritten row's key order equal to the minted row's, so a re-stamp of the
 * same facts produces the same bytes.
 *
 * @param {Record<string, unknown>} source - Parsed object carrying the array.
 * @param {string} listKey - Key holding the inlined identity array.
 * @param {(list: readonly string[]) => Record<string, unknown>} replacement - Fields to emit in its place.
 * @returns {Record<string, unknown>} Rebuilt object.
 */
function withListReplacedByAddress(source, listKey, replacement) {
  const rebuilt = {};
  const emitted = replacement(source[listKey]);
  for (const [key, value] of Object.entries(source)) {
    if (key in emitted) continue;
    if (key !== listKey) {
      rebuilt[key] = value;
      continue;
    }
    Object.assign(rebuilt, emitted);
  }
  return rebuilt;
}

/**
 * Rewrites the legacy rows of one attestation document.
 *
 * Only lines inside the `attested_v3:` section are considered, and only those
 * whose JSON actually carries an identity array — the row's own observation
 * list, its `migration_baseline` authorization list, or both. A row already
 * compact, a malformed row, and every other section pass through unchanged, so
 * the output of a compact input is the input.
 *
 * @param {string} text - Whole attestation file contents.
 * @returns {{text: string, compacted: number}} Rewritten contents and row count.
 */
export function compactAttestationV3(text) {
  const lines = text.split('\n');
  let inV3 = false;
  let compacted = 0;
  const out = lines.map((line) => {
    // Section headers are the only unindented, non-comment lines the writer
    // emits, so leaving `attested_v3:` is simply reaching the next one.
    if (/^[A-Za-z_][\w]*:$/.test(line)) {
      inV3 = line === 'attested_v3:';
      return line;
    }
    if (!inV3) return line;
    const row = line.match(/^ {2}(F-[\w-]+): (.+)$/);
    if (!row) return line;
    let parsed;
    try {
      parsed = JSON.parse(row[2]);
    } catch {
      // A row this script cannot read is a row it must not rewrite; the gate
      // re-stamps an unreadable row anyway.
      return line;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return line;
    const summary = parsed.migration_baseline;
    const hasIdentities = Array.isArray(parsed.observation_identities);
    const hasAuthorizations = !!summary && typeof summary === 'object' && !Array.isArray(summary)
      && Array.isArray(summary.criterion_authorization_sha256);
    if (!hasIdentities && !hasAuthorizations) return line;
    let rebuilt = parsed;
    if (hasIdentities) {
      rebuilt = withListReplacedByAddress(rebuilt, 'observation_identities', (identities) => ({
        observation_set_sha256: observationSetSha256(identities),
        observation_count: new Set(identities).size,
      }));
    }
    if (hasAuthorizations) {
      rebuilt = {
        ...rebuilt,
        migration_baseline: withListReplacedByAddress(summary, 'criterion_authorization_sha256', (authorizations) => ({
          criterion_authorization_set_sha256: observationSetSha256(authorizations),
        })),
      };
    }
    compacted += 1;
    return `  ${row[1]}: ${JSON.stringify(rebuilt)}`;
  });
  return {text: out.join('\n'), compacted};
}

function main(argv) {
  const path = argv[2];
  if (!path) {
    process.stderr.write('usage: node scripts/compact-attestation-v3.mjs <path-to-attestation.yaml>\n');
    return 2;
  }
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    process.stderr.write(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const result = compactAttestationV3(text);
  // Writing only on a real change keeps a no-op run from touching mtime, which
  // matters when this runs across every commit of a history rewrite.
  if (result.compacted > 0) writeFileSync(path, result.text);
  process.stdout.write(`compacted ${result.compacted} rows\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv));
}
