// Cladding · public test-count consistency guard (F-898783ee).

import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {CLAIM_SITES, runTestCount} from '../../scripts/test-count.mjs';

const markdown = '<img src="https://img.shields.io/badge/tests-10%2F10-brightgreen" alt="tests"/>\n| release | 10 / 10 | green |\n<sub>10 test files</sub>\n';
const html = '<img src="https://img.shields.io/badge/tests-10%2F10-brightgreen" alt="tests">\n<div>10<span style="font-size:16px;color:#94a3b8">/10</span></div>\n<p>10 test files</p>\n';

describe('test-count.mjs (F-898783ee)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'clad-test-count-'));
    for (const site of CLAIM_SITES) {
      writeFileSync(join(root, site.file), site.kind === 'html' ? html : markdown, 'utf8');
    }
    writeFileSync(join(root, 'spec.yaml'), 'inventory:\n  test_files: 10\n', 'utf8');
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  test('[covers:F-898783ee/AC-8ded2bb9] check identifies the mismatching README surface and collected total', () => {
    expect(() => runTestCount('--check', {root, collected: 11, testFiles: 11})).toThrow('README.md: claims 10 tests; Vitest collects 11');
  });

  test('[covers:F-898783ee/AC-8ded2bb9] checks every README test-file claim and the root inventory against Vitest files', () => {
    expect(() => runTestCount('--check', {root, collected: 10, testFiles: 11})).toThrow('README.md: claims 10 test files; Vitest collects 11');
    for (const site of CLAIM_SITES) {
      writeFileSync(join(root, site.file), (site.kind === 'html' ? html : markdown).replace('10 test files', '11 test files'), 'utf8');
    }
    expect(() => runTestCount('--check', {root, collected: 10, testFiles: 11})).toThrow('spec.yaml: inventory.test_files is 10; Vitest collects 11');
  });

  test('[covers:F-898783ee/AC-533f2108] write mode updates every registered README surface after complete preflight', () => {
    expect(CLAIM_SITES.map((site) => site.file)).toEqual([
      'README.md',
      'README.ko.md',
      'README.ja.md',
      'README.zh.md',
      'README.html',
      'README.ko.html',
    ]);

    expect(runTestCount('--write', {root, collected: 12, testFiles: 12})).toBe(12);
    for (const site of CLAIM_SITES) {
      const body = readFileSync(join(root, site.file), 'utf8');
      expect(body).toContain('tests-12%2F12-brightgreen');
      expect(body).toContain(site.kind === 'html' ? '>/12</span>' : '12 / 12');
      expect(body).toContain('12 test files');
    }
    expect(readFileSync(join(root, 'spec.yaml'), 'utf8')).toContain('test_files: 12');
  });

  test('[covers:F-898783ee/AC-5bf471be] malformed preflight leaves every registered README surface byte-identical', () => {
    writeFileSync(join(root, 'README.ja.md'), markdown.replace('10 / 10', '9 / 10'), 'utf8');
    const before = new Map(CLAIM_SITES.map((site) => [site.file, readFileSync(join(root, site.file), 'utf8')]));

    expect(() => runTestCount('--write', {root, collected: 12, testFiles: 12})).toThrow('README.ja.md: refusing to rewrite malformed or partial test-count claims');

    for (const site of CLAIM_SITES) {
      expect(readFileSync(join(root, site.file), 'utf8')).toBe(before.get(site.file));
    }
  });
});
