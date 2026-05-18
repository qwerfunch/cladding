// Cladding · build script — produces dist/clad.js (esbuild bundle).
//
// Why a script file instead of an inline esbuild command in
// package.json:
// 1. The banner needs a multi-line `createRequire` shim so that
//    CommonJS dependencies (commander, etc.) can keep their internal
//    `require(...)` calls working inside the ESM bundle.
// 2. The chmod step keeps the bundle directly executable from the
//    bin field, no separate post-build chmod needed.
//
// @see https://github.com/evanw/esbuild/issues/1944 — the canonical
//      ESM-bundle-of-CommonJS workaround using createRequire.

import {build} from 'esbuild';
import {chmodSync} from 'node:fs';

const banner = `#!/usr/bin/env node
import {createRequire as __claddingCreateRequire} from 'node:module';
const require = __claddingCreateRequire(import.meta.url);
// Marker for stages/*.ts: when true, the per-stage CLI-entry guard
// short-circuits so the bundle doesn't fire every stage at startup.
globalThis.__CLADDING_BUNDLED = true;`;

await build({
  entryPoints: ['cli/clad.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/clad.js',
  banner: {js: banner},
  legalComments: 'none',
  // Inline JSON imports (spec/schema.json) as embedded data instead of
  // runtime `readFileSync`. Without this, bundled code would look for
  // `dist/spec/schema.json` on disk.
  loader: {'.json': 'json'},
});

// Copy the JSON schema next to the bundle so `spec/validate.ts`
// (which reads it via `readFileSync(join(__dirname, 'schema.json'))`)
// can still find it — `__dirname` of the bundle is `dist/`.
import {copyFileSync, mkdirSync} from 'node:fs';
mkdirSync('dist', {recursive: true});
copyFileSync('spec/schema.json', 'dist/schema.json');

chmodSync('dist/clad.js', 0o755);
console.log('cladding: built dist/clad.js + dist/schema.json');
