#!/usr/bin/env node
// Cladding · `clad` CLI shim.
//
// The filename MUST keep a module extension. npm's generated shim runs
// `node <path>/bin/clad.mjs`, and under `"type": "module"` Node's ESM
// loader rejects an extensionless file outright (ERR_UNKNOWN_FILE_EXTENSION
// on Node 16) — the crash happens inside Node, before a single line here
// runs, so nothing below could report it. Measured: Node 16 refuses the
// extensionless form, 18/20/22 accept it, and every release accepts `.mjs`.
//
// Production path: `dist/clad.js` is an esbuild bundle (single file,
// zero runtime dev-deps); we import it directly. Built by `npm run
// build`; auto-built by `npm install` via the `prepare` script.
//
// Development path: when `dist/clad.js` is absent (e.g. during a
// source edit before the next build), fall back to invoking
// `cli/clad.ts` through `tsx`. This keeps the dev loop fast — no need
// to rebuild after every change.

import {existsSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';

// Keep in step with `engines.node` in package.json — a source-level test pins
// the two together. The bundled command-line parser (commander) declares
// `>=20` and the esbuild target is `node20`, so this is the honest floor.
const NODE_FLOOR = 20;

// Runs BEFORE the bundle import on purpose: the bundle is what throws on an
// unsupported release, so a check placed after it would never be reached.
const running = process.versions.node;
if (Number(running.split('.')[0]) < NODE_FLOOR) {
  process.stderr.write(
    `cladding requires Node ${NODE_FLOOR} or newer. This is Node ${running}.\n` +
      'Upgrade Node, then run the command again.\n',
  );
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(here, '..', 'dist', 'clad.js');

if (existsSync(bundle)) {
  // `bundle` is an absolute filesystem path. On Windows it begins with a drive
  // letter (`C:\…`), which the ESM loader rejects as URL scheme `c:`
  // (ERR_UNSUPPORTED_ESM_URL_SCHEME). pathToFileURL → a valid file:// URL that
  // import() accepts on every platform.
  await import(pathToFileURL(bundle).href);
} else {
  const source = resolve(here, '..', 'src', 'cli', 'clad.ts');
  // shell:true on Windows so the `npx` shim (`npx.cmd`) resolves; on POSIX it's
  // a real binary and shell is unnecessary.
  const result = spawnSync('npx', ['tsx', source, ...process.argv.slice(2)], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exit(result.status ?? 1);
}
