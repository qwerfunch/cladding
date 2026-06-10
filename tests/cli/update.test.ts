// Cladding · unit tests for cli/update.ts (`clad update` reconciliation core).
//
// runUpdate is the SAFE half of the post-upgrade routine: re-wire (injected),
// reconcile the spec inventory, refresh the managed CLAUDE.md/AGENTS.md section.
// The drift REPORT lives in the command wrapper (report-only), so it is not
// exercised here — these tests pin the safe, idempotent mutations + exit code.

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
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

  test('no spec.yaml → re-wires only, isProject false, no project files written', async () => {
    const r = await runUpdate(dir, {wireHosts: okWire});
    expect(r.isProject).toBe(false);
    expect(r.claudeMd).toBe('n/a');
    expect(r.agentsMd).toBe('n/a');
    expect(r.code).toBe(0);
  });

  test('host wiring failure → exit code 1 (the one thing that blocks)', async () => {
    const r = await runUpdate(dir, {wireHosts: async () => 2});
    expect(r.wiringErrors).toBe(2);
    expect(r.code).toBe(1);
  });

  test('fresh project → inventory written, CLAUDE.md + AGENTS.md created, code 0', async () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    const r = await runUpdate(dir, {wireHosts: okWire});
    expect(r.isProject).toBe(true);
    expect(r.features).toBe(0);
    expect(r.claudeMd).toBe('created');
    expect(r.agentsMd).toBe('created');
    expect(r.code).toBe(0);
    // inventory block was materialized into spec.yaml
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toContain('inventory:');
  });

  test('idempotent — a second run leaves the managed files unchanged', async () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    await runUpdate(dir, {wireHosts: okWire});
    const r2 = await runUpdate(dir, {wireHosts: okWire});
    expect(r2.claudeMd).toBe('unchanged'); // section already present + fresh
    expect(r2.agentsMd).toBe('skipped-exists'); // existing, non-stale
    expect(r2.code).toBe(0);
  });
});
