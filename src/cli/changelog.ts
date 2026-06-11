// Cladding · `clad changelog` — the spec rendered into human-facing change documents
//
// Thin CLI wrapper (I/O + exit codes only); all logic lives in
// src/changelog/. Four surfaces:
//
//   default    — capability-grouped markdown (Soft Shell prose, no internal ids)
//   --json     — the deterministic ChangelogManifest (hosts render release
//                notes FROM this, in the project's language(s))
//   --audit    — the id-keeping `feature | AC | EARS | refs ✓/✗` table
//   --catalog  — the full capability → feature → AC catalog (no git range)
//
// Exit codes: 0 rendered · 2 bad/missing since ref (usage-style — an unknown
// ref must never render a silently empty changelog) · 1 other failure.

import process from 'node:process';

import {collectChangelog, defaultSinceRef} from '../changelog/collect.js';
import type {ChangelogManifest} from '../changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown} from '../changelog/render.js';
import {loadSpec} from '../spec/load.js';
import {pulse} from '../ui/pulse.js';

export interface ChangelogCommandOptions {
  readonly since?: string;
  readonly json?: boolean;
  readonly catalog?: boolean;
  readonly audit?: boolean;
  /** Project root (tests inject; the CLI always runs from the project root). */
  readonly cwd?: string;
}

/** Handler for `clad changelog [--since <ref>] [--json] [--catalog] [--audit]`. */
export function runChangelogCommand(opts: ChangelogCommandOptions): void {
  const cwd = opts.cwd ?? '.';

  // --catalog renders the whole living spec — no git range involved.
  if (opts.catalog) {
    try {
      process.stdout.write(`${renderCatalog(loadSpec(cwd))}\n`);
      process.exit(0);
    } catch (err) {
      pulse('fail', 'changelog', (err as Error).message);
      process.exit(1);
    }
    return;
  }

  let manifest: ChangelogManifest;
  try {
    const since = opts.since ?? defaultSinceRef(cwd);
    manifest = collectChangelog(cwd, since);
  } catch (err) {
    pulse('fail', 'changelog', (err as Error).message);
    process.exit(2);
    return;
  }

  try {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    } else if (opts.audit) {
      process.stdout.write(`${renderAuditTable(manifest, loadSpec(cwd), cwd)}\n`);
    } else {
      process.stdout.write(`${renderChangelogMarkdown(manifest)}\n`);
    }
    process.exit(0);
  } catch (err) {
    pulse('fail', 'changelog', (err as Error).message);
    process.exit(1);
  }
}
