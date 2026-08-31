// Cladding · F-be5306eb AC-babf927c — SessionStart surfaces the cold-start signal.
//
// The always-on net: when a session starts in a project that has source code but
// zero feature specs, the SessionStart card says the feature cycle hasn't started —
// regardless of how that state was reached.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

vi.mock('../../src/stages/drift.js', () => ({runDrift: () => ({pass: true, exitCode: 0, findings: []})}));
vi.mock('../../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));

const {runHookEvent} = await import('../../src/cli/hook.js');

let cwd: string;
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'clad-cold-'));
});
afterEach(() => {
  rmSync(cwd, {recursive: true, force: true});
  vi.clearAllMocks();
});

function writeSpec(features: string): void {
  writeFileSync(join(cwd, 'spec.yaml'), `schema: "0.1"\nproject: {name: t, language: typescript}\nfeatures: ${features}\n`, 'utf8');
}
function writeSource(): void {
  mkdirSync(join(cwd, 'src'), {recursive: true});
  writeFileSync(join(cwd, 'src', 'foo.ts'), 'export const x = 1;\n');
}

describe('F-be5306eb AC-babf927c — SessionStart cold-start signal', () => {
  test('[covers:F-be5306eb/AC-babf927c] code but zero feature specs → the card carries the cold-start line', () => {
    writeSpec('[]');
    writeSource();
    const card = runHookEvent('SessionStart', {}, cwd);
    expect(card).toContain("feature cycle hasn't started");
  });

  test('a fresh project with no source code → no cold-start line', () => {
    writeSpec('[]'); // no source written
    const card = runHookEvent('SessionStart', {}, cwd);
    expect(card).not.toContain("hasn't started");
  });
});
