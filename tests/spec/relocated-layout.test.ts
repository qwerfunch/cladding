// Cladding · Spec 0.2 F11 · every reader and writer follows the relocated layout.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {runHookEvent} from '../../src/cli/hook.js';
import {runRelocateGeneratedCommand} from '../../src/cli/relocate-generated.js';
import {readAttestation, writeAttestation} from '../../src/spec/attestation.js';
import {generatedDirectoryNoticeWrite, refreshDerivedSpecProjections} from '../../src/spec/edit.js';
import {loadSpec} from '../../src/spec/load.js';
import {inventoryDrift} from '../../src/stages/detectors/inventory-drift.js';
import {staleAttestation} from '../../src/stages/detectors/stale-attestation.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-relocated-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  mkdirSync(join(root, 'src'), {recursive: true});
  writeFileSync(join(root, 'src', 'm.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'spec.yaml'), 'schema: "0.1"\nproject: {name: relocated, language: typescript}\nfeatures: []\n');
  writeFileSync(join(root, 'spec', 'features', 'relocated-aaaa11.yaml'),
    'id: F-aaaa11\nslug: relocated\ntitle: Relocated\nstatus: done\nmodules: [src/m.ts]\n'
    + 'acceptance_criteria:\n  - {id: AC-001, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
  return root;
}

/** Moves the generated projections that exist into their relocated home. */
function relocate(root: string): void {
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  for (const [from, to] of [
    ['spec/index.yaml', 'spec/generated/index.yaml'],
    ['spec/_doc-links.yaml', 'spec/generated/_doc-links.yaml'],
    ['spec/attestation.yaml', 'spec/generated/attestation.yaml'],
  ]) {
    if (existsSync(join(root, from))) renameSync(join(root, from), join(root, to));
  }
}

/** Every file under a workspace with its bytes, for zero-diff comparisons. */
function manifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return manifest(root, path);
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('relocated generated layout', () => {
  test('[covers:F-0dafcf9d/AC-d119310e] the attestation writer and reader use the relocated receipt', () => {
    const root = workspace();
    expect(writeAttestation(root, loadSpec(root))).toBe(true);
    relocate(root);
    const relocated = readFileSync(join(root, 'spec/generated/attestation.yaml'), 'utf8');
    expect(readAttestation(root)).not.toBeNull();

    // A second write lands on the relocated receipt and never resurrects the
    // pre-relocation path.
    writeFileSync(join(root, 'src', 'm.ts'), 'export const value = 2;\n');
    expect(writeAttestation(root, loadSpec(root))).toBe(true);
    expect(existsSync(join(root, 'spec/attestation.yaml'))).toBe(false);
    expect(readFileSync(join(root, 'spec/generated/attestation.yaml'), 'utf8')).not.toBe(relocated);
  });

  test('[covers:F-0dafcf9d/AC-d119310e] a relocated attestation re-mints no rows and the detector stays silent', () => {
    const root = workspace();
    writeAttestation(root, loadSpec(root));
    const before = readFileSync(join(root, 'spec/attestation.yaml'), 'utf8');
    relocate(root);
    expect(staleAttestation.run({cwd: root})).toHaveLength(0);
    // Relocation moves bytes; it never re-verifies or re-issues a row.
    expect(readFileSync(join(root, 'spec/generated/attestation.yaml'), 'utf8')).toBe(before);
  });

  test('[covers:F-0dafcf9d/AC-d119310e] the index projection, the drift detector, and the session card follow the relocated index', () => {
    const root = workspace();
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    relocate(root);
    const relocatedIndex = join(root, 'spec/generated/index.yaml');
    expect(readFileSync(relocatedIndex, 'utf8')).toContain('F-aaaa11');
    expect(inventoryDrift.run({cwd: root})).toHaveLength(0);
    expect(runHookEvent('SessionStart', {}, root)).toContain('1 features (1 done, 0 in progress)');

    writeFileSync(join(root, 'spec', 'features', 'second-bbbb22.yaml'),
      'id: F-bbbb22\nslug: second\ntitle: Second\nstatus: planned\nmodules: []\n'
      + 'acceptance_criteria:\n  - {id: AC-002, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
    const findings = inventoryDrift.run({cwd: root});
    expect(findings.some((finding) => finding.path === 'spec/generated/index.yaml')).toBe(true);
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    expect(existsSync(join(root, 'spec/index.yaml'))).toBe(false);
    expect(readFileSync(relocatedIndex, 'utf8')).toContain('F-bbbb22');
    expect(readFileSync(relocatedIndex, 'utf8')).toContain('spec/generated/index.yaml merge=union');
  });

  test('[covers:F-0dafcf9d/AC-fe71ffb3] the pre-relocation layout keeps every reader and writer on its original paths', () => {
    const root = workspace();
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    expect(writeAttestation(root, loadSpec(root))).toBe(true);
    expect(existsSync(join(root, 'spec/index.yaml'))).toBe(true);
    expect(existsSync(join(root, 'spec/attestation.yaml'))).toBe(true);
    expect(existsSync(join(root, 'spec/generated'))).toBe(false);
    expect(readFileSync(join(root, 'spec/index.yaml'), 'utf8')).toContain('spec/index.yaml merge=union');
    expect(staleAttestation.run({cwd: root})).toHaveLength(0);
    expect(inventoryDrift.run({cwd: root})).toHaveLength(0);
    expect(runHookEvent('SessionStart', {}, root)).toContain('1 features (1 done, 0 in progress)');
  });

  test('[covers:F-0dafcf9d/AC-0d45a5c2] a schema 0.2 derived refresh projects the generated-directory notice and re-renders it idempotently', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-relocated-02-'));
    temporary.push(root);
    mkdirSync(join(root, 'spec', 'features'), {recursive: true});
    writeFileSync(join(root, 'spec.yaml'),
      'schema: "0.2"\nproject:\n  name: notice\n  language: typescript\n'
      + '  purpose: Project the generated-directory notice.\n  assurance_level: L2\n  scenario_policy: advisory\n');
    writeFileSync(join(root, 'spec', 'features', 'notice-cccc33.yaml'),
      'id: F-cccc33\ntitle: Notice\nstatus: planned\npurpose: Project a notice.\nmodules: []\ndepends_on: []\n'
      + 'capability_refs: []\nacceptance_criteria:\n  - id: AC-cccc34\n    kind: behavior\n'
      + '    statement: The system shall project a notice.\n');
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    const notice = readFileSync(join(root, 'spec/generated/README.md'), 'utf8');
    expect(notice).toContain('This notice is projected from the executable artifact registry. Do not edit.');
    expect(notice).toContain('`spec/index.yaml` — generated-index; on sync. Current location; relocation target `spec/generated/index.yaml`.');
    // A refresh that changes nothing writes nothing.
    expect(refreshDerivedSpecProjections(root)).toBe(false);
    expect(readFileSync(join(root, 'spec/generated/README.md'), 'utf8')).toBe(notice);

    // The notice is a derived projection too: a conflict on any artifact stops
    // it rather than letting it state one side as the location.
    writeFileSync(join(root, 'spec', 'attestation.yaml'), 'features: {}\n');
    writeFileSync(join(root, 'spec', 'generated', 'attestation.yaml'), 'features: {}\n');
    expect(() => generatedDirectoryNoticeWrite(root)).toThrow(/both of its known locations/);
  });

  test('[covers:F-0dafcf9d/AC-6c6fc2cd] a relocated workspace writes an absent receipt under the generated directory and a second apply changes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'clad-relocated-clean-'));
    temporary.push(root);
    mkdirSync(join(root, 'spec', 'features'), {recursive: true});
    mkdirSync(join(root, 'src'), {recursive: true});
    writeFileSync(join(root, 'src', 'm.ts'), 'export const value = 1;\n');
    writeFileSync(join(root, 'spec.yaml'),
      'schema: "0.2"\nproject:\n  name: cleanroom\n  language: typescript\n'
      + '  purpose: Prove a relocated workspace stays relocated.\n  assurance_level: L2\n  scenario_policy: advisory\n');
    writeFileSync(join(root, 'spec', 'features', 'cleanroom-dddd44.yaml'),
      'id: F-dddd44\ntitle: Cleanroom\nstatus: done\npurpose: Prove relocation holds.\n'
      + 'modules: [src/m.ts]\ndepends_on: []\ncapability_refs: []\nacceptance_criteria:\n  - id: AC-dddd45\n'
      + '    kind: behavior\n    statement: The system shall keep a relocated workspace relocated.\n');
    writeFileSync(join(root, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(root, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
    writeFileSync(join(root, '.gitattributes'), '# project attributes\nspec/index.yaml merge=union\n');
    expect(refreshDerivedSpecProjections(root)).toBe(true);
    expect(writeAttestation(root, loadSpec(root))).toBe(true);

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(runRelocateGeneratedCommand({cwd: root, apply: true}).changed).toBe(true);

    // A fresh clone of a relocated workspace carries no receipt: the first
    // green gate must mint it under the generated directory rather than
    // resurrect the pre-relocation path.
    rmSync(join(root, 'spec/generated/attestation.yaml'));
    expect(writeAttestation(root, loadSpec(root))).toBe(true);
    expect(existsSync(join(root, 'spec/attestation.yaml'))).toBe(false);
    expect(existsSync(join(root, 'spec/generated/attestation.yaml'))).toBe(true);

    const before = manifest(root);
    const second = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(process.exitCode).toBeUndefined();
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-e45228ec] a projection at both paths stops derived projection writes and is reported by both detectors', () => {
    const root = workspace();
    refreshDerivedSpecProjections(root);
    writeAttestation(root, loadSpec(root));
    mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
    writeFileSync(join(root, 'spec/generated/index.yaml'), readFileSync(join(root, 'spec/index.yaml'), 'utf8'));
    writeFileSync(join(root, 'spec/generated/attestation.yaml'), readFileSync(join(root, 'spec/attestation.yaml'), 'utf8'));

    writeFileSync(join(root, 'spec', 'features', 'second-bbbb22.yaml'),
      'id: F-bbbb22\nslug: second\ntitle: Second\nstatus: planned\nmodules: []\n'
      + 'acceptance_criteria:\n  - {id: AC-002, ears: ubiquitous, text: t, test_refs: [spec.yaml]}\n');
    expect(() => refreshDerivedSpecProjections(root)).toThrow(/both/);
    expect(inventoryDrift.run({cwd: root}).some((finding) => finding.message.includes('both'))).toBe(true);
    expect(staleAttestation.run({cwd: root}).some((finding) => finding.message.includes('both'))).toBe(true);
  });
});
