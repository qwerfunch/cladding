// Cladding · drift detector · DOC_LINK_INTEGRITY link and declared-id resolution — F-ee5f643e

import {docReferenceIntegrity} from '../../../src/stages/detectors/doc-reference-integrity.js';
import {mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

import * as documentReferences from '../../../src/spec/doc-references.js';

interface Finding {
  detector: string;
  severity: 'error' | 'warn';
  message: string;
  path?: string;
}

const SPEC = `schema: "0.1"
project: {name: f, language: typescript}
features:
  - id: F-001
    title: f
    status: done
    acceptance_criteria:
      - id: AC-001
        ears: ubiquitous
        text: t
`;

describe('doc-reference-integrity / DOC_LINK_INTEGRITY', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-docintg-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, {recursive: true, force: true});
  });

  const wdoc = (rel: string, body: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, body);
  };

  const writeSpec = (): void => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
  };

  const run = (): Finding[] =>
    docReferenceIntegrity
      .run({cwd: dir})
      .filter((f): f is Finding => f.detector === 'DOC_LINK_INTEGRITY')
      .map((f) => ({...f}));

  test('[covers:F-ee5f643e/AC-cd5c3e00] a dead relative .md link is an error', () => {
    writeSpec();
    wdoc('docs/b.md', '# b');
    wdoc('docs/a.md', '[gone](./missing.md) [ok](./b.md)');

    const fs = run();

    expect(fs.some((f) => f.severity === 'error' && f.message.includes('missing.md'))).toBe(true);
    expect(fs.some((f) => f.severity === 'error' && f.message.includes('b.md') && !f.message.includes('missing.md'))).toBe(false);
  });

  test('[covers:F-ee5f643e/AC-3f1644f5] an unresolved F-id in a normal doc is a warn', () => {
    writeSpec();
    wdoc('docs/a.md', 'mentions F-deadbeef and F-001');

    const fs = run();

    expect(fs.some((f) => f.severity === 'warn' && f.message.includes('F-deadbeef'))).toBe(true);
    expect(fs.some((f) => f.message.includes('F-001'))).toBe(false);
  });

  test('declared unknown features are strict once, including excluded documents, while organic references remain warnings', () => {
    writeSpec();
    wdoc('docs/guide.md', '<!-- clad-doc-links: F-deadbeef -->\nprose F-deadbeef and F-cafef00d\n');
    wdoc('docs/dogfood/fixture.md', '<!-- clad-doc-links: F-deadbeef -->\nprose F-deadbeef\n');
    const scan = vi.spyOn(documentReferences, 'scanDocumentFacts');

    const fs = run();

    expect(scan).toHaveBeenCalledTimes(1);
    expect(fs.filter((finding) => finding.message.includes('F-deadbeef'))).toEqual([
      expect.objectContaining({severity: 'error', path: 'docs/dogfood/fixture.md'}),
      expect.objectContaining({severity: 'error', path: 'docs/guide.md'}),
    ]);
    expect(fs.filter((finding) => finding.severity === 'warn' && finding.message.includes('F-deadbeef'))).toEqual([]);
    expect(fs).toEqual(expect.arrayContaining([
      expect.objectContaining({severity: 'warn', path: 'docs/guide.md', message: expect.stringContaining('F-cafef00d')}),
    ]));
  });

  test('unsafe local Markdown paths are one-scan errors without target existence checks', () => {
    writeSpec();
    const outside = mkdtempSync(join(tmpdir(), 'clad-docintg-outside-'));
    try {
      writeFileSync(join(outside, 'outside.md'), '# outside');
      wdoc('docs/a.md', [
        '[up](../../outside.md)',
        '[absolute](/outside.md)',
        '[symlink](./escape.md)',
        '[missing](./missing.md)',
        '',
      ].join('\n'));
      symlinkSync(join(outside, 'outside.md'), join(dir, 'docs', 'escape.md'));
      const scan = vi.spyOn(documentReferences, 'scanDocumentFacts');

      const fs = run();

      expect(scan).toHaveBeenCalledTimes(1);
      expect(fs).toEqual(expect.arrayContaining([
        expect.objectContaining({severity: 'error', path: 'docs/a.md', message: expect.stringContaining('../../outside.md')}),
        expect.objectContaining({severity: 'error', path: 'docs/a.md', message: expect.stringContaining('/outside.md')}),
        expect.objectContaining({severity: 'error', path: 'docs/a.md', message: expect.stringContaining('./escape.md')}),
        expect.objectContaining({severity: 'error', path: 'docs/a.md', message: expect.stringContaining("links to missing file 'docs/missing.md'")}),
      ]));
      expect(fs.filter((finding) => finding.message.includes('unsafe local Markdown path'))).toHaveLength(3);
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });
});
