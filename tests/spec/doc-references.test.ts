import {extractDocReferences, renderDocLinksYaml, scanDocumentFacts, stripCodeSpans, DOC_LINKS_IGNORE_MARKER} from '../../src/spec/doc-references.js';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
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

  test('keeps provenance-distinct facts, no-reference artifacts, and unsafe traversal explicit', () => {
    wdoc('docs/target.md', '# target');
    wdoc('docs/empty.md', '# no semantic references');
    wdoc('docs/ignored.md', '<!-- clad-doc-links: ignore --> F-77777777 [target](./target.md)');
    wdoc('docs/guide.md', [
      '<!-- clad-doc-links: F-11111111 -->',
      'Prose names F-11111111 and F-22222222. [target](./target.md#section) `F-33333333`.',
      '```md', '<!-- clad-doc-links: F-44444444 -->', '[inert](./missing.md)', '```', '',
    ].join('\n'));
    wdoc('docs/dogfood/fixture.md', '<!-- clad-doc-links: F-55555555 --> F-66666666 [ignored](./missing.md)');
    symlinkSync(join(dir, 'docs', 'target.md'), join(dir, 'docs', 'linked.md'));

    const scan = scanDocumentFacts(dir);
    const rows = Object.fromEntries(scan.docs.map((doc) => [doc.doc, doc]));

    expect(rows['docs/empty.md']).toMatchObject({explicit: [], organic: [], links: []});
    expect(rows['docs/guide.md']).toMatchObject({
      explicit: [expect.objectContaining({featureId: 'F-11111111', raw: 'F-11111111', selector: expect.stringMatching(/^declaration:/)})],
      organic: [expect.objectContaining({featureId: 'F-22222222'})],
      links: [expect.objectContaining({raw: './target.md#section', target: 'docs/target.md', state: 'resolved', selector: expect.stringMatching(/^link:/)})],
    });
    expect(rows['docs/dogfood/fixture.md']).toMatchObject({
      excluded: true,
      explicit: [expect.objectContaining({featureId: 'F-55555555'})],
      organic: [],
      links: [],
    });
    expect(rows['docs/ignored.md']).toMatchObject({organic: [], links: [expect.objectContaining({target: 'docs/target.md'})]});
    expect(scan).toMatchObject({
      completeness: 'unknown',
      unknownReasons: expect.arrayContaining(['document scan refuses symlink traversal: docs/linked.md']),
    });
  });

  test('keeps the legacy projection bytes unchanged for declarations, prose, links, and exclusions', () => {
    wdoc('docs/a.md', '<!-- clad-doc-links: F-11111111 --> prose F-22222222 [b](./b.md)');
    wdoc('docs/b.md', '# b');
    wdoc('docs/dogfood/c.md', '<!-- clad-doc-links: F-33333333 --> prose F-44444444 [b](./b.md)');
    wdoc('docs/benchmarks/d.md', 'prose F-55555555 [b](./b.md)');

    expect(renderDocLinksYaml(dir)).toBe([
      '# Cladding · Tier C — generated doc→spec / doc→doc link index (`clad sync`). Do not edit by hand.',
      '# Source of truth is the docs themselves; DOC_LINK_INTEGRITY validates resolution.',
      'schema: "0.1"',
      'docs:',
      '  "docs/a.md":',
      '    features: [F-11111111, F-22222222]',
      '    doc_links: ["docs/b.md"]',
      '  "docs/dogfood/c.md":',
      '    features: [F-33333333]',
      '',
    ].join('\n'));
  });
});
