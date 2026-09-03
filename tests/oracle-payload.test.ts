// Cladding · unit tests for oracle/payload.ts (Phase 2 — clad oracle blind brief)
//
// The load-bearing guarantee: the brief a blind author sees is built from the
// SPEC and module DECLARATIONS only, and NEVER contains an implementation body.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import {buildBlindPayload, renderBlindBrief} from '../src/oracle/payload.js';
import {runOracleCommand} from '../src/cli/clad.js';
import type {Spec} from '../src/spec/types.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-oracle-payload-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

const SPEC = {
  features: [
    {
      id: 'F-001',
      title: 'Widget',
      status: 'done',
      modules: ['src/m.ts'],
      acceptance_criteria: [
        {id: 'AC-001', ears: 'event', condition: 'when X happens', action: 'do Y', response: 'so that Z', text: 'When X happens, the system shall do Y.'},
      ],
    },
  ],
} as unknown as Spec;

function writeModule(): void {
  mkdirSync(join(dir, 'src'), {recursive: true});
  writeFileSync(
    join(dir, 'src/m.ts'),
    'export function foo(a: number): number {\n  const SECRET_BODY_LOGIC = a * 999 + 7;\n  return SECRET_BODY_LOGIC;\n}\nexport const BAR = 42;\n',
  );
}

function writeSpec(): void {
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject: {name: oracle, language: typescript}\nfeatures:\n  - id: F-001\n    title: Widget\n    status: done\n    modules: [src/m.ts]\n    acceptance_criteria:\n      - id: AC-001\n        ears: event\n        text: "When X happens, the system shall do Y."\n',
  );
}

describe('oracle/payload — clad oracle blind brief', () => {
  test('[covers:F-c4c5ae/AC-006] clad oracle prints ACs and declaration-only signatures without implementation bodies', () => {
    writeModule();
    writeSpec();
    let stdout = '';
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      stdout += String(chunk);
      return true;
    }) as never);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined as never) as never);
    try {
      runOracleCommand('F-001', {cwd: dir});
      expect(stdout).toContain('When X happens, the system shall do Y.');
      expect(stdout).toContain('export function foo(a: number): number');
      expect(stdout).not.toContain('SECRET_BODY_LOGIC');
      expect(exit).toHaveBeenCalledWith(0);
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });

  test('builds the AC fields + module paths from the spec', () => {
    writeModule();
    const p = buildBlindPayload(SPEC, 'F-001', undefined, dir)!;
    expect(p.featureTitle).toBe('Widget');
    expect(p.acs[0]?.action).toBe('do Y');
    expect(p.modules).toContain('src/m.ts');
    expect(p.readManifest).toContain('spec:acceptance_criteria');
  });

  test('signatures are DECL-ONLY — the export line, never the body', () => {
    writeModule();
    const p = buildBlindPayload(SPEC, 'F-001', undefined, dir)!;
    expect(p.signatures.some((s) => s.includes('export function foo(a: number): number'))).toBe(true);
    // The whole payload must NOT contain the implementation body.
    expect(JSON.stringify(p).includes('SECRET_BODY_LOGIC')).toBe(false);
  });

  test('the rendered brief never leaks an implementation body + carries the blind+conservative guidance', () => {
    writeModule();
    const brief = renderBlindBrief(buildBlindPayload(SPEC, 'F-001', undefined, dir)!);
    expect(brief).toContain('When X happens, the system shall do Y.');
    expect(brief).toContain('MUST NOT read it');
    expect(brief).toContain('WEAKER'); // conservative under-assertion (v7 spurious mitigation)
    expect(brief.includes('SECRET_BODY_LOGIC')).toBe(false);
  });

  test('--ac restricts the brief to one criterion; unknown feature → null', () => {
    writeModule();
    const one = buildBlindPayload(SPEC, 'F-001', 'AC-001', dir)!;
    expect(one.acs).toHaveLength(1);
    expect(buildBlindPayload(SPEC, 'F-NOPE', undefined, dir)).toBeNull();
  });

  test('missing module file → no signatures, but AC payload still builds (AC is load-bearing)', () => {
    const p = buildBlindPayload(SPEC, 'F-001', undefined, dir)!; // no module written
    expect(p.signatures).toHaveLength(0);
    expect(p.acs[0]?.text).toContain('When X happens');
  });

  test('[covers:F-c4c5ae/AC-006] a declared DIRECTORY module contributes no signatures instead of failing the brief', () => {
    writeModule();
    mkdirSync(join(dir, 'src/adapters'), {recursive: true});
    writeFileSync(join(dir, 'src/adapters/inner.ts'), 'export function hidden(): void {\n  const SECRET_BODY_LOGIC = 1;\n}\n');
    const spec = {
      features: [{...(SPEC.features[0] as object), modules: ['src/m.ts', 'src/adapters', 'src/cli/']}],
    } as unknown as Spec;

    const p = buildBlindPayload(spec, 'F-001', undefined, dir)!;

    // The file module still yields its declarations; neither directory spelling throws.
    expect(p.signatures.some((s) => s.startsWith('src/m.ts: export function foo'))).toBe(true);
    expect(p.signatures.filter((s) => s.startsWith('src/adapters') || s.startsWith('src/cli/'))).toEqual([]);
    // A directory holds no declaration lines, so nothing inside it can reach the author.
    expect(JSON.stringify(p)).not.toContain('SECRET_BODY_LOGIC');
    expect(JSON.stringify(p)).not.toContain('hidden');
    // The offer is still recorded: the author learns the path was on the table.
    expect(p.readManifest).toEqual([
      'signatures-of:src/m.ts', 'signatures-of:src/adapters', 'signatures-of:src/cli/', 'spec:acceptance_criteria',
    ]);
    expect(renderBlindBrief(p)).toContain('export function foo(a: number): number');
  });
});
