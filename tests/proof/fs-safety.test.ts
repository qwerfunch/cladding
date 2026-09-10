// Cladding · proof filesystem-safety tests.

import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {resolveLegacyTestBinding} from '../../src/proof/legacy-bindings.js';
import {evaluateSchema02AcVerification} from '../../src/stages/detectors/unverified-ac.js';
import {parseJUnitReport} from '../../src/stages/junit-report.js';
import type {Spec} from '../../src/spec/types.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f5-proof-safe-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: safe\n  language: typescript\n  purpose: Reject outside proof files.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
  writeFileSync(join(root, 'spec', 'features', 'safe-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Safe\nstatus: done\npurpose: Reject outside proof files.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall reject outside proof files.\n');
  return root;
}

afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true}); });

describe('F5 proof filesystem boundary', () => {
  test('fails closed when tests root is a symlink', () => {
    const root = workspace();
    const outside = mkdtempSync(join(tmpdir(), 'clad-f5-proof-outside-'));
    temporary.push(outside);
    symlinkSync(outside, join(root, 'tests'));
    const spec = {schema: '0.2', features: [{id: 'F-aaaaaaaa', status: 'done', acceptance_criteria: [{id: 'AC-bbbbbbbb'}]}]} as never as Spec;
    expect(evaluateSchema02AcVerification(root, spec, parseJUnitReport(''))).toEqual([
      expect.objectContaining({severity: 'error', message: expect.stringMatching(/Unsafe native proof source root/)}),
    ]);
  });

  test('marks legacy file and ancestor symlinks unsafe without reading sentinels', () => {
    const root = workspace();
    mkdirSync(join(root, 'tests'));
    const outside = mkdtempSync(join(tmpdir(), 'clad-f5-proof-sentinel-'));
    temporary.push(outside);
    writeFileSync(join(outside, 'sentinel.test.ts'), 'sentinel');
    symlinkSync(join(outside, 'sentinel.test.ts'), join(root, 'tests', 'file.test.ts'));
    symlinkSync(outside, join(root, 'tests', 'ancestor'));
    expect(resolveLegacyTestBinding(root, 'F-aaaaaaaa/AC-bbbbbbbb', 'tests/file.test.ts').state).toBe('unsafe');
    expect(resolveLegacyTestBinding(root, 'F-aaaaaaaa/AC-bbbbbbbb', 'tests/ancestor/sentinel.test.ts').state).toBe('unsafe');
  });
});
