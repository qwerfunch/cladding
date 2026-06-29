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
  entryPoints: ['src/cli/clad.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/clad.js',
  banner: {js: banner},
  legalComments: 'none',
  // Minify the bundle (v0.2.26, F-075) — adding the MCP SDK in
  // v0.2.24 pushed the unminified bundle past 2.5 MB, and minify
  // reclaims ~40 %. The minify is whitespace + identifier renaming;
  // no syntax transforms, no source-map drop. The bundle stays a
  // single ESM file readable enough for diagnostic spelunking.
  minify: true,
  // Inline JSON imports (spec/schema.json) as embedded data instead of
  // runtime `readFileSync`. Without this, bundled code would look for
  // `dist/spec/schema.json` on disk.
  loader: {'.json': 'json'},
});

// Copy the JSON schema next to the bundle so `spec/validate.ts`
// (which reads it via `readFileSync(join(__dirname, 'schema.json'))`)
// can still find it — `__dirname` of the bundle is `dist/`.
import {copyFileSync, mkdirSync, readdirSync} from 'node:fs';
mkdirSync('dist', {recursive: true});
copyFileSync('src/spec/schema.json', 'dist/schema.json');

// Copy the persona prompts next to the bundle so the agent loader
// (loadPersona → resolveAgentPath) finds them on a real npm install — the
// bundle's `__dirname` is `dist/`, so personas must live at `dist/agents/<id>.md`.
// Without this, `clad run` and the MCP persona prompts crashed (the build only
// shipped personas under plugins/, never next to the bundle).
mkdirSync('dist/agents', {recursive: true});
// Sweep stale personas from earlier builds first (e.g. the pre-0.6.0
// `librarian.md` / `specialists.md` — renamed to planner/developer). The
// filesystem mirror must track src/agents exactly, or a removed persona
// would silently keep loading from the stale copy.
import {rmSync, existsSync} from 'node:fs';
const srcPersonas = new Set(readdirSync('src/agents').filter((f) => f.endsWith('.md')));
if (existsSync('dist/agents')) {
  for (const f of readdirSync('dist/agents')) {
    if (f.endsWith('.md') && !srcPersonas.has(f)) rmSync(`dist/agents/${f}`);
  }
}
let personaCount = 0;
for (const f of readdirSync('src/agents')) {
  if (!f.endsWith('.md')) continue;
  copyFileSync(`src/agents/${f}`, `dist/agents/${f}`);
  personaCount++;
}

// Copy the graph viewer assets (client JS + CSS, read as text by viewer-shell.ts)
// next to the bundle: the bundle's `import.meta.url` dir is `dist/`, so they must
// live at `dist/viewer/<name>` for `clad graph export --format html` to inline them.
mkdirSync('dist/viewer', {recursive: true});
let viewerCount = 0;
for (const f of readdirSync('src/graph/viewer')) {
  copyFileSync(`src/graph/viewer/${f}`, `dist/viewer/${f}`);
  viewerCount++;
}

chmodSync('dist/clad.js', 0o755);
console.log(
  `cladding: built dist/clad.js + dist/schema.json + ${personaCount} personas → dist/agents/ + ${viewerCount} viewer asset(s) → dist/viewer/`,
);
