// Cladding · published CLI entry guards (portability + Node floor).
//
// These are SOURCE- and MANIFEST-level guards on purpose. Two reasons:
//
// 1. The Windows-only failures the launcher is prone to cannot be reproduced by
//    execution on POSIX CI — a raw `await import(<abs path>)` only throws
//    ERR_UNSUPPORTED_ESM_URL_SCHEME when the path starts with a drive letter
//    (`C:\…`), and a bare `spawnSync('npx', …)` only ENOENTs against the `.cmd`
//    shim on Windows.
// 2. The Node-floor refusal can only be observed by running an unsupported Node,
//    which a passing test run on a supported Node cannot do from the inside; the
//    executable proof lives in a separate CI job. Here we assert the launcher
//    source is shaped so the refusal happens, and happens before the engine
//    bundle is imported.
//
// The entry file under test is resolved THROUGH `package.json#bin`, never from a
// hardcoded filename, so what these tests read is exactly what npm installs.

import {existsSync, readFileSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  type?: string;
  bin?: Record<string, string>;
  engines?: Record<string, string>;
};

const binTarget = pkg.bin?.clad ?? '';
const binPath = resolve(root, binTarget);
const binClad = readFileSync(binPath, 'utf8');

describe('bin/clad — Windows portability guards', () => {
  test('imports the dist bundle via a file:// URL, never a raw absolute path', () => {
    expect(binClad).toContain('pathToFileURL');
    expect(binClad).toMatch(/await import\(pathToFileURL\(bundle\)\.href\)/);
    // The raw form is the Windows crash (drive letter read as URL scheme `c:`).
    expect(binClad).not.toMatch(/await import\(bundle\)(?!\.)/);
  });

  test('the dev fallback spawns npx through a shell on Windows', () => {
    // `npx` is `npx.cmd` on Windows; spawnSync can't resolve it without a shell.
    expect(binClad).toMatch(/shell:\s*process\.platform === 'win32'/);
  });
});

describe('bin/clad.mjs — loadable entry + declared Node floor', () => {
  test('[covers:F-5fc112ad/AC-d9a07c76] the published bin target is a real file whose extension Node resolves as a module', () => {
    // The "while" state of the criterion: the package declares ESM.
    expect(pkg.type).toBe('module');

    // The target npm links must exist on disk.
    expect(binTarget).not.toBe('');
    expect(existsSync(binPath)).toBe(true);

    // The regression shape was an EXTENSIONLESS target: under `"type": "module"`
    // Node's ESM loader rejects it with ERR_UNKNOWN_FILE_EXTENSION before any
    // project code runs. Name that shape, then pin the allowed extensions.
    const ext = extname(basename(binTarget));
    expect(ext).not.toBe('');
    expect(['.mjs', '.js']).toContain(ext);
  });

  test('[covers:F-5fc112ad/AC-e5fce752] the launcher floor and the manifest engines floor are the same major version', () => {
    const declared = /const NODE_FLOOR\s*=\s*(\d+)(?![\d.])/.exec(binClad);
    expect(declared).not.toBeNull();

    const engines = pkg.engines?.node ?? '';
    const manifest = />=\s*(\d+)/.exec(engines);
    expect(manifest).not.toBeNull();

    // Install-time warning and run-time refusal can never disagree.
    expect(Number(declared![1])).toBe(Number(manifest![1]));
  });

  test('[covers:F-5fc112ad/AC-3e98ffb1] the version check runs before the bundle import and refuses with a non-zero exit', () => {
    const checkIdx = binClad.indexOf('process.versions.node');
    const importIdx = binClad.indexOf('await import(pathToFileURL(bundle).href)');

    // Guard against a vacuous pass: -1 < anything is true.
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThanOrEqual(0);
    expect(checkIdx).toBeLessThan(importIdx);

    // The refusal path lives between the check and the import; scope the exit
    // assertion to it so a later `process.exit(status)` cannot satisfy this.
    const refusal = binClad.slice(checkIdx, importIdx);
    expect(refusal).toMatch(/process\.exit\(\s*[1-9]\d*\s*\)/);
  });

  test('[covers:F-5fc112ad/AC-3e98ffb1] the refusal message names the required version and the upgrade action', () => {
    const checkIdx = binClad.indexOf('process.versions.node');
    const importIdx = binClad.indexOf('await import(pathToFileURL(bundle).href)');
    expect(checkIdx).toBeGreaterThanOrEqual(0);
    expect(importIdx).toBeGreaterThanOrEqual(0);

    const refusal = binClad.slice(checkIdx, importIdx);
    // Requirement (the declared floor), and the action the user must take.
    expect(refusal).toContain('requires Node');
    expect(refusal).toContain('NODE_FLOOR');
    expect(refusal).toContain('Upgrade Node');
  });
});
