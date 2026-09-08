// Cladding · scripts/ab-abc/write-tests.mjs — the fixture's test file, generated
//
// Kept as its own file rather than inline in the shell because the tests are
// full of quotes, and a generator you cannot read is a generator you cannot
// trust. Called by lib-fixture.sh.
//
// Usage: node write-tests.mjs <dest> <mode> <feature> <ac1> <ac2> <ac3>
//
// mode:
//   leading   each title opens with `[covers:F-…/AC-…]` — 0.10.0's real binding
//   trailing  the same token sits at the END of each title, where it looks bound
//             to a human and is invisible to the engine (the trap)
//   plain     no tokens at all — 0.9.4's shape, which binds through test_refs
//
// Each test carries its OWN criterion. Binding three tests to one criterion
// would leave the other two unclaimed and turn every downstream row into a study
// of that mistake.

import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import process from 'node:process';

const [dest, mode, feature = '', ac1 = '', ac2 = '', ac3 = ''] = process.argv.slice(2);
if (!dest || !mode) throw new Error('usage: write-tests.mjs <dest> <mode> [feature ac1 ac2 ac3]');

const cases = [
  {ac: ac1, title: 'AC-1 lower-cases and hyphenates a title', body: "expect(slugify('Hello World!')).toBe('hello-world');"},
  {ac: ac2, title: 'AC-2 folds diacritics to their base letters', body: "expect(slugify('Crème Brûlée')).toBe('creme-brulee');"},
  {
    ac: ac3,
    title: 'AC-3 rejects an input with nothing slug-able in it',
    body: "expect(() => slugify('   ')).toThrow('no slug-able characters');",
  },
];

const decorate = (title, ac) => {
  const token = `[covers:${feature}/${ac}]`;
  if (mode === 'leading') return `${token} ${title}`;
  if (mode === 'trailing') return `${title} ${token}`;
  if (mode === 'plain') return title;
  throw new Error(`unknown binding mode: ${mode}`);
};

const lines = [
  '// Fixture tests for the slugify module.',
  "import {describe, expect, test} from 'vitest';",
  '',
  "import {slugify} from '../src/slugify.js';",
  '',
  "describe('slugify', () => {",
];
for (const c of cases) {
  lines.push(`  test('${decorate(c.title, c.ac)}', () => {`, `    ${c.body}`, '  });', '');
}
lines.push('});', '');

writeFileSync(join(dest, 'tests', 'slugify.test.ts'), lines.join('\n'));
