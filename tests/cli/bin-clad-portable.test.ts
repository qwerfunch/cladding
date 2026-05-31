// Cladding · bin/clad cross-platform (Windows) regression guard.
//
// CI runs on POSIX, so the Windows-only failures the shim is prone to cannot be
// reproduced by execution here — a raw `await import(<abs path>)` only throws
// ERR_UNSUPPORTED_ESM_URL_SCHEME when the path starts with a drive letter
// (`C:\…`), and a bare `spawnSync('npx', …)` only ENOENTs against the `.cmd`
// shim on Windows. Guard both invariants at the SOURCE level instead.

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {describe, expect, test} from 'vitest';

const binClad = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'clad'),
  'utf8',
);

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
