// Cladding · Spec 0.2 F1 · deterministic independent corpus-snapshot writer.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';

import {
  independentCorpusSnapshotDigest,
  scanIndependentCorpus,
  serializeIndependentCorpusSnapshot,
} from '../src/spec/compiler/corpus-snapshot.js';

const SNAPSHOT_PATH = join('tests', 'spec', 'compiler', 'fixtures', 'self-corpus.snapshot.json');

/** Writes or verifies the sorted independent source-YAML corpus oracle. */
export function runCorpusSnapshot(argv: readonly string[], cwd: string = process.cwd()): {readonly changed: boolean; readonly digest: string} {
  const write = argv.length === 1 && argv[0] === '--write';
  if (!write && argv.length !== 0) throw new Error('usage: tsx scripts/spec-0.2-corpus-snapshot.ts [--write]');
  const snapshot = scanIndependentCorpus(cwd);
  const serialized = serializeIndependentCorpusSnapshot(snapshot);
  const schema = /^schema:\s*["']?([^\s"']+)/m.exec(readFileSync(join(cwd, 'spec.yaml'), 'utf8'))?.[1];
  // The committed three-megabyte oracle is the reviewed 0.1 corpus record.
  // Schema 0.2 moves historic test bindings into a source-bearing migration
  // receipt, so a second whole-repository snapshot would duplicate an audit
  // surface without improving detection. The compact schema-0.2 fixture pins
  // owner/proof/location behavior; this self command verifies that the live
  // migrated corpus exposes that independent historic-proof view as well.
  if (schema === '0.2') {
    if (snapshot.migrationProofs === undefined || snapshot.migrationProofs.length === 0) {
      throw new Error('schema 0.2 self corpus must expose migration proof bindings with source locations');
    }
    return {changed: false, digest: independentCorpusSnapshotDigest(snapshot)};
  }
  const destination = resolve(cwd, SNAPSHOT_PATH);
  const existing = existsSync(destination) ? readFileSync(destination, 'utf8') : '';
  if (write && existing !== serialized) {
    mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, serialized, 'utf8');
  }
  if (!write && existing !== serialized) throw new Error(`independent corpus snapshot is stale: run tsx scripts/spec-0.2-corpus-snapshot.ts --write`);
  return {changed: existing !== serialized, digest: independentCorpusSnapshotDigest(snapshot)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runCorpusSnapshot(process.argv.slice(2));
    process.stdout.write(`spec-0.2 corpus snapshot: ${result.changed ? 'written' : 'current'} ${result.digest}\n`);
  } catch (error) {
    process.stderr.write(`spec-0.2 corpus snapshot: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
