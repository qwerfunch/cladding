// Cladding · spec · deliverable auto-detection (v0.5.x)
//
// Closes the gap an A/B re-run exposed: DELIVERABLE_SMOKE (stage_2.4) only fires when the author
// declares project.deliverable with is_safe_to_smoke:true + a working smoke invocation — and a
// conservative autonomous agent, nudged by the DELIVERABLE_INTEGRITY warn, declared it DISABLED
// (is_safe_to_smoke:false) with NO smoke_args. So the fix never engaged.
//
// `clad sync` calls maintainDeliverable: when project.deliverable is ABSENT and a CLI entry is
// detected, cladding CALIBRATES a smoke invocation against the CURRENT (passing) code — and only sets
// is_safe_to_smoke:true once it has PROVEN an invocation that exits 0 right now. This guarantees no
// false-fail (a working entry is never red-flagged) and removes the agent-configuration dependency for
// the cases it can cover. Running before the agent reacts to the warn means the deliverable is present
// + correct, so the agent never needs to declare it (and never disables it).
//
// HONEST REACH LIMIT: a file-consuming CLI (e.g. an interpreter `./run program.ml`) with NO committed
// sample input cannot be calibrated — cladding can't synthesize a valid program (unknown syntax), an
// empty file doesn't reach the per-statement code path, and arbitrary bytes false-fail a working
// interpreter. Such a deliverable is left undeclared (DELIVERABLE_INTEGRITY keeps warning) — the
// impl-blind oracle (stage_2.3) or an author-provided smoke_args remains the answer there.

import {execaSync} from 'execa';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';

import type {Deliverable} from './types.js';
import {commitSchema01CompatibilityMutation} from './edit.js';

const CALIBRATE_TIMEOUT_MS = 5000;
const MAX_CANDIDATES = 12;
// Files that are source / test / config — never a program INPUT to smoke against.
const NOT_AN_INPUT = /\.(test|spec)\.[jt]sx?$|\.([jt]sx?|json|lock|md|ya?ml|html|css|map|d\.ts)$/i;

