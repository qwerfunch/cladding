// Cladding · proof signoff tests.

import {mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {recordAssertedSignoff} from '../../src/proof/signoff.js';

const temporary: string[] = [];

function writeWorkspace(schema: '0.1' | '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-f5-signoff-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  if (schema === '0.1') {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject: {name: signoff, language: typescript}\nfeatures: []\nscenarios: []\n');
    writeFileSync(join(root, 'spec', 'features', 'signoff-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\nslug: signoff\ntitle: Signoff\nstatus: in_progress\nmodules: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    text: The system shall retain local history.\n');
  } else {
    writeFileSync(join(root, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: signoff\n  language: typescript\n  purpose: Keep assertions distinct from receipts.\n  assurance_level: L2\n  scenario_policy: advisory\nfeatures: []\nscenarios: []\n');
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers: []\nrules: []\n');
    writeFileSync(join(root, 'spec', 'features', 'signoff-aaaaaaaa.yaml'), 'id: F-aaaaaaaa\ntitle: Signoff\nstatus: in_progress\npurpose: Keep assertions distinct from receipts.\nmodules: []\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-bbbbbbbb\n    kind: behavior\n    statement: The system shall retain local history.\n');
  }
  return root;
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('asserted signoff boundary', () => {
  test('records asserted audit history without a terminal, OS, git, or caller verification bypass', () => {
    const root = writeWorkspace('0.1');
    const result = recordAssertedSignoff({cwd: root, featureId: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass'});
    expect(result).toMatchObject({ok: true, code: 'OK', evidence: {assurance: 'asserted', identity: {author: 'human'}}});
    expect(JSON.parse(readFileSync(join(root, '.cladding', 'audit.log.jsonl'), 'utf8'))).toMatchObject({assurance: 'asserted'});
  });

  test('surfaces HUMAN_REQUIRED after recording schema 0.2 assertion-only history', () => {
    const root = writeWorkspace('0.2');
    const result = recordAssertedSignoff({cwd: root, featureId: 'F-aaaaaaaa', claim: 'audit', criterion: 'AC-bbbbbbbb', result: 'pass'});
    expect(result).toMatchObject({ok: false, code: 'HUMAN_REQUIRED', evidence: {assurance: 'asserted'}});
    expect(readFileSync(join(root, '.cladding', 'audit.log.jsonl'), 'utf8')).toContain('"assurance":"asserted"');
  });
});
