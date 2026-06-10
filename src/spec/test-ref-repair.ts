// Cladding · test_ref repair + derived suggestions (F-c037ae)
//
// The Scale A/B's single biggest cost was annotation drift: the gate refused
// 9 CORRECT features because test_ref strings lagged file moves. A severity
// downgrade cannot fix that (clad done gates on --strict, where warn fails);
// deterministic auto-repair can — resolve the ref again and the gate goes
// legitimately green.
//
// Two operations, both sync-time, both conservative:
//   REPAIR  — a done AC's test_ref whose path is gone but whose basename
//             matches exactly ONE file under tests/ is rewritten in place
//             (anchor preserved). Ambiguity = no rewrite; repair never guesses.
//   SUGGEST — a done AC with NO test_refs gains a `derived:`-prefixed
//             candidate when a test file matches the feature slug or a
//             module basename. Suggestions NEVER satisfy MISSING_TESTS and
//             are skipped by UNTESTED_AC (see those detectors) — only the
//             author removing the prefix makes them count. No manufactured
//             evidence.

import {existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {basename, join, relative} from 'node:path';

import {parse} from 'yaml';

const SKIP_PREFIXES = ['self-dogfood:', 'fixture:', 'derived:'];
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

export interface RepairOutcome {
  /** `old → new` rewrites applied (path part only; anchors preserved). */
  readonly repaired: ReadonlyArray<{readonly shard: string; readonly from: string; readonly to: string}>;
  /** `derived:` suggestions appended. */
  readonly suggested: ReadonlyArray<{readonly shard: string; readonly ref: string}>;
}

/** Recursively collect test files under tests/ (bounded: skips dotdirs). */
function collectTestFiles(root: string, dir = root, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    const abs = join(dir, e);
    try {
      if (statSync(abs).isDirectory()) collectTestFiles(root, abs, acc);
      else if (TEST_FILE.test(e)) acc.push(abs);
    } catch {
      continue;
    }
  }
  return acc;
}

/**
 * Repairs stale test_refs and appends derived suggestions across all done
 * features' shards. Text-level edits (string replace / line append) keep the
 * shard byte-stable everywhere else — no parse-and-reserialize churn.
 */
export function repairTestRefs(cwd: string = '.'): RepairOutcome {
  const featuresDir = join(cwd, 'spec', 'features');
  const testsRoot = join(cwd, 'tests');
  const repaired: {shard: string; from: string; to: string}[] = [];
  const suggested: {shard: string; ref: string}[] = [];
  if (!existsSync(featuresDir) || !existsSync(testsRoot)) return {repaired, suggested};

  const testFiles = collectTestFiles(testsRoot);
  const byBasename = new Map<string, string[]>();
  for (const abs of testFiles) {
    const rel = relative(cwd, abs).split('\\').join('/');
    const list = byBasename.get(basename(abs)) ?? [];
    list.push(rel);
    byBasename.set(basename(abs), list);
  }

  for (const file of readdirSync(featuresDir)) {
    if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
    const shardPath = join(featuresDir, file);
    let body: string;
    let doc: {
      slug?: string;
      status?: string;
      modules?: string[];
      acceptance_criteria?: {id?: string; test_refs?: string[]; evidence_refs?: string[]}[];
    } | null;
    try {
      body = readFileSync(shardPath, 'utf8');
      doc = parse(body) as typeof doc;
    } catch {
      continue;
    }
    if (!doc || doc.status !== 'done') continue;

    let changed = false;

    // REPAIR — unique-basename rewrite of unresolved refs.
    for (const ac of doc.acceptance_criteria ?? []) {
      for (const ref of ac.test_refs ?? []) {
        if (SKIP_PREFIXES.some((p) => ref.startsWith(p))) continue;
        const pathPart = ref.split('#', 1)[0];
        if (existsSync(join(cwd, pathPart))) continue;
        const candidates = byBasename.get(basename(pathPart)) ?? [];
        if (candidates.length !== 1) continue; // ambiguous or none — never guess
        const to = ref.replace(pathPart, candidates[0]);
        if (to === ref) continue; // no-op rewrite — never loop on our own output
        if (!body.includes(ref)) continue; // anchor formatting drift — leave it
        body = body.split(ref).join(to);
        repaired.push({shard: file, from: ref, to});
        changed = true;
      }
    }

    // SUGGEST — derived candidates for done ACs with zero test_refs.
    const slug = doc.slug ?? '';
    const moduleBases = (doc.modules ?? []).map((m) => basename(m).replace(/\.[jt]sx?$/, ''));
    const candidateForFeature = testFiles
      .map((abs) => relative(cwd, abs).split('\\').join('/'))
      .find((rel) => {
        const base = basename(rel).replace(TEST_FILE, '');
        return (slug !== '' && base === slug) || moduleBases.includes(base);
      });
    if (candidateForFeature) {
      for (const ac of doc.acceptance_criteria ?? []) {
        if ((ac.test_refs?.length ?? 0) > 0 || (ac.evidence_refs?.length ?? 0) > 0) continue;
        if (!ac.id) continue;
        // Append after the AC's `- id:` line: a test_refs block with the suggestion.
        const acLine = new RegExp(`^(([ ]+)- id: ${ac.id}\\b.*)$`, 'm');
        const m = body.match(acLine);
        if (!m) continue;
        const indent = m[2] + '  ';
        body = body.replace(
          acLine,
          `$1\n${indent}test_refs:\n${indent}  - "derived:${candidateForFeature}"`,
        );
        suggested.push({shard: file, ref: `derived:${candidateForFeature}`});
        changed = true;
      }
    }

    if (changed) writeFileSync(shardPath, body, 'utf8');
  }
  return {repaired, suggested};
}
