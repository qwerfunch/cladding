// Cladding · public test-count consistency guard (F-898783ee).

import {describe, expect, test} from 'vitest';

import {checkClaimText, rewriteClaimText} from '../../scripts/test-count.mjs';

const markdown = '<img src="https://img.shields.io/badge/tests-10%2F10-brightgreen" alt="tests"/>\n| release | 10 / 10 | green |\n';
const html = '<img src="https://img.shields.io/badge/tests-10%2F10-brightgreen" alt="tests">\n<div>10<span style="font-size:16px;color:#94a3b8">/10</span></div>\n';

describe('test-count.mjs (F-898783ee)', () => {
  test('accepts matching Markdown and HTML claims', () => {
    expect(() => checkClaimText(markdown, 'markdown', 10)).not.toThrow();
    expect(() => checkClaimText(html, 'html', 10)).not.toThrow();
  });

  test('rejects a stale or partial public claim', () => {
    expect(() => checkClaimText(markdown, 'markdown', 11)).toThrow(/collects 11/);
    expect(() => checkClaimText(markdown.replace('10 / 10', '9 / 10'), 'markdown', 10)).toThrow(/not all-pass/);
  });

  test('rewrites both claims without changing surrounding content', () => {
    const updated = rewriteClaimText(html, 'html', 12);
    expect(updated).toContain('tests-12%2F12-brightgreen');
    expect(updated).toContain('>12<span style="font-size:16px;color:#94a3b8">/12</span>');
    expect(() => checkClaimText(updated, 'html', 12)).not.toThrow();
  });
});
