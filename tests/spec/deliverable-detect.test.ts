// Cladding · unit tests for spec/deliverable-detect.ts
//
// Auto-detection must NEVER enable a false-failing smoke: it sets is_safe_to_smoke:true ONLY after
// proving an invocation that exits 0 on the current code (no-arg-clean, or a calibrated committed
// sample). A file-consuming entry with no working sample → null (the honest reach limit).

import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  autoMaintainDeliverable,
  detectDeliverable,
  detectEntry,
  hasDeliverable,
  upsertDeliverableBlock,
} from '../../src/spec/deliverable-detect.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-deliv-detect-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Write an executable ./run with the given shell body. */
function writeRun(body: string): void {
  const p = join(dir, 'run');
  writeFileSync(p, `#!/bin/sh\n${body}\n`);
  chmodSync(p, 0o755);
}
function writeSpec(): void {
  writeFileSync(join(dir, 'spec.yaml'), '# Cladding · Tier A\nschema: "0.1"\nproject:\n  name: t\n  language: typescript\nfeatures: []\n');
}

describe('deliverable auto-detection', () => {
  test('detectEntry finds an executable ./run', () => {
    writeRun('exit 0');
    expect(detectEntry(dir)).toBe('./run');
  });

  test('detectEntry falls back to package.json bin', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({bin: {tool: 'cli.js'}}));
    expect(detectEntry(dir)).toBe('cli.js');
  });

  test('no-arg-clean entry → enabled with empty smoke_args', () => {
    writeRun('exit 0'); // exits 0 with no args
    const d = detectDeliverable(dir);
    expect(d).toEqual({path: './run', smoke_args: [], is_safe_to_smoke: true});
  });

  test('file-consuming entry + a working committed sample → calibrated smoke_args', () => {
    writeRun('[ -f "$1" ] && exit 0 || exit 1'); // exits 0 only with a file arg
    mkdirSync(join(dir, 'examples'), {recursive: true});
    writeFileSync(join(dir, 'examples', 'hello.prog'), 'x');
    const d = detectDeliverable(dir);
    expect(d?.is_safe_to_smoke).toBe(true);
    expect(d?.smoke_args).toEqual(['examples/hello.prog']);
  });

  test('file-consuming entry with NO usable sample → null (honest reach limit, no false-fail)', () => {
    writeRun('[ -f "$1" ] && exit 0 || exit 1'); // needs a file; none provided
    // only source/test/config files present — never tried as inputs
    writeFileSync(join(dir, 'index.test.js'), '//');
    expect(detectDeliverable(dir)).toBeNull();
  });

  test('upsertDeliverableBlock inserts under project and is idempotent', () => {
    writeSpec();
    const body = readFileSync(join(dir, 'spec.yaml'), 'utf8');
    const out = upsertDeliverableBlock(body, {path: './run', smoke_args: ['a.prog'], is_safe_to_smoke: true});
    expect(out).toMatch(/deliverable:/);
    expect(out).toMatch(/path: "\.\/run"/);
    expect(out.split('\n')[0]).toBe('# Cladding · Tier A'); // tier banner preserved
    expect(hasDeliverable(out)).toBe(true);
    expect(upsertDeliverableBlock(out, {path: './x', is_safe_to_smoke: true})).toBe(out); // no override
  });

  test('autoMaintainDeliverable writes a calibrated deliverable, then skips on re-run', () => {
    writeSpec();
    writeRun('exit 0');
    const d = autoMaintainDeliverable(dir);
    expect(d?.is_safe_to_smoke).toBe(true);
    expect(readFileSync(join(dir, 'spec.yaml'), 'utf8')).toMatch(/deliverable:/);
    expect(autoMaintainDeliverable(dir)).toBeNull(); // already present → no-op
  });
});
