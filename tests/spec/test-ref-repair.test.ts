// Cladding · F-c037ae — test_ref auto-repair + derived: suggestions

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {repairTestRefs} from '../../src/spec/test-ref-repair.js';

describe('repairTestRefs (F-c037ae)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-refrepair-'));
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'tests', 'cli'), {recursive: true});
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
});
