// Cladding · derived-file merge ritual doc pins (F-0e84628e)
//
// Dogfood self-check (sibling home: tests/readme-record-honesty.test.ts at the
// tests root). The 0.8.1 machinery (v2 attestation encoding, git-op write
// guard, union removal) shrinks the derived-file conflict surface but cannot
// erase the same-file / adjacent-line remainder — the documented ritual is the
// answer for what is left, and hand-resolving hashes is always wrong (both
// sides are stale against the merged tree). These pins hold the canonical
// section in docs/spec-ids-multi-dev.md (ritual steps IN ORDER, PR-surface
// explanation, adjacent-line caveat, v1→v2 transition), keep CLAUDE.md a
// pointer instead of a duplicate, and tie the doc's attribute table to the
// REAL parsed .gitattributes so a future attribute change forces a doc update.
//
// cladding-SELF pins (they read this repo's own docs), NOT shipped detectors.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const DOC = 'docs/spec-ids-multi-dev.md';
const SECTION_TITLE = 'Merging: derived files heal, never hand-resolve';

// Slice one markdown section: from its heading to the next heading at the
// same or a shallower level ('\n## ' for a ##-section, '\n### ' for a sub).
const sliceSection = (body: string, heading: string, nextMarker: string): string => {
  const start = body.indexOf(heading);
  if (start === -1) return '';
  const after = body.slice(start + heading.length);
  const end = after.indexOf(nextMarker);
  return end === -1 ? after : after.slice(0, end);
};

const mergeSection = (): string => sliceSection(read(DOC), `## ${SECTION_TITLE}`, '\n## ');

describe('AC-19f796fe · the canonical merge ritual lives in docs/spec-ids-multi-dev.md', () => {
  test('the section heading is present ("derived files heal")', () => {
    expect(read(DOC), 'canonical section heading').toContain(`## ${SECTION_TITLE}`);
    expect(mergeSection(), 'the section has a body').not.toBe('');
  });

  test("[covers:F-0e84628e/AC-19f796fe] the four ritual steps appear in order: accept-either -> complete the merge -> strict gate -> commit the rewrite", () => {
    const ritual = sliceSection(mergeSection(), '### The ritual', '\n### ');
    expect(ritual, 'the ritual subsection exists').not.toBe('');
    const STEPS: [string, string][] = [
      ['accept either side of the derived files', 'git checkout --ours -- spec/attestation.yaml spec/index.yaml'],
      ['complete the merge first', 'git commit --no-edit'],
      ['run the strict pre-push gate', 'clad check --tier=pre-push --strict'],
      ['commit the canonical rewrite', 'chore: canonicalize derived files after merge'],
    ];
    let prev = -1;
    for (const [step, anchor] of STEPS) {
      const idx = ritual.indexOf(anchor);
      expect(idx, `step "${step}" (${anchor}) present and after the previous step`).toBeGreaterThan(prev);
      prev = idx;
    }
  });

  test('the PR-surface explanation: GitHub merges never consult .gitattributes', () => {
    const section = mergeSection();
    expect(section, 'the PR-surface lead').toContain('The PR surface ignores merge attributes');
    expect(section, 'the mechanism — a server-side merge').toContain('A pull-request merge on GitHub is a server-side merge that never consults');
  });

  test('the adjacent-sorted-line caveat bounds the v2 clean-merge property', () => {
    const section = mergeSection();
    expect(section, 'the caveat lead').toContain('Adjacent sorted lines');
    expect(section, 'the boundary — immediately adjacent lines still conflict').toContain('immediately adjacent');
  });

  test('the one-time v1->v2 transition: rebase past the conversion, take the v2 side, run the gate', () => {
    const section = mergeSection();
    expect(section, 'the transition heading').toContain('### The one-time v1→v2 transition');
    expect(section, 'rebase past the conversion commit').toContain('rebase past the conversion commit');
    expect(section, 'take the already-converted v2 copy').toContain('take the already-converted (v2) copy');
    expect(section, 'then the gate recomputes').toContain('run the gate to recompute');
  });
});

describe('AC-74fcf893 · CLAUDE.md points at the canonical section, never duplicates it', () => {
  test("[covers:F-0e84628e/AC-74fcf893] CLAUDE.md carries the pointer: the doc path plus the exact section title", () => {
    const claude = read('CLAUDE.md');
    expect(claude, 'points at the canonical doc').toContain('docs/spec-ids-multi-dev.md');
    expect(claude, 'quotes the exact section title').toContain(SECTION_TITLE);
  });

  test('the bash ritual lives in the doc and NOT in CLAUDE.md (one source of truth)', () => {
    const acceptEither = 'git checkout --ours -- spec/attestation.yaml';
    expect(read(DOC), 'the doc carries the accept-either step').toContain(acceptEither);
    expect(read('CLAUDE.md'), 'CLAUDE.md does not duplicate the ritual steps').not.toContain(acceptEither);
  });
});

describe('AC-80b79dac · the documented attribute state matches the real .gitattributes', () => {
  // Minimal .gitattributes line model: `<pattern> <attr> [<attr>...]`, comments
  // and blanks skipped. Enough for this repo's one-liner, and strict enough
  // that ANY new merge-carrying pattern (an explicit attestation line OR a
  // glob like `spec/*.yaml merge=union` that would sweep attestation in)
  // breaks the only-index invariant below.
  const parseGitattributes = (raw: string): {pattern: string; attrs: string[]}[] =>
    raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'))
      .map((l) => {
        const [pattern, ...attrs] = l.split(/\s+/);
        return {pattern, attrs};
      });
  const carriesMerge = (attrs: string[]): boolean =>
    attrs.some((a) => a === 'merge' || a === '-merge' || a === '!merge' || a.startsWith('merge='));

  test("[covers:F-0e84628e/AC-80b79dac] repository state: spec/index.yaml has merge=union; spec/attestation.yaml carries no merge attribute", () => {
    const entries = parseGitattributes(read('.gitattributes'));
    const index = entries.find((e) => e.pattern === 'spec/index.yaml');
    expect(index, 'spec/index.yaml has an attributes line').toBeDefined();
    expect(index?.attrs ?? [], 'spec/index.yaml keeps merge=union').toContain('merge=union');
    const mergeCarriers = entries.filter((e) => carriesMerge(e.attrs)).map((e) => e.pattern);
    expect(mergeCarriers, 'spec/index.yaml is the ONLY pattern carrying a merge attribute — nothing (explicit or glob) gives spec/attestation.yaml one').toEqual(['spec/index.yaml']);
  });

  test('the doc attribute table states the same: index -> merge=union, attestation -> no attribute', () => {
    const section = mergeSection();
    expect(section, 'index table row cites merge=union').toContain('| `spec/index.yaml` | `merge=union` |');
    expect(section, 'attestation table row cites the deliberate absence').toContain('| `spec/attestation.yaml` | *(no attribute — deliberate)*');
    expect(section, 'the table declares itself pinned to repository state — this test makes that true').toContain('This table is pinned to the real repository state');
  });
});
