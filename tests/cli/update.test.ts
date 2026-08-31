// Cladding · unit tests for cli/update.ts (`clad update` reconciliation core).
//
// runUpdate is the SAFE half of the post-upgrade routine: re-wire (injected),
// reconcile the spec inventory, refresh the managed CLAUDE.md/AGENTS.md section.
// The drift REPORT lives in the command wrapper (report-only), so it is not
// exercised here — these tests pin the safe, idempotent mutations + exit code.

import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runUpdate} from '../../src/cli/update.js';

const SPEC = 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n';
const okWire = async () => 0;

describe('runUpdate', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-update-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('no spec.yaml → nothing runs: no wiring call, isProject false, no writes', async () => {
    let wireCalled = false;
    const r = await runUpdate(dir, {wireHosts: async () => { wireCalled = true; return 0; }});
    expect(wireCalled).toBe(false); // wiring (and its legacy cleanup) must not fire outside a project
    expect(r.isProject).toBe(false);
    expect(r.wiringErrors).toBe(0);
    expect(r.claudeMd).toBe('n/a');
    expect(r.agentsMd).toBe('n/a');
    expect(r.code).toBe(0);
  });

  test('host wiring failure → exit code 1 (the one thing that blocks)', async () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    const r = await runUpdate(dir, {wireHosts: async () => 2});
    expect(r.wiringErrors).toBe(2);
    expect(r.code).toBe(1);
  });

  test('[covers:F-0f4dd6/AC-019] fresh project → inventory and both established host instruction surfaces are written', async () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    const r = await runUpdate(dir, {wireHosts: okWire});
    expect(r.isProject).toBe(true);
    expect(r.features).toBe(0);
    expect(r.claudeMd).toBe('created');
    expect(r.agentsMd).toBe('created');
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(r.code).toBe(0);
    // inventory block was materialized into spec.yaml
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
  });

  test('idempotent — a second run leaves the managed files unchanged', async () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    await runUpdate(dir, {wireHosts: okWire});
    const r2 = await runUpdate(dir, {wireHosts: okWire});
    expect(r2.claudeMd).toBe('unchanged');
    expect(r2.agentsMd).toBe('skipped-exists'); // existing, non-stale
    expect(r2.code).toBe(0);
  });
});

// ─── F-b43066 — token_budget_per_session deprecation drains via the report ───

describe('deprecation report (F-b43066)', () => {
  test('flags ai_hints.token_budget_per_session as deprecated, report-only (code stays 0)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-update-dep-'));
    try {
      writeFileSync(
        join(dir, 'spec.yaml'),
        'schema: "0.1"\nproject:\n  name: x\n  language: typescript\n  ai_hints:\n    token_budget_per_session: 4000\nfeatures: []\n',
      );
      mkdirSync(join(dir, '.github', 'workflows'), {recursive: true}); // isolate from the CI-absence notice (F-16746b)
      const r = await runUpdate(dir, {wireHosts: async () => 0});
      expect(r.deprecations.length).toBe(1);
      expect(r.deprecations[0]).toContain('token_budget_per_session');
      expect(r.code).toBe(0); // report-only — never blocks
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('clean spec produces no deprecation lines', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-update-clean-'));
    try {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n');
      mkdirSync(join(dir, '.github', 'workflows'), {recursive: true});
      const r = await runUpdate(dir, {wireHosts: async () => 0});
      expect(r.deprecations).toEqual([]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ─── F-10cc42d1 · AC-28d60113 — clad update defers derived-file writes mid-op ───
//
// `clad update` is one of the three derived-file writers (with `clad sync` and
// the MCP syncInventory path). While a git merge/rebase/cherry-pick is in
// progress, the inventory + feature-index writes must be skipped so a
// half-merged tree sees no surprise edits — while the read-only report (feature
// count, project detection) keeps working with a success exit. The guard reads
// the REAL probe over `cwd`, so these tests drive it with a real git repo + a
// hand-seeded MERGE_HEAD (no actual merge needed).

describe('git-operation write guard (F-10cc42d1 · AC-28d60113 · update writer)', () => {
  let dir: string;

  // A minimal cladding-style fixture: a valid spec.yaml plus one on-disk shard
  // (writeFeatureIndex only emits spec/index.yaml when spec/features/ exists).
  const SHARD =
    'id: F-abc123\n' +
    'slug: thing\n' +
    'title: A thing\n' +
    'status: planned\n' +
    'modules: []\n' +
    'acceptance_criteria:\n' +
    '  - id: AC-001\n' +
    '    ears: ubiquitous\n' +
    '    text: The system shall do a thing.\n';

  function fixture(): void {
    execFileSync('git', ['init', '-q'], {cwd: dir});
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(join(dir, 'spec', 'features', 'thing-abc123.yaml'), SHARD);
    mkdirSync(join(dir, '.github', 'workflows'), {recursive: true}); // isolate from the CI-absence notice
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-update-gitop-'));
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('a git op in progress defers the inventory + index writes; read-only report stays intact + success exit', async () => {
    fixture();
    const specBefore = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    // Seed the merge marker under the resolved git dir (`<dir>/.git` for a normal repo).
    writeFileSync(join(dir, '.git', 'MERGE_HEAD'), 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n');

    const r = await runUpdate(dir, {wireHosts: okWire});

    // Read-only reporting intact + success exit (never blocks on a git op).
    expect(r.isProject).toBe(true);
    expect(typeof r.features).toBe('number');
    expect(r.inventoryDeferred).toBe(true);
    expect(r.code).toBe(0);

    // Derived files are byte-for-byte untouched: no inventory block folded into
    // spec.yaml, and no spec/index.yaml materialized.
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toBe(specBefore);
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).not.toContain('inventory:');
    expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(false);
  });

  test('with no git op the same run writes both derived files (the guard is not vacuous)', async () => {
    fixture();
    // No MERGE_HEAD seeded → settled tree.
    const r = await runUpdate(dir, {wireHosts: okWire});

    expect(r.inventoryDeferred).toBe(false);
    expect(r.code).toBe(0);
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
    expect(existsSync(join(dir, 'spec', 'index.yaml'))).toBe(true);
  });
});

// ─── F-16746b — CI-absence notice ───

describe('CI-absence notice (F-16746b)', () => {
  test('reports the missing authoritative gate with the --with-ci remediation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-update-ci-'));
    try {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\nfeatures: []\n');
      const r = await runUpdate(dir, {wireHosts: async () => 0});
      expect(r.deprecations.some((d) => d.includes('clad init --with-ci'))).toBe(true);
      expect(r.code).toBe(0); // report-only
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
