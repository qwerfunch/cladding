#!/usr/bin/env node
// Cladding · version bump script (v0.3.15, F-090).
//
// Atomically bumps the version string across the nine files where
// it lives so two contributors don't have to manually hand-edit each
// location and risk drifting them. HARNESS_INTEGRITY already catches
// post-hoc drift, but doing the bump in one shot avoids the catch
// altogether.
//
// Usage:
//   node scripts/version-bump.mjs 0.3.16
//   npm run version-bump -- 0.3.16
//
// The script:
//   1. validates the target version against SemVer (major.minor.patch)
//   2. reads the current version from package.json
//   3. updates all nine sites with a literal string replace
//   4. prints a summary of what changed
//
// It does NOT touch CHANGELOG.md, git, or run the build. Those are
// separate steps so the script stays single-purpose and easy to audit.

import {readFileSync, writeFileSync} from 'node:fs';
import process from 'node:process';

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * Each entry describes one place where the version string lives.
 * `find` is a context-anchored substring that contains the version;
 * `formatNew(v)` builds the replacement using the new version.
 *
 * The `find` strings are deliberately long enough to be unique in
 * each file — single-line `'version'` would match the wrong field
 * (e.g. in package-lock.json or a dependency entry).
 */
function siteFor(file, anchor, formatNew) {
  return {file, anchor, formatNew};
}

const SITES = [
  // 1. package.json
  siteFor(
    'package.json',
    /"version": "(\d+\.\d+\.\d+)"/,
    (v) => `"version": "${v}"`,
  ),
  // 2. plugins/claude-code/.claude-plugin/plugin.json
  //    (root .claude-plugin/ holds marketplace.json; the Claude plugin
  //    manifest lives under plugins/claude-code/, mirroring codex at SITE 3.
  //    The old root path was stale and made `version-bump` error on the repo.)
  siteFor(
    'plugins/claude-code/.claude-plugin/plugin.json',
    /"version": "(\d+\.\d+\.\d+)"/,
    (v) => `"version": "${v}"`,
  ),
  // 3. plugins/codex/.codex-plugin/plugin.json
  siteFor(
    'plugins/codex/.codex-plugin/plugin.json',
    /"version": "(\d+\.\d+\.\d+)"/,
    (v) => `"version": "${v}"`,
  ),
  // 4. plugins/gemini-cli/gemini-extension.json
  siteFor(
    'plugins/gemini-cli/gemini-extension.json',
    /"version": "(\d+\.\d+\.\d+)"/,
    (v) => `"version": "${v}"`,
  ),
  // 5. src/cli/clad.ts — `.version('X.Y.Z')` chain on commander Program
  siteFor(
    'src/cli/clad.ts',
    /\.version\('(\d+\.\d+\.\d+)'\)/,
    (v) => `.version('${v}')`,
  ),
  // 6. src/serve/server.ts — fallback `version: opts.version ?? 'X.Y.Z'`
  siteFor(
    'src/serve/server.ts',
    /version: opts\.version \?\? '(\d+\.\d+\.\d+)'/,
    (v) => `version: opts.version ?? '${v}'`,
  ),
  // 7. tests/cli/clad.test.ts — `expect(program.version()).toBe('X.Y.Z')`
  siteFor(
    'tests/cli/clad.test.ts',
    /expect\(program\.version\(\)\)\.toBe\('(\d+\.\d+\.\d+)'\)/,
    (v) => `expect(program.version()).toBe('${v}')`,
  ),
  // 8. spec.yaml — project.version (Tier A SSoT must track the binary)
  siteFor(
    'spec.yaml',
    /  version: "(\d+\.\d+\.\d+)"/,
    (v) => `  version: "${v}"`,
  ),
  // 9. .claude-plugin/marketplace.json — the marketplace CATALOG entry the
  //    Claude Code host reads to detect "update available". Nested under
  //    plugins[0].version; it is the only "version" key in the file, so the
  //    shared anchor is unambiguous. It is NOT a HOST manifest, so
  //    HARNESS_INTEGRITY checks it via a dedicated marketplace branch — keeping
  //    it here means the catalog can never silently lag the release again.
  siteFor(
    '.claude-plugin/marketplace.json',
    /"version": "(\d+\.\d+\.\d+)"/,
    (v) => `"version": "${v}"`,
  ),
];

function fail(msg) {
  process.stderr.write(`cladding version-bump: ${msg}\n`);
  process.exit(1);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.length !== 1) {
    fail('usage: node scripts/version-bump.mjs <new-version> (e.g. 0.3.16)');
  }
  const newVersion = argv[0];
  if (!SEMVER_RE.test(newVersion)) {
    fail(`'${newVersion}' is not a valid SemVer major.minor.patch`);
  }

  const changes = [];
  const errors = [];
  for (const site of SITES) {
    let body;
    try {
      body = readFileSync(site.file, 'utf8');
    } catch (err) {
      errors.push(`${site.file}: cannot read (${err.message})`);
      continue;
    }
    const match = site.anchor.exec(body);
    if (!match) {
      errors.push(`${site.file}: anchor pattern not found — has the file layout changed?`);
      continue;
    }
    const oldVersion = match[1];
    if (oldVersion === newVersion) {
      changes.push(`${site.file}: ${oldVersion} (already)`);
      continue;
    }
    const replacement = site.formatNew(newVersion);
    const next = body.replace(site.anchor, replacement);
    if (next === body) {
      errors.push(`${site.file}: replacement matched anchor but produced no diff — bug in formatNew`);
      continue;
    }
    writeFileSync(site.file, next, 'utf8');
    changes.push(`${site.file}: ${oldVersion} → ${newVersion}`);
  }

  for (const c of changes) process.stdout.write(`  ${c}\n`);
  if (errors.length > 0) {
    process.stderr.write('\nerrors:\n');
    for (const e of errors) process.stderr.write(`  ${e}\n`);
    process.exit(1);
  }
  process.stdout.write(`\ncladding version-bump: ${changes.length} files updated to ${newVersion}\n`);
}

main();
