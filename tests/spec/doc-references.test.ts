import {extractDocReferences, stripCodeSpans, DOC_LINKS_IGNORE_MARKER} from '../../src/spec/doc-references.js';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

interface DocEntry {
  doc: string;
  features: readonly string[];
  doc_links: readonly string[];
}

describe('doc-references', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-docref-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  const wdoc = (rel: string, body: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, body);
  };

  const byDoc = (s: {docs: readonly DocEntry[]}): Record<string, DocEntry> =>
    Object.fromEntries(s.docs.map((d) => [d.doc, d]));

  test('legacy sequential F-NNN ids are extracted alongside hash ids (shared lexer)', () => {
    // v0.7.0 regression: the doc axis matched only 6-8 hex ids, so prose
    // referencing legacy shards (F-001…F-083, still live) produced no edges
    // and no DOC_LINK_INTEGRITY validation. The shared feature-id lexer
    // (src/spec/feature-id.ts) restores them.
    wdoc('docs/legacy.md', 'Shipped in **v0.2.24 (F-073)** and F-049; hash sibling F-ee47fc2b. `F-001` in a code span stays ignored.');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/legacy.md'].features).toEqual(['F-049', 'F-073', 'F-ee47fc2b']);
  });

  test('extracts F-ids and resolved .md links, excluding fixture dirs and code spans', () => {
    wdoc('docs/a.md', 'see F-ee47fc2b and F-7794a6bc here. [link](./b.md). inline `F-cafef00d` ignored.');
    wdoc('docs/b.md', '# b');
    wdoc('docs/ab-evaluation-extended/r.md', 'fixture F-deadbeef');

    const s = extractDocReferences(dir);
    const m = byDoc(s);

    expect(m['docs/a.md'].features).toEqual(['F-7794a6bc', 'F-ee47fc2b']);
    expect(m['docs/a.md'].doc_links).toEqual(['docs/b.md']);
    expect(m['docs/ab-evaluation-extended/r.md']).toBeUndefined();
  });

  test('an opted-out doc yields no features but still yields doc_links', () => {
    wdoc('docs/c.md', '<!-- clad-doc-links: ignore -->\nF-ee47fc2b in prose. [x](./b.md)');
    wdoc('docs/b.md', '# b');

    const m = byDoc(extractDocReferences(dir));

    expect(m['docs/c.md'].features).toEqual([]);
    expect(m['docs/c.md'].doc_links).toEqual(['docs/b.md']);
  });

  test('fixture dirs and code-span ids are excluded', () => {
    expect(stripCodeSpans('a `F-aaaaaa` b')).not.toContain('F-aaaaaa');
    expect(stripCodeSpans('x\n```\nF-bbbbbb\n```\ny')).not.toContain('F-bbbbbb');

    wdoc('docs/dogfood/d.md', 'F-cccccc');
    wdoc('docs/e.md', '```\nF-dddddd\n```\nplain F-ee47fc2b');

    const m = byDoc(extractDocReferences(dir));

    expect(m['docs/dogfood/d.md']).toBeUndefined();
    expect(m['docs/e.md'].features).toEqual(['F-ee47fc2b']);
  });

  test('DOC_LINKS_IGNORE_MARKER is the expected sentinel', () => {
    expect(DOC_LINKS_IGNORE_MARKER).toBe('clad-doc-links: ignore');
  });
});
