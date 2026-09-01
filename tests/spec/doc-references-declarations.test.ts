// Cladding · spec · explicit doc-link declarations — F-bae800bd
//
// Contract: an evidence doc parked under an excluded dir (docs/ab-evaluation/…)
// can opt precise features into the knowledge graph via a machine-directed
// `<!-- clad-doc-links: F-xxx, F-yyy -->` comment, even when its prose never
// names an F-id — while adopter repos with no declarations see byte-identical
// extraction (no index churn). These tests verify the four ACs of the shard
// (spec/features/ab-case-doc-binding-bae800bd.yaml) at the extractor, the real
// repo, and the DOC_LINK_INTEGRITY detector.

import {extractDocReferences, renderDocLinksYaml, DOC_SCAN_EXCLUDE} from '../../src/spec/doc-references.js';
import type {DocLinks, DocRefScan} from '../../src/spec/doc-references.js';
import {docReferenceIntegrity} from '../../src/stages/detectors/doc-reference-integrity.js';
import {loadSpec} from '../../src/spec/load.js';
import {featureIdRe} from '../../src/spec/feature-id.js';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The five A/B case studies the shard binds into the graph (modules list). */
const CASE_DOCS = [
  'docs/ab-evaluation/case-efficiency-measurement.md',
  'docs/ab-evaluation/case-working-set-landmine.md',
  'docs/ab-evaluation/case-graph-efficiency.md',
  'docs/ab-evaluation/case-iterative-vs-fixed-vapt.md',
  'docs/ab-evaluation/case-doverunner-scale.md',
];

/** Minimal loadable spec for the detector control test (defines F-001 only). */
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

const byDoc = (s: DocRefScan): Record<string, DocLinks> =>
  Object.fromEntries(s.docs.map((d) => [d.doc, d]));

const isExcluded = (relPosix: string): boolean =>
  DOC_SCAN_EXCLUDE.some((p) => relPosix === p || relPosix.startsWith(`${p}/`));

/**
 * Re-derives the declared ids of a real file independently of the module under
 * test — so AC-91d9d1a5 reads each doc's declaration from the file rather than
 * hardcoding a list. Mirrors declaredFeatureIds: skip an `ignore` sentinel line,
 * collect F-ids via the shared lexer, dedupe + sort.
 */
const declaredIdsOf = (absPath: string): string[] => {
  const raw = readFileSync(absPath, 'utf8');
  const ids: string[] = [];
  for (const m of raw.matchAll(/clad-doc-links:[ \t]*([^\n>]*)/g)) {
    if (m[1].trim().startsWith('ignore')) continue;
    for (const id of m[1].match(featureIdRe('g')) ?? []) ids.push(id);
  }
  return [...new Set(ids)].sort();
};

describe('doc declarations · extraction + materialization (AC-b0e7dd4d)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-docdecl-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  const wdoc = (rel: string, body: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, body);
  };

  test('an explicit clad-doc-links declaration binds exactly the named ids', () => {
    wdoc('docs/note.md', '<!-- clad-doc-links: F-16138071, F-06dfdad6 -->\n\nThis report never names a feature in prose.');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/note.md'].features).toEqual(['F-06dfdad6', 'F-16138071']);
  });

  test('declarations across multiple comment lines union their ids', () => {
    wdoc('docs/note.md', '<!-- clad-doc-links: F-16138071 -->\nprose\n<!-- clad-doc-links: F-06dfdad6, F-7794a6bc -->');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/note.md'].features).toEqual(['F-06dfdad6', 'F-16138071', 'F-7794a6bc']);
  });

  test('a clad-doc-links declaration inside a code fence is inert', () => {
    wdoc('docs/note.md', 'How to declare a link:\n```\n<!-- clad-doc-links: F-16138071 -->\n```\nNo binding here.');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/note.md'].features).toEqual([]);
  });

  test('ids on a clad-doc-links: ignore line bind nothing', () => {
    wdoc('docs/note.md', '<!-- clad-doc-links: ignore - F-abc123 is only an illustrative example -->\n\nTeaching doc.');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/note.md'].features).toEqual([]);
    expect(m['docs/note.md'].features).not.toContain('F-abc123');
  });

  test('renderDocLinksYaml materializes declared ids into spec/_doc-links.yaml', () => {
    mkdirSync(join(dir, 'spec'), {recursive: true});
    wdoc('docs/note.md', '<!-- clad-doc-links: F-16138071, F-06dfdad6 -->\nEvidence with no prose id.');
    const rendered = renderDocLinksYaml(dir);
    expect(rendered).not.toBeNull();
    writeFileSync(join(dir, 'spec', '_doc-links.yaml'), rendered!);
    const yaml = readFileSync(join(dir, 'spec', '_doc-links.yaml'), 'utf8');
    expect(yaml).toContain('"docs/note.md"');
    expect(yaml).toContain('F-16138071');
    expect(yaml).toContain('F-06dfdad6');
  });
});

