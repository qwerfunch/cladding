// Cladding · unit tests for spec/parse.ts

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {parseSpec} from '../../src/spec/parse.js';

describe('parseSpec', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-parse-'));
  });

  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('reads valid YAML into a plain object', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'foo: bar\nbaz:\n  - 1\n  - 2\n');
    const result = parseSpec(join(dir, 'spec.yaml')) as {foo: string; baz: number[]};
    expect(result.foo).toBe('bar');
    expect(result.baz).toEqual([1, 2]);
  });

  test('throws on missing file', () => {
    expect(() => parseSpec(join(dir, 'nonexistent.yaml'))).toThrow();
  });

  test('throws on invalid YAML', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'foo: [unclosed\n');
    expect(() => parseSpec(join(dir, 'spec.yaml'))).toThrow();
  });
});
