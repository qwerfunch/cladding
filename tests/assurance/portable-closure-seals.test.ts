// Cladding · Spec 0.2 F6 · closure seals stay equal to a clean checkout's.

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {readSafeProofClosureBytes} from '../../src/assurance/closures.js';
import {runnerConfigurationResolver} from '../../src/assurance/workspace.js';
import {receiptFileCensus} from '../../src/spec/attestation.js';

const roots: string[] = [];

function git(root: string, ...args: readonly string[]): void {
  execFileSync('git', args, {cwd: root, stdio: 'ignore'});
}

/** A committed workspace whose sealed surface is a directory-valued module. */
function workspace(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'clad-portable-seal-')));
  roots.push(root);
  mkdirSync(join(root, 'src', 'lib'), {recursive: true});
  mkdirSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa'), {recursive: true});
  writeFileSync(join(root, '.gitignore'), 'ignored/\n*.local.json\n.DS_Store\n');
  writeFileSync(join(root, 'package.json'), '{"name": "portable-seal-fixture", "version": "0.0.0"}\n');
  writeFileSync(join(root, 'tsconfig.json'), '{"compilerOptions": {"strict": true}}\n');
  writeFileSync(join(root, 'src', 'lib', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(root, 'src', 'lib', 'b.ts'), 'export const b = 2;\n');
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'add', '.');
  git(root, 'commit', '-q', '-m', 'fixture');
  return root;
}

/** The two seals a stamped attestation row carries for this workspace. */
function seals(root: string): {readonly module: string; readonly controls: string} {
  const bytes = readSafeProofClosureBytes(root, 'src/lib');
  const configuration = runnerConfigurationResolver(root)('workspace', 'all');
  return {
    module: bytes === undefined ? '<unreadable>' : createHash('sha256').update(bytes).digest('hex'),
    controls: createHash('sha256')
      .update(JSON.stringify([configuration.controls, configuration.unknown_controls, configuration.complete]))
      .digest('hex'),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 portable closure seals', () => {
  test('[covers:F-71da4292/AC-0c558efe] ignores desktop metadata and ignored files inside a sealed directory', () => {
    const root = workspace();
    const clean = seals(root);

    writeFileSync(join(root, 'src', 'lib', '.DS_Store'), 'metadata\n');
    writeFileSync(join(root, 'src', 'lib', 'notes.local.json'), '{"scratch": true}\n');
    writeFileSync(join(root, 'tsconfig.local.json'), '{"compilerOptions": {}}\n');
    mkdirSync(join(root, 'ignored'), {recursive: true});
    writeFileSync(join(root, 'ignored', 'package.json'), '{"name": "ignored-fixture"}\n');

    expect(seals(root)).toEqual(clean);
    // A named path is read under the same membership: an ignored file reads as
    // absent here exactly as it is absent from a clean checkout.
    expect(readSafeProofClosureBytes(root, 'src/lib/notes.local.json')).toBeUndefined();
    expect(readSafeProofClosureBytes(root, 'src/lib/.DS_Store')).toBeUndefined();
    expect(readSafeProofClosureBytes(root, 'src/lib/a.ts')).toBeDefined();

    // A directory holding nothing but ignored files does not exist in a clean
    // checkout, so it reads as absent rather than as an empty seal.
    mkdirSync(join(root, 'src', 'scratch'), {recursive: true});
    writeFileSync(join(root, 'src', 'scratch', 'draft.local.json'), '{}\n');
    expect(readSafeProofClosureBytes(root, 'src/scratch')).toBeUndefined();
  });

  test('[covers:F-71da4292/AC-830d4574] reseals a directory when an untracked file git does not ignore appears', () => {
    const root = workspace();
    const clean = seals(root);

    writeFileSync(join(root, 'src', 'lib', 'new.ts'), 'export const c = 3;\n');
    const dirty = seals(root);

    expect(dirty.module).not.toBe(clean.module);
    // The developer commits that file next; the seal must already match CI.
    git(root, 'add', '.');
    git(root, 'commit', '-q', '-m', 'add');
    expect(seals(root).module).toBe(dirty.module);
  });

  test('[covers:F-71da4292/AC-f264052f] seals an all-tracked workspace identically from git and from the filesystem walk', () => {
    const root = workspace();
    const fromGit = seals(root);

    // A checkout without git history exercises the filesystem fallback over
    // exactly the committed content; both readings must seal the same bytes.
    const plain = realpathSync(mkdtempSync(join(tmpdir(), 'clad-portable-seal-plain-')));
    roots.push(plain);
    execFileSync('sh', ['-c', `git archive HEAD | tar -x -C ${JSON.stringify(plain)}`], {cwd: root, stdio: 'ignore'});

    expect(seals(plain)).toEqual(fromGit);
  });

  test('[covers:F-71da4292/AC-47980510] skips desktop metadata in the receipt census while other unexpected files stay unresolved', () => {
    const root = workspace();
    expect(receiptFileCensus(root)).toEqual([]);

    writeFileSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', '.DS_Store'), 'metadata\n');
    expect(receiptFileCensus(root)).toEqual([]);

    writeFileSync(join(root, 'spec', 'evidence', 'F-aaaaaaaa', 'notes.txt'), 'not a receipt\n');
    expect(receiptFileCensus(root)).toBeUndefined();
  });
});