describe('doc declarations · five A/B case docs bound in the real repo (AC-91d9d1a5)', () => {
  test('the base corpus still projects byte-identically to the committed legacy index', () => {
    expect(renderDocLinksYaml(repoRoot)).toBe(readFileSync(join(repoRoot, 'spec', '_doc-links.yaml'), 'utf8'));
  });

  test('each of the five A/B case docs binds every id it declares, all resolving to real features', () => {
    const known = new Set(loadSpec(repoRoot).features.map((f) => f.id));
    const rows = byDoc(extractDocReferences(repoRoot));
    for (const doc of CASE_DOCS) {
      const declared = declaredIdsOf(join(repoRoot, doc));
      expect(declared.length, `${doc} must carry a declaration`).toBeGreaterThan(0);
      const row = rows[doc];
      expect(row, `${doc} must appear as a bound doc node, not an orphan`).toBeDefined();
      for (const id of declared) {
        expect(row.features, `${doc} must bind ${id}`).toContain(id);
        expect(known.has(id), `${doc} declares ${id}, which must resolve to a real feature`).toBe(true);
      }
    }
  });

  test('case-efficiency-measurement.md binds F-16138071 (the README efficiency receipt)', () => {
    const row = byDoc(extractDocReferences(repoRoot))['docs/ab-evaluation/case-efficiency-measurement.md'];
    expect(row).toBeDefined();
    expect(row.features).toContain('F-16138071');
  });

  test('every extracted excluded-dir doc carries an explicit declaration (no organic-id leakage)', () => {
    const excluded = extractDocReferences(repoRoot).docs.filter((d) => isExcluded(d.doc));
    expect(excluded.length, 'the five case docs make the bound excluded set non-empty').toBeGreaterThanOrEqual(5);
    for (const d of excluded) {
      expect(declaredIdsOf(join(repoRoot, d.doc)), `${d.doc} was emitted, so it must declare ids`).not.toEqual([]);
      expect(d.features.length, `${d.doc} must bind its declared ids`).toBeGreaterThan(0);
      expect(d.doc_links, `${d.doc} in an excluded dir contributes no doc→doc links`).toEqual([]);
    }
    const boundExcluded = new Set(excluded.map((d) => d.doc));
    for (const doc of CASE_DOCS) {
      expect(boundExcluded.has(doc), `${doc} must be among the bound excluded docs`).toBe(true);
    }
  });
});

describe('doc declarations · marker-less byte-identity (AC-437fb005)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-docdecl-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  const wdoc = (rel: string, body: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, body);
  };

  test('an excluded-dir doc with organic ids and a link but no declaration is absent', () => {
    wdoc('docs/ab-evaluation/organic.md', 'Findings mention F-ee47fc2b and F-7794a6bc. See [ref](./other.md).');
    wdoc('docs/ab-evaluation/other.md', '# other');
    wdoc('docs/dogfood/note.md', 'benchmark F-06dfdad6');
    const m = byDoc(extractDocReferences(dir));
    // Excluded-without-declaration (and excluded-with-organic-ids-only) stay out
    // of the index — byte-identical to the pre-declaration behaviour.
    expect(m['docs/ab-evaluation/organic.md']).toBeUndefined();
    expect(m['docs/dogfood/note.md']).toBeUndefined();
  });

  test('a normal doc without a declaration extracts organic ids and links unchanged', () => {
    wdoc('docs/guide.md', 'covers F-ee47fc2b and F-7794a6bc. [see](./ref.md). inline `F-cafef00d` stays out.');
    wdoc('docs/ref.md', '# ref');
    const m = byDoc(extractDocReferences(dir));
    expect(m['docs/guide.md'].features).toEqual(['F-7794a6bc', 'F-ee47fc2b']);
    expect(m['docs/guide.md'].doc_links).toEqual(['docs/ref.md']);
  });
});

describe('doc declarations · DOC_LINK_INTEGRITY stays green (AC-2ee28415)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-docdecl-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  const wdoc = (rel: string, body: string): void => {
    const full = join(dir, rel);
    mkdirSync(dirname(full), {recursive: true});
    writeFileSync(full, body);
  };

  test('DOC_LINK_INTEGRITY reports zero findings referencing the five A/B case docs (real repo)', () => {
    const findings = docReferenceIntegrity
      .run({cwd: repoRoot})
      .filter((f) => f.detector === 'DOC_LINK_INTEGRITY');
    const caseSet = new Set(CASE_DOCS);
    const offending = findings.filter(
      (f) => (f.path !== undefined && caseSet.has(f.path)) || CASE_DOCS.some((d) => f.message.includes(d)),
    );
    expect(offending).toEqual([]);
  });

  test('DOC_LINK_INTEGRITY warns on an unresolved declared id and stays silent when it resolves', () => {
    writeFileSync(join(dir, 'spec.yaml'), SPEC);
    wdoc('docs/ab-evaluation/bogus.md', '<!-- clad-doc-links: F-deadbeef -->\nno prose id');
    wdoc('docs/ab-evaluation/good.md', '<!-- clad-doc-links: F-001 -->\nno prose id');
    const findings = docReferenceIntegrity
      .run({cwd: dir})
      .filter((f) => f.detector === 'DOC_LINK_INTEGRITY');
    // Positive control: the detector really does validate declared ids in an
    // excluded dir, so the real-repo green above is a genuine pass.
    expect(
      findings.some(
        (f) => f.severity === 'warn' && f.path === 'docs/ab-evaluation/bogus.md' && f.message.includes('F-deadbeef'),
      ),
    ).toBe(true);
    expect(findings.some((f) => f.path === 'docs/ab-evaluation/good.md')).toBe(false);
  });
});
