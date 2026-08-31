// Cladding · F-c037ae — test_ref auto-repair + derived: suggestions

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {repairTestRefs} from '../../src/spec/test-ref-repair.js';
import {commitSchema01CompatibilityMutation} from '../../src/spec/edit.js';

describe('repairTestRefs (F-c037ae)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-refrepair-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'tests', 'cli'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  const shard = (refsLine: string): string =>
    `id: F-aaaa11\nslug: login-flow\ntitle: t\nstatus: done\nmodules:\n  - src/login.ts\nacceptance_criteria:\n  - id: AC-001\n    ears: ubiquitous\n    text: t\n${refsLine}`;

  test('REPAIR: a moved ref with a unique basename match is rewritten in place, anchor preserved', () => {
    writeFileSync(join(dir, 'tests', 'cli', 'login.test.ts'), 'export {};\n');
    writeFileSync(
      join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'),
      shard('    test_refs:\n      - "tests/old/login.test.ts#logs in"\n'),
    );

    const out = repairTestRefs(dir);

    expect(out.repaired).toEqual([
      {shard: 'login-flow-aaaa11.yaml', from: 'tests/old/login.test.ts#logs in', to: 'tests/cli/login.test.ts#logs in'},
    ]);
    const body = readFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), 'utf8');
    expect(body).toContain('tests/cli/login.test.ts#logs in');
    expect(body).not.toContain('tests/old/');
  });

  test('REPAIR never guesses: two same-basename candidates leave the shard byte-identical', () => {
    mkdirSync(join(dir, 'tests', 'unit'), {recursive: true});
    writeFileSync(join(dir, 'tests', 'cli', 'login.test.ts'), 'export {};\n');
    writeFileSync(join(dir, 'tests', 'unit', 'login.test.ts'), 'export {};\n');
    const original = shard('    test_refs:\n      - "tests/old/login.test.ts"\n');
    writeFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), original);

    const out = repairTestRefs(dir);

    expect(out.repaired).toEqual([]);
    expect(readFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), 'utf8')).toBe(original);
  });

  test('SUGGEST: a done AC with no refs gains a derived: candidate matched by slug', () => {
    writeFileSync(join(dir, 'tests', 'cli', 'login-flow.test.ts'), 'export {};\n');
    writeFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), shard(''));

    const out = repairTestRefs(dir);

    expect(out.suggested).toEqual([
      {shard: 'login-flow-aaaa11.yaml', ref: 'derived:tests/cli/login-flow.test.ts'},
    ]);
    const body = readFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), 'utf8');
    expect(body).toContain('- "derived:tests/cli/login-flow.test.ts"');
  });

  test('resolved refs and non-done features are left byte-identical', () => {
    writeFileSync(join(dir, 'tests', 'cli', 'login.test.ts'), 'export {};\n');
    const resolved = shard('    test_refs:\n      - "tests/cli/login.test.ts"\n');
    writeFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), resolved);
    const planned = resolved.replace('status: done', 'status: planned').replace('F-aaaa11', 'F-bbbb22').replace('login-flow', 'other-flow');
    writeFileSync(join(dir, 'spec', 'features', 'other-flow-bbbb22.yaml'), planned);

    const out = repairTestRefs(dir);

    expect(out.repaired).toEqual([]);
    expect(out.suggested).toEqual([]);
    expect(readFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), 'utf8')).toBe(resolved);
    expect(readFileSync(join(dir, 'spec', 'features', 'other-flow-bbbb22.yaml'), 'utf8')).toBe(planned);
  });

  test('rejects a cooperative same-shard edit that lands after prepare and before commit', () => {
    writeFileSync(join(dir, 'tests', 'cli', 'login.test.ts'), 'export {};\n');
    const path = join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml');
    const original = shard('    test_refs:\n      - "tests/old/login.test.ts"\n');
    const successor = `${original}owner_note: successor wins\n`;
    writeFileSync(path, original);

    expect(() => repairTestRefs(dir, {
      testBeforeCommit: () => commitSchema01CompatibilityMutation(dir, [{
        path: 'spec/features/login-flow-aaaa11.yaml', before: original, after: successor,
      }]),
    })).toThrow(expect.objectContaining({code: 'STALE_INPUT'}));
    expect(readFileSync(path, 'utf8')).toBe(successor);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.json'))).toBe(false);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.lock'))).toBe(false);
  });
});

// ─── 0.6.0 real-user battery regression (C4.2/C4.3) — the relative-cwd corruption ───

describe('relative-cwd invocation (battery C4 regression)', () => {
  test("repair under cwd='.' (the REAL clad sync path) writes the full path — no leading chars eaten, no self-repair loop", () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-refrepair-dot-'));
    const prev = process.cwd();
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      mkdirSync(join(dir, 'tests', 'cli'), {recursive: true});
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
      writeFileSync(join(dir, 'tests', 'cli', 'login.test.ts'), 'export {};\n');
      writeFileSync(
        join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'),
        'id: F-aaaa11\nslug: login-flow\ntitle: t\nstatus: done\nmodules:\n  - src/login.ts\nacceptance_criteria:\n  - id: AC-001\n    ears: ubiquitous\n    text: t\n    test_refs:\n      - "tests/old/login.test.ts#logs in"\n',
      );
      process.chdir(dir);

      const first = repairTestRefs('.');
      expect(first.repaired).toEqual([
        {shard: 'login-flow-aaaa11.yaml', from: 'tests/old/login.test.ts#logs in', to: 'tests/cli/login.test.ts#logs in'},
      ]);
      const body = readFileSync(join(dir, 'spec', 'features', 'login-flow-aaaa11.yaml'), 'utf8');
      expect(body).toContain('"tests/cli/login.test.ts#logs in"'); // NOT "sts/cli/..."
      expect(body).not.toContain('"sts/cli'); // the corrupt form started at the quote ('te' eaten)

      // convergence: a second sync repairs nothing (no X → X loop)
      const second = repairTestRefs('.');
      expect(second.repaired).toEqual([]);
    } finally {
      process.chdir(prev);
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test("derived suggestion under cwd='.' carries the full tests/ path", () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-derived-dot-'));
    const prev = process.cwd();
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      mkdirSync(join(dir, 'tests', 'cli'), {recursive: true});
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\n');
      writeFileSync(join(dir, 'tests', 'cli', 'pay-flow.test.ts'), 'export {};\n');
      writeFileSync(
        join(dir, 'spec', 'features', 'pay-flow-bbbb22.yaml'),
        'id: F-bbbb22\nslug: pay-flow\ntitle: t\nstatus: done\nmodules:\n  - src/pay.ts\nacceptance_criteria:\n  - id: AC-001\n    ears: ubiquitous\n    text: t\n',
      );
      process.chdir(dir);

      const out = repairTestRefs('.');
      expect(out.suggested).toEqual([{shard: 'pay-flow-bbbb22.yaml', ref: 'derived:tests/cli/pay-flow.test.ts'}]);
      expect(readFileSync(join(dir, 'spec', 'features', 'pay-flow-bbbb22.yaml'), 'utf8')).toContain(
        '"derived:tests/cli/pay-flow.test.ts"',
      );
    } finally {
      process.chdir(prev);
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