/** Detects a runnable CLI entry path (relative to cwd), or null. */
export function detectEntry(cwd: string): string | null {
  const run = join(cwd, 'run');
  if (existsSync(run)) {
    try {
      if ((statSync(run).mode & 0o111) !== 0) return './run'; // executable ./run convention
    } catch {
      /* ignore */
    }
  }
  const pkgPath = join(cwd, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {bin?: unknown; main?: unknown};
      if (typeof pkg.bin === 'string') return pkg.bin;
      if (pkg.bin && typeof pkg.bin === 'object') {
        const first = Object.values(pkg.bin as Record<string, unknown>).find((v) => typeof v === 'string');
        if (typeof first === 'string') return first;
      }
      if (typeof pkg.main === 'string') return pkg.main;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * True iff `<entry> <args>` exits 0 on the current code (no crash / timeout).
 * Deliberately exit-code-only: stderr is NOT a calibration signal because a
 * healthy CLI legitimately writes to it (a Node `--experimental-strip-types`
 * ExperimentalWarning, a deprecation notice), so requiring clean stderr would
 * silently refuse to vouch a common, working entry. The honest reach limit —
 * a graceful CLI that prints errors to stdout yet exits 0 — is the impl-blind
 * oracle's (stage_2.3) job, not the smoke's.
 */
function runsClean(cwd: string, entry: string, args: readonly string[]): boolean {
  try {
    const proc = execaSync(resolve(cwd, entry), [...args], {cwd, reject: false, timeout: CALIBRATE_TIMEOUT_MS});
    return (proc.exitCode ?? 1) === 0 && !proc.timedOut;
  } catch {
    return false;
  }
}

/** Shallow-walks the sample dirs for candidate INPUT files (not source/test/config, not the entry itself). */
function candidateInputs(cwd: string, entryAbs: string): string[] {
  const out: string[] = [];
  const roots = ['examples', 'samples', 'fixtures', 'tests', '.'].map((d) => join(cwd, d));
  for (const root of roots) {
    if (out.length >= MAX_CANDIDATES) break;
    if (!existsSync(root)) continue;
    const queue = [root];
    let depth = 0;
    while (queue.length > 0 && out.length < MAX_CANDIDATES && depth < 200) {
      depth++;
      const dir = queue.pop()!;
      let entries: readonly {name: string; isDirectory(): boolean}[];
      try {
        entries = readdirSync(dir, {withFileTypes: true});
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue;
        // resolve() (not join) so the entry-self exclusion below compares like for
        // like: a relative `dir` (e.g. cwd='.') made `abs` relative while `entryAbs`
        // is absolute, so `./run` was never excluded and got calibrated as its own
        // input (`smoke_args: ["run"]` — the A/B's vacuous smoke). resolve normalises both.
        const abs = resolve(dir, e.name);
        if (e.isDirectory()) queue.push(abs);
        else if (abs !== entryAbs && !NOT_AN_INPUT.test(e.name)) out.push(abs);
      }
    }
  }
  return out;
}

/**
 * Auto-detects a deliverable for `cwd` whose smoke invocation is PROVEN to pass on the current code.
 * Returns null when no entry is found OR no working invocation can be calibrated (the honest limit).
 */
export function detectDeliverable(cwd: string): Deliverable | null {
  const entry = detectEntry(cwd);
  if (!entry) return null;
  // (1) no-arg safe? (a CLI that runs clean with no args — e.g. `--version`-style not needed)
  if (runsClean(cwd, entry, [])) {
    return {path: entry, smoke_args: [], is_safe_to_smoke: true};
  }
  // (2) calibrate against a committed sample input that the entry consumes cleanly NOW.
  for (const cand of candidateInputs(cwd, resolve(cwd, entry))) {
    const rel = relative(cwd, cand);
    if (runsClean(cwd, entry, [rel])) {
      return {path: entry, smoke_args: [rel], is_safe_to_smoke: true};
    }
  }
  return null; // entry needs an input we couldn't prove — leave undeclared (INTEGRITY keeps warning).
}

/** True iff spec.yaml already declares a deliverable under project (indented `deliverable:`). */
export function hasDeliverable(body: string): boolean {
  return /^\s{2,}deliverable:\s*$/m.test(body);
}

/** Surgically inserts a `deliverable:` block as the first child of `project:` — preserves comments/order. */
export function upsertDeliverableBlock(body: string, d: Deliverable): string {
  if (hasDeliverable(body)) return body;
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const projIdx = lines.findIndex((l) => /^project:\s*$/.test(l));
  if (projIdx < 0) return body;
  const block = [
    '  # Auto-detected by `clad sync` — the gate smoke-tests this entry (stage_2.4, calibrated to pass now). Set is_safe_to_smoke: false to opt out.',
    '  deliverable:',
    `    path: ${JSON.stringify(d.path)}`,
    ...(d.smoke_args && d.smoke_args.length > 0
      ? [`    smoke_args: [${d.smoke_args.map((a) => JSON.stringify(a)).join(', ')}]`]
      : []),
    `    is_safe_to_smoke: ${d.is_safe_to_smoke ? 'true' : 'false'}`,
  ];
  lines.splice(projIdx + 1, 0, ...block);
  const lf = lines.join('\n');
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf;
}

/**
 * `clad sync` hook: if spec.yaml has no deliverable and a calibratable CLI entry exists, write it.
 * Returns the populated Deliverable (for reporting) or null. One-time per project (skips once present),
 * so the calibration's process-spawn side effect happens at most once.
 */
export function maintainDeliverable(cwd = '.'): Deliverable | null {
  const path = join(cwd, 'spec.yaml');
  if (!existsSync(path)) return null;
  const body = readFileSync(path, 'utf8');
  // Schema 0.2 project edits are closed typed operations. A future dedicated
  // deliverable operation can opt in; this legacy convenience must not become
  // a parallel root writer after migration.
  if (/^schema:\s*["']?0\.2["']?\s*$/m.test(body)) return null;
  if (hasDeliverable(body)) return null; // author/prior already declared — never override
  const d = detectDeliverable(cwd);
  if (!d) return null;
  const rebuilt = upsertDeliverableBlock(body, d);
  if (rebuilt !== body) {
    commitSchema01CompatibilityMutation(cwd, [{path: 'spec.yaml', before: body, after: rebuilt, rootRegions: ['project']}]);
    return d;
  }
  return null;
}
