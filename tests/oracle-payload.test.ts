// Cladding · unit tests for oracle/payload.ts (Phase 2 — clad oracle blind brief)
//
// The load-bearing guarantee: the brief a blind author sees is built from the
// SPEC and module DECLARATIONS only, and NEVER contains an implementation body.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {buildBlindPayload, renderBlindBrief} from '../src/oracle/payload.js';
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

describe('oracle/payload — clad oracle blind brief', () => {
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
});
