// Cladding · dev watch — incremental rebuild of dist/clad.js on src change.
//
// WHY: a globally `npm link`-ed clad (and any consumer repo using that global
// bin) executes `dist/clad.js`, NOT the TypeScript source. So local src edits
// don't reach the consumer until dist is rebuilt. This keeps dist fresh on
// every save via esbuild's incremental watch (faster than re-spawning the full
// build script). Only dist/clad.js is rebuilt — the plugin mirrors
// (plugins/**/dist) are NOT regenerated here; run `npm run build` for those.
//
// NOTE: esbuild strips types without type-checking. Run `npx tsc --noEmit`
// (or the gate) separately to catch type errors — a watch rebuild can succeed
// on code esbuild accepts but tsc would reject.

import {context} from 'esbuild';
import {chmodSync, copyFileSync, mkdirSync, readdirSync} from 'node:fs';

const banner = `#!/usr/bin/env node
import {createRequire as __claddingCreateRequire} from 'node:module';
const require = __claddingCreateRequire(import.meta.url);
globalThis.__CLADDING_BUNDLED = true;`;

// Static sidecars the bundle resolves relative to dist/ — copied once at start
// (they change far less often than source; rerun `npm run build` if they do).
mkdirSync('dist/agents', {recursive: true});
copyFileSync('src/spec/schema.json', 'dist/schema.json');
for (const f of readdirSync('src/agents')) {
  if (f.endsWith('.md')) copyFileSync(`src/agents/${f}`, `dist/agents/${f}`);
}

// Re-chmod + stamp after each incremental rebuild; on failure, keep the last
// good dist so the linked clad never breaks mid-edit.
const stamp = {
  name: 'stamp',
  setup(b) {
    b.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error(`cladding watch: build FAILED (${result.errors.length} error(s)) — dist/clad.js kept at last good`);
        return;
      }
      chmodSync('dist/clad.js', 0o755);
      console.log(`cladding watch: dist/clad.js rebuilt — linked clad is live`);
    });
  },
};

const ctx = await context({
  entryPoints: ['src/cli/clad.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/clad.js',
  banner: {js: banner},
  legalComments: 'none',
  minify: true,
  loader: {'.json': 'json'},
  plugins: [stamp],
});

await ctx.watch();
console.log('cladding watch: watching src/ → dist/clad.js  (Ctrl-C to stop)');
