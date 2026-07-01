import {describe, test, expect, afterEach} from 'vitest';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codeExcerpt, withinCwd, estTokens} from '../../src/optimizer/code-excerpt.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clad-excerpt-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, {recursive: true, force: true});
  }
});

describe('estTokens', () => {
  test('estimates tokens as ceil(length/4)', () => {
    expect(estTokens('abcd')).toBe(1);
    expect(estTokens('')).toBe(0);
    expect(estTokens('a')).toBe(1);
    expect(estTokens('abcde')).toBe(2);
  });
});

describe('code-excerpt', () => {
  test('reads a code file clipped to the budget with a truncation marker', () => {
    const dir = makeTmp();

    // Long file: 5000 chars of valid-ish TS content.
    const longName = 'long.ts';
    const longText = 'const x = 1;\n'.repeat(0) + 'a'.repeat(5000);
    writeFileSync(join(dir, longName), longText, 'utf8');

    const clipped = codeExcerpt(longName, dir, 400);
    expect(clipped.path).toBe(longName);
    expect(clipped.truncated).toBe(true);
    expect(typeof clipped.text).toBe('string');
    expect(clipped.text!.length).toBeLessThanOrEqual(400);
    expect(clipped.text!.includes('clipped')).toBe(true);
    expect(clipped.omitted).toBeUndefined();

    // Short file: returned in full, untruncated.
    const shortName = 'short.ts';
    const shortText = 'export const hello = "world";\n';
    writeFileSync(join(dir, shortName), shortText, 'utf8');

    const full = codeExcerpt(shortName, dir, 400);
    expect(full.path).toBe(shortName);
    expect(full.text).toBe(shortText);
    expect(full.truncated).toBeUndefined();
    expect(full.omitted).toBeUndefined();
  });

  test('rejects path traversal and non-whitelisted/binary/missing files safely', () => {
    const dir = makeTmp();

    // withinCwd contract.
    expect(withinCwd('../x', dir)).toBe(false);
    expect(withinCwd('safe.ts', dir)).toBe(true);

    // Path traversal -> unsafe-path, never throws, no text.
    const traversal = (() => codeExcerpt('../../etc/passwd', dir, 1000))();
    expect(traversal.omitted).toBe('unsafe-path');
    expect(traversal.text).toBeUndefined();

    // Absolute path outside cwd -> unsafe-path.
    const abs = (() => codeExcerpt('/etc/hosts', dir, 1000))();
    expect(abs.omitted).toBe('unsafe-path');
    expect(abs.text).toBeUndefined();

    // Non-whitelisted extension: write the file so EXTENSION (not missing) triggers it.
    const exeName = 'thing.exe';
    writeFileSync(join(dir, exeName), 'data', 'utf8');
    const exe = codeExcerpt(exeName, dir, 1000);
    expect(exe.omitted).toBe('unsupported');
    expect(exe.text).toBeUndefined();

    // Missing whitelisted file -> missing.
    const missing = codeExcerpt('gone.ts', dir, 1000);
    expect(missing.omitted).toBe('missing');
    expect(missing.text).toBeUndefined();

    // Binary file (contains NUL byte) -> binary.
    const binName = 'bin.ts';
    writeFileSync(join(dir, binName), 'abc' + String.fromCharCode(0) + 'def', 'utf8');
    const bin = codeExcerpt(binName, dir, 1000);
    expect(bin.omitted).toBe('binary');
    expect(bin.text).toBeUndefined();
  });
});
