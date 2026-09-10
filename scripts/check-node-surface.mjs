#!/usr/bin/env node
// Cladding · platform-surface floor check (F-203a3114).
//
// The original defect shipped because nothing measured what the published
// bundle actually needs from the runtime. A dependency reached for
// `util.aborted`, `stream.getDefaultHighWaterMark` and `events.addAbortListener`
// — all newer than the releases users were on — and because the bundle is one
// file, that dependency's floor silently became the whole tool's floor.
//
// This check closes that loop without a table of versions to maintain: read
// every platform-module import out of the built bundle, then resolve each one
// against the release that is running. Run it ON the declared floor release
// (CI does) and a dependency upgrade that reaches above the floor fails loudly
// instead of reaching a user's terminal.
//
// Deterministic, synchronous apart from the resolution probes, and no model
// involved — the same bar the drift detectors hold.
//
// Known reach limit: this reads STATIC ESM imports. A bundled CommonJS
// dependency reaching for a newer surface through `require('util')` passes
// through the bundle's createRequire banner and matches nothing here, and a
// newer GLOBAL (`fetch`, `structuredClone`) is invisible to it too — the one
// global the code depends on is guarded at its own call site instead. That gap is
// covered by running real commands on the floor release in CI, not by this
// script, and it is why the floor cell does more than print a version.
//
// Usage:
//   node scripts/check-node-surface.mjs [bundle]    # default: dist/clad.js
//
// Exits non-zero when a required surface is missing on the running release.

import {readFileSync} from 'node:fs';
import process from 'node:process';

const bundlePath = process.argv[2] ?? 'dist/clad.js';

/** Matches a named import from a `node:`-prefixed builtin, minified or not. */
const NAMED = /import\s*\{([^}]*)\}\s*from\s*["'](node:[^"']+)["']/g;
/** Matches a namespace or default import, plus the bare side-effect form. */
const WHOLE = /import\s+(?:\*\s*as\s+[\w$]+|[\w$]+)\s*from\s*["'](node:[^"']+)["']|import\s*["'](node:[^"']+)["']/g;

/**
 * Reads every platform-module surface the bundle imports.
 *
 * @param {string} source - Bundle contents.
 * @returns {Map<string, Set<string>>} Module specifier to required export names; `*` means the module itself.
 */
function requiredSurfaces(source) {
  /** @type {Map<string, Set<string>>} */
  const needs = new Map();
  const add = (mod, name) => {
    const set = needs.get(mod) ?? new Set();
    set.add(name);
    needs.set(mod, set);
  };
  for (const m of source.matchAll(NAMED)) {
    for (const part of m[1].split(',')) {
      // `aborted as aborted2` / `readFileSync as rf` → the imported name is first.
      const name = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (name) add(m[2], name);
    }
  }
  for (const m of source.matchAll(WHOLE)) add(m[1] ?? m[2], '*');
  return needs;
}

/**
 * Resolves each required surface against the running release.
 *
 * @param {Map<string, Set<string>>} needs - Required surfaces.
 * @returns {Promise<string[]>} Human-readable descriptions of what is missing.
 */
async function missingOnThisRelease(needs) {
  const missing = [];
  for (const [mod, names] of [...needs].sort()) {
    let loaded;
    try {
      loaded = await import(mod);
    } catch {
      missing.push(`${mod} — the module itself does not exist on this release`);
      continue;
    }
    for (const name of [...names].sort()) {
      if (name === '*') continue;
      if (!(name in loaded)) missing.push(`${mod} — no export named '${name}'`);
    }
  }
  return missing;
}

let source;
try {
  source = readFileSync(bundlePath, 'utf8');
} catch (error) {
  process.stderr.write(
    `cladding node-surface: cannot read the bundle at ${bundlePath} — run the build first `
    + `(${error instanceof Error ? error.message : String(error)}).\n`,
  );
  process.exit(1);
}

const needs = requiredSurfaces(source);
const surfaceCount = [...needs.values()].reduce((sum, set) => sum + set.size, 0);
const missing = await missingOnThisRelease(needs);

if (missing.length === 0) {
  process.stdout.write(
    `cladding node-surface: ${surfaceCount} platform surfaces across ${needs.size} modules — `
    + `all present on Node ${process.versions.node}\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `cladding node-surface: the bundle needs ${missing.length} platform surface(s) that Node `
  + `${process.versions.node} does not provide.\n`,
);
for (const line of missing) process.stderr.write(`  - ${line}\n`);
process.stderr.write(
  '\nThis release is at or above the declared floor, so the bundle must run on it. '
  + 'A dependency upgrade most likely pulled in a newer platform surface: either pin that '
  + 'dependency back, replace its use, or raise the declared floor deliberately in '
  + 'package.json engines and bin/clad.mjs together.\n',
);
process.exit(1);
