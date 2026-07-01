import {docReferenceIntegrity} from '../../../src/stages/detectors/doc-reference-integrity.js';
import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

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

  test('a dead relative .md link is an error', () => {
    writeSpec();
    wdoc('docs/b.md', '# b');
    wdoc('docs/a.md', '[gone](./missing.md) [ok](./b.md)');

    const fs = run();

    expect(fs.some((f) => f.severity === 'error' && f.message.includes('missing.md'))).toBe(true);
    expect(fs.some((f) => f.severity === 'error' && f.message.includes('b.md') && !f.message.includes('missing.md'))).toBe(false);
  });

  test('an unresolved F-id in a normal doc is a warn', () => {
    writeSpec();
    wdoc('docs/a.md', 'mentions F-deadbeef and F-001');

    const fs = run();

    expect(fs.some((f) => f.severity === 'warn' && f.message.includes('F-deadbeef'))).toBe(true);
    expect(fs.some((f) => f.message.includes('F-001'))).toBe(false);
  });
});
