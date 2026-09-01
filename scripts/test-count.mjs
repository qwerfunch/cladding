#!/usr/bin/env node
// Cladding · public test-count consistency guard (F-898783ee).
//
// Public test totals are derived from Vitest collection rather than a manually
// remembered number. `--check` is release-safe and read-only; `--write` updates
// every published README variant only after all six claim sites validate.

import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** Registered public README surfaces carrying the collected test claim. */
export const CLAIM_SITES = [
  {file: 'README.md', kind: 'markdown'},
  {file: 'README.ko.md', kind: 'markdown'},
  {file: 'README.ja.md', kind: 'markdown'},
  {file: 'README.zh.md', kind: 'markdown'},
  {file: 'README.html', kind: 'html'},
  {file: 'README.ko.html', kind: 'html'},
];

const BADGE_RE = /tests-(\d+)%2F(\d+)-brightgreen/g;
const MARKDOWN_STATUS_RE = /\|\s*(\d+)\s*\/\s*(\d+)(?=\s*(?:\||·))/g;
const HTML_STATUS_RE = />(\d+)<span style="font-size:16px;color:#94a3b8">\/(\d+)<\/span>/g;
const TEST_FILE_CLAIM_RE = /(\d+)\s*(?:test files|个测试文件)/g;
const INVENTORY_TEST_FILES_RE = /^(\s*test_files:\s*)(\d+)(\s*(?:#.*)?)$/m;

/**
 * Returns the two public pass/total pairs from one README variant.
 *
 * @param {string} body README source text.
 * @param {'markdown'|'html'} kind README representation.
 * @returns {Array<[number, number]>} Public pass and total pairs.
 */
export function claimPairs(body, kind) {
  const badge = [...body.matchAll(BADGE_RE)].map((match) => [Number(match[1]), Number(match[2])]);
  const statusPattern = kind === 'html' ? HTML_STATUS_RE : MARKDOWN_STATUS_RE;
  const status = [...body.matchAll(statusPattern)].map((match) => [Number(match[1]), Number(match[2])]);
  return [...badge, ...status];
}

/**
 * Validates one README claim surface against the collected test count.
 *
 * @param {string} body README source text.
 * @param {'markdown'|'html'} kind README representation.
 * @param {number} expected Collected Vitest total.
 * @param {string} file Diagnostic file label.
 * @returns {void}
 * @throws {Error} When the public claim is missing, partial, or stale.
 */
export function checkClaimText(body, kind, expected, file = '<memory>') {
  const pairs = claimPairs(body, kind);
  if (pairs.length !== 2) {
    throw new Error(`${file}: expected one test badge and one status total; found ${pairs.length} claims`);
  }
  for (const [passed, total] of pairs) {
    if (passed !== total) throw new Error(`${file}: public test claim is not all-pass (${passed}/${total})`);
    if (total !== expected) throw new Error(`${file}: claims ${total} tests; Vitest collects ${expected}`);
  }
}

/**
 * Rewrites one already-valid README claim surface to a new collected total.
 *
 * @param {string} body README source text.
 * @param {'markdown'|'html'} kind README representation.
 * @param {number} expected Collected Vitest total.
 * @param {string} file Diagnostic file label.
 * @returns {string} README text with both claims updated.
 * @throws {Error} When the existing public claim is malformed or partial.
 */
export function rewriteClaimText(body, kind, expected, file = '<memory>') {
  const pairs = claimPairs(body, kind);
  if (pairs.length !== 2 || pairs.some(([passed, total]) => passed !== total)) {
    throw new Error(`${file}: refusing to rewrite malformed or partial test-count claims`);
  }
  const statusPattern = kind === 'html' ? HTML_STATUS_RE : MARKDOWN_STATUS_RE;
  const badgeUpdated = body.replace(BADGE_RE, `tests-${expected}%2F${expected}-brightgreen`);
  return badgeUpdated.replace(statusPattern, (match) => {
    if (kind === 'html') {
      return `>${expected}<span style="font-size:16px;color:#94a3b8">/${expected}</span>`;
    }
    return match.replace(/\d+\s*\/\s*\d+/, `${expected} / ${expected}`);
  });
}

/**
 * Returns the one public test-file inventory claim from one README variant.
 *
 * @param {string} body README source text.
 * @param {string} file Diagnostic file label.
 * @returns {number} Source-declared test-file count.
 * @throws {Error} When the source lacks one unambiguous claim.
 */
export function testFileClaim(body, file = '<memory>') {
  const claims = [...body.matchAll(TEST_FILE_CLAIM_RE)].map((match) => Number(match[1]));
  if (claims.length !== 1) {
    throw new Error(`${file}: expected one test-file inventory claim; found ${claims.length}`);
  }
  return claims[0];
}

/**
 * Validates one README's test-file claim against the collected Vitest files.
 *
 * @param {string} body README source text.
 * @param {number} expected Collected Vitest file count.
 * @param {string} file Diagnostic file label.
 * @returns {void}
 * @throws {Error} When the public claim is stale or malformed.
 */
export function checkTestFileClaim(body, expected, file = '<memory>') {
  const actual = testFileClaim(body, file);
  if (actual !== expected) throw new Error(`${file}: claims ${actual} test files; Vitest collects ${expected}`);
}

/**
 * Rewrites one already-valid test-file inventory claim.
 *
 * @param {string} body README source text.
 * @param {number} expected Collected Vitest file count.
 * @param {string} file Diagnostic file label.
 * @returns {string} README text with its test-file claim updated.
 * @throws {Error} When the source lacks one unambiguous claim.
 */
export function rewriteTestFileClaim(body, expected, file = '<memory>') {
  testFileClaim(body, file);
  return body.replace(TEST_FILE_CLAIM_RE, (match) => match.replace(/\d+/, String(expected)));
}

/**
 * Returns the root inventory's persisted test-file count without manufacturing
 * a second inventory rule outside the generated root field.
 *
 * @param {string} body Root spec.yaml source text.
 * @returns {number} Persisted inventory.test_files value.
 * @throws {Error} When the root inventory field is absent or ambiguous.
 */
export function inventoryTestFileCount(body) {
  const matches = [...body.matchAll(new RegExp(INVENTORY_TEST_FILES_RE.source, 'gm'))];
  if (matches.length !== 1) {
    throw new Error(`spec.yaml: expected one inventory.test_files field; found ${matches.length}`);
  }
  return Number(matches[0][2]);
}

/**
 * Rewrites the root inventory after its one test-file field has been verified.
 *
 * @param {string} body Root spec.yaml source text.
 * @param {number} expected Collected Vitest file count.
 * @returns {string} Root source with inventory.test_files updated.
 * @throws {Error} When the root inventory field is absent or ambiguous.
 */
export function rewriteInventoryTestFileCount(body, expected) {
  inventoryTestFileCount(body);
  return body.replace(INVENTORY_TEST_FILES_RE, `$1${expected}$3`);
}

/**
 * Collects the exact Vitest test and distinct test-file counts together.
 *
 * @returns {{tests: number, testFiles: number}} Collected test and file totals.
 * @throws {Error} When collection fails or returns an empty suite.
 */
export function collectTestInventory() {
  const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs');
  const result = spawnSync(process.execPath, [vitest, 'list', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`Vitest collection failed: ${(result.stderr || result.stdout).trim()}`);
  }
  const collected = JSON.parse(result.stdout);
  if (!Array.isArray(collected) || collected.length === 0) {
    throw new Error('Vitest collection returned no tests');
  }
  const files = new Set(collected.map((entry) => entry?.file).filter((file) => typeof file === 'string' && file.length > 0));
  if (files.size === 0) throw new Error('Vitest collection returned no test files');
  return {tests: collected.length, testFiles: files.size};
}

/**
 * Collects the exact number of tests Vitest would execute without running them.
 *
 * @returns {number} Number of collected Vitest tests.
 * @throws {Error} When collection fails or returns an empty suite.
 */
export function collectTestCount() {
  return collectTestInventory().tests;
}

/**
 * Runs the public-count command against one repository root.
 *
 * Every surface is read and rewritten before the first write, preserving the
 * command's all-surface preflight invariant without claiming mid-write rollback.
 *
 * @param {'--check'|'--write'} mode Read-only check or explicit rewrite mode.
 * @param {{root?: string, collected?: number, testFiles?: number}} options Test-only root/count seams.
 * @returns {number} The collected test total checked or written.
 * @throws {Error} When a claim is stale, malformed, or partial.
 * @see spec/features/self-count-guard-898783ee.yaml AC-8ded2bb9
 */
export function runTestCount(mode, options = {}) {
  if (!['--check', '--write'].includes(mode)) {
    throw new Error('usage: node scripts/test-count.mjs [--check|--write]');
  }
  const root = options.root ?? ROOT;
  const collected = options.collected === undefined || options.testFiles === undefined
    ? collectTestInventory()
    : undefined;
  const expected = options.collected ?? collected?.tests;
  const expectedTestFiles = options.testFiles ?? collected?.testFiles;
  if (expected === undefined || expectedTestFiles === undefined) throw new Error('Vitest collection did not return a complete inventory');
  const bodies = new Map(
    CLAIM_SITES.map((site) => [site.file, readFileSync(join(root, site.file), 'utf8')]),
  );
  const specBody = readFileSync(join(root, 'spec.yaml'), 'utf8');
  if (mode === '--check') {
    for (const site of CLAIM_SITES) {
      checkClaimText(bodies.get(site.file), site.kind, expected, site.file);
      checkTestFileClaim(bodies.get(site.file), expectedTestFiles, site.file);
    }
    const inventory = inventoryTestFileCount(specBody);
    if (inventory !== expectedTestFiles) throw new Error(`spec.yaml: inventory.test_files is ${inventory}; Vitest collects ${expectedTestFiles}`);
    return expected;
  }

  // Finish every parse/rewrite before mutating any README surface.
  const rewritten = new Map(
    CLAIM_SITES.map((site) => [
      site.file,
      rewriteTestFileClaim(rewriteClaimText(bodies.get(site.file), site.kind, expected, site.file), expectedTestFiles, site.file),
    ]),
  );
  const rewrittenSpec = rewriteInventoryTestFileCount(specBody, expectedTestFiles);
  for (const site of CLAIM_SITES) {
    writeFileSync(join(root, site.file), rewritten.get(site.file), 'utf8');
  }
  writeFileSync(join(root, 'spec.yaml'), rewrittenSpec, 'utf8');
  return expected;
}

function main() {
  const mode = process.argv[2] ?? '--check';
  if (process.argv.length > 3) {
    throw new Error('usage: node scripts/test-count.mjs [--check|--write]');
  }
  const expected = runTestCount(mode);
  process.stdout.write(`cladding test-count: ${expected} tests · ${mode.slice(2)} passed\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`cladding test-count: ${(error).message}\n`);
    process.exit(1);
  }
}
