// Cladding · Spec 0.2 F11 · `clad relocate-generated` public command tests.

import {existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test, vi} from 'vitest';

import {runRelocateGeneratedCommand} from '../../src/cli/relocate-generated.js';
import {hasPendingSpecTransaction, recoverSpecTransaction} from '../../src/spec/transaction.js';

const temporary: string[] = [];

function workspace(schema: '0.1' | '0.2' = '0.2'): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-relocate-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'features'), {recursive: true});
  writeFileSync(join(root, 'spec.yaml'), schema === '0.2'
    ? 'schema: "0.2"\nproject:\n  name: relocate\n  language: typescript\n  purpose: Prove opt-in relocation.\n  assurance_level: L2\n  scenario_policy: advisory\n'
    : 'schema: "0.1"\nproject:\n  name: relocate\n  language: typescript\n  intent_summary: Prove opt-in relocation.\nfeatures: []\nscenarios: []\n');
  writeFileSync(join(root, 'spec', 'index.yaml'), 'features:\n  F-aaaaaaaa: {slug: relocate, status: planned, modules: 0}\n');
  writeFileSync(join(root, 'spec', '_doc-links.yaml'), 'documents: {}\n');
  writeFileSync(join(root, 'spec', 'attestation.yaml'), 'features: {}\n');
  writeFileSync(join(root, '.gitattributes'), '# project attributes\nspec/index.yaml merge=union\n');
  return root;
}

function manifest(root: string, directory: string = root): readonly {readonly path: string; readonly bytes: string}[] {
  return readdirSync(directory, {withFileTypes: true})
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return manifest(root, path);
      return [{path: path.slice(root.length + 1), bytes: readFileSync(path).toString('base64')}];
    });
}

function captureStdout(): {read: () => string} {
  const chunks: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return {read: () => chunks.join('')};
}

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('clad relocate-generated', () => {
  test('[covers:F-0dafcf9d/AC-b0a7992d] prints the planned moves and writes nothing without the apply flag', () => {
    const root = workspace();
    const before = manifest(root);
    const stdout = captureStdout();
    const result = runRelocateGeneratedCommand({cwd: root});
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(process.exitCode).toBeUndefined();
    expect(stdout.read()).toContain('spec/index.yaml → spec/generated/index.yaml');
    expect(stdout.read()).toContain('No files were changed.');
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-b0a7992d] emits the same plan as JSON, naming each action and the gitattributes follow-up', () => {
    const root = workspace();
    const before = manifest(root);
    const stdout = captureStdout();
    runRelocateGeneratedCommand({cwd: root, json: true});
    const plan = JSON.parse(stdout.read()) as {
      state: string;
      writes: number;
      artifacts: {id: string; from: string; to: string; action: string}[];
      gitattributes: {line: string; action: string};
    };
    expect(plan.state).toBe('old');
    expect(plan.writes).toBe(0);
    expect(plan.artifacts.map((artifact) => artifact.action)).toEqual(['move', 'move', 'move']);
    expect(plan.artifacts[0]).toMatchObject({id: 'generated-index', from: 'spec/index.yaml', to: 'spec/generated/index.yaml'});
    expect(plan.gitattributes).toEqual({line: 'spec/index.yaml merge=union', action: 'retarget'});
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-c91dc861] moves every present projection under the generated directory in one recoverable transaction', () => {
    const root = workspace();
    const originals = Object.fromEntries(['spec/index.yaml', 'spec/_doc-links.yaml', 'spec/attestation.yaml']
      .map((path) => [path, readFileSync(join(root, path), 'utf8')]));
    captureStdout();
    const result = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(hasPendingSpecTransaction(root)).toBe(false);
    for (const [path, bytes] of Object.entries(originals)) {
      expect(existsSync(join(root, path))).toBe(false);
      const relocated = path.replace('spec/', 'spec/generated/');
      expect(readFileSync(join(root, relocated), 'utf8')).toBe(bytes);
    }
    expect(readFileSync(join(root, '.gitattributes'), 'utf8')).toContain('spec/generated/index.yaml merge=union');
    expect(readFileSync(join(root, '.gitattributes'), 'utf8')).not.toContain('\nspec/index.yaml merge=union');
    expect(readFileSync(join(root, 'spec/generated/README.md'), 'utf8')).toContain('`spec/generated/index.yaml` — generated-index; on sync. Relocated.');
  });

  test('[covers:F-0dafcf9d/AC-6c6fc2cd] changes no bytes when the workspace is already relocated', () => {
    const root = workspace();
    captureStdout();
    runRelocateGeneratedCommand({cwd: root, apply: true});
    const after = manifest(root);
    vi.restoreAllMocks();
    const stdout = captureStdout();
    const second = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(process.exitCode).toBeUndefined();
    expect(stdout.read()).toContain('already relocated');
    expect(manifest(root)).toEqual(after);
  });

  test('[covers:F-0dafcf9d/AC-e45228ec] refuses to apply while a projection exists at both known locations', () => {
    const root = workspace();
    mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
    writeFileSync(join(root, 'spec', 'generated', 'index.yaml'), 'features: {}\n');
    const before = manifest(root);
    const preview = captureStdout();
    runRelocateGeneratedCommand({cwd: root});
    // The preview says what blocks the move instead of inviting a rerun that
    // `--apply` would only refuse.
    expect(preview.read()).toContain('Relocation is blocked');
    expect(preview.read()).toContain('exists at both of its known locations: generated-index (spec/index.yaml and spec/generated/index.yaml)');
    expect(preview.read()).toContain('Remove the copy you do not keep, then rerun.');
    expect(preview.read()).not.toContain('Next: rerun');
    vi.restoreAllMocks();
    process.exitCode = undefined;

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(result.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(String(stderr.mock.calls[0][0])).toContain('both of its known locations');
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-b0a7992d] names an obstructed known location in the preview and still refuses to apply', () => {
    const root = workspace();
    mkdirSync(join(root, 'spec', 'generated', 'attestation.yaml'), {recursive: true});
    const before = manifest(root);
    const stdout = captureStdout();
    runRelocateGeneratedCommand({cwd: root});
    expect(stdout.read()).toContain('generated-attestation: spec/generated/attestation.yaml (directory) blocks relocation');
    expect(stdout.read()).toContain('Relocation is blocked; 2 pending moves wait behind it. No files were changed.');
    expect(stdout.read()).toContain('may not be a directory or a symbolic link: spec/generated/attestation.yaml (directory). Remove it, then rerun.');
    expect(stdout.read()).not.toContain('Next: rerun');
    vi.restoreAllMocks();

    const json = captureStdout();
    runRelocateGeneratedCommand({cwd: root, json: true});
    const plan = JSON.parse(json.read()) as {
      artifacts: {id: string; action: string; irregular?: {path: string; kind: string}[]}[];
    };
    expect(plan.artifacts.find((artifact) => artifact.id === 'generated-attestation')).toMatchObject({
      action: 'irregular',
      irregular: [{path: 'spec/generated/attestation.yaml', kind: 'directory'}],
    });
    vi.restoreAllMocks();

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const applied = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(applied.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(String(stderr.mock.calls[0][0])).toContain('spec/generated/attestation.yaml (directory)');
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-b0a7992d] reports a workspace blocked at every known location as blocked, not as nothing to relocate', () => {
    const root = workspace();
    for (const path of ['spec/index.yaml', 'spec/_doc-links.yaml', 'spec/attestation.yaml']) rmSync(join(root, path));
    for (const path of ['index.yaml', '_doc-links.yaml', 'attestation.yaml']) {
      mkdirSync(join(root, 'spec', 'generated', path), {recursive: true});
    }
    const before = manifest(root);
    const stdout = captureStdout();
    const result = runRelocateGeneratedCommand({cwd: root});
    expect(result.ok).toBe(true);
    // No projection can move, but the obstruction is the reason — saying
    // nothing is to relocate would hide it.
    expect(stdout.read()).not.toContain('Nothing to relocate.');
    expect(stdout.read()).toContain('Relocation is blocked. No files were changed.');
    expect(stdout.read()).toContain('may not be a directory or a symbolic link');
    expect(manifest(root)).toEqual(before);
  });

  test('[covers:F-0dafcf9d/AC-cfed0959] refuses in a schema 0.1 workspace and points at schema migration', () => {
    const root = workspace('0.1');
    const before = manifest(root);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const result = runRelocateGeneratedCommand({cwd: root, apply: true});
    expect(result.ok).toBe(false);
    expect(process.exitCode).toBe(1);
    expect(String(stderr.mock.calls[0][0])).toContain('clad migrate --to 0.2');
    expect(manifest(root)).toEqual(before);
  });

  // The journal manifest this crash leaves behind mixes the uppercase notice
  // with its lowercase siblings, so recovery only succeeds while the commit
  // orders paths by code unit exactly as the journal validator does.
  test('[covers:F-0dafcf9d/AC-c91dc861] recovers a crashed relocation whose journal mixes the uppercase notice with its lowercase siblings', () => {
    const root = workspace();
    const before = manifest(root);
    captureStdout();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const crashed = runRelocateGeneratedCommand({cwd: root, apply: true, faultAfterReplacementForTesting: 1});
    expect(crashed.ok).toBe(false);
    expect(hasPendingSpecTransaction(root)).toBe(true);
    expect(recoverSpecTransaction(root)).toBe(true);
    expect(manifest(root)).toEqual(before);
  });
});
