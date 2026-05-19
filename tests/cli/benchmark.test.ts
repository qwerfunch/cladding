// Cladding · unit tests for cli/benchmark.ts
//
// `clad benchmark <F-id>` measures the spec context that would be
// sent to an LLM in two modes — full spec.yaml vs the pruned
// per-feature payload. The output ratio is what the README's
// 87.9%-reduction figure cites; this suite pins the helper math.
//
// Functions under test:
//   - approxTokens(text)         — char/4 heuristic
//   - benchmark(cwd, featureId)  — loads spec + prunes + returns ratio
//
// Branches covered: small spec with no deps (low reduction), spec with
// many unrelated features (high reduction), token-count rounding.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {approxTokens, benchmark} from '../../cli/benchmark.js';

function writeSpec(dir: string, body: string): void {
  writeFileSync(join(dir, 'spec.yaml'), body);
}

describe('approxTokens', () => {
  test('empty string → 0', () => {
    expect(approxTokens('')).toBe(0);
  });

  test('four chars → 1 token', () => {
    expect(approxTokens('abcd')).toBe(1);
  });

  test('partial chunks round up (ceil heuristic)', () => {
    expect(approxTokens('a')).toBe(1);
    expect(approxTokens('abc')).toBe(1);
    expect(approxTokens('abcde')).toBe(2);
  });

  test('long string roughly tracks bytes / 4', () => {
    const text = 'x'.repeat(400);
    expect(approxTokens(text)).toBe(100);
  });
});

describe('benchmark', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-benchmark-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('single-feature spec → low or zero reduction', () => {
    writeSpec(
      dir,
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n' +
        '  - id: F-001\n' +
        '    title: only\n' +
        '    status: done\n',
    );
    const r = benchmark(dir, 'F-001');
    expect(r.featureId).toBe('F-001');
    expect(r.naiveBytes).toBeGreaterThan(0);
    expect(r.optimizedBytes).toBeGreaterThan(0);
    expect(r.naiveTokens).toBe(Math.ceil(r.naiveBytes / 4));
    expect(r.optimizedTokens).toBe(Math.ceil(r.optimizedBytes / 4));
  });

  test('multi-feature spec → meaningful reduction when targeting one', () => {
    // Build a spec with 10 features. Pruning to F-001 with no deps
    // should drop the other 9 → big reduction.
    const lines: string[] = [
      'schema: "0.1"',
      'project: {name: x, language: typescript}',
      'features:',
    ];
    for (let i = 1; i <= 10; i += 1) {
      const id = `F-${String(i).padStart(3, '0')}`;
      lines.push(`  - id: ${id}`);
      lines.push(`    title: feature ${i}`);
      lines.push('    status: done');
      lines.push('    acceptance_criteria:');
      lines.push('      - id: AC-001');
      lines.push('        ears: ubiquitous');
      lines.push(`        text: "Feature ${i} has detailed description text to enlarge the spec body."`);
    }
    writeSpec(dir, lines.join('\n') + '\n');
    const r = benchmark(dir, 'F-001');
    expect(r.naiveBytes).toBeGreaterThan(r.optimizedBytes);
    expect(r.reductionPercent).toBeGreaterThan(0);
  });

  test('sharded spec is loaded transparently', () => {
    writeSpec(
      dir,
      'schema: "0.1"\n' + 'project: {name: x, language: typescript}\n' + 'features: []\n',
    );
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    writeFileSync(
      join(dir, 'spec', 'features', 'F-001.yaml'),
      'id: F-001\ntitle: t\nstatus: done\n',
    );
    const r = benchmark(dir, 'F-001');
    expect(r.featureId).toBe('F-001');
    expect(r.naiveBytes).toBeGreaterThan(0);
  });

  test('reductionPercent formula: (naive - optimized) / naive * 100', () => {
    writeSpec(
      dir,
      'schema: "0.1"\n' +
        'project: {name: x, language: typescript}\n' +
        'features:\n' +
        '  - id: F-001\n' +
        '    title: t\n' +
        '    status: done\n',
    );
    const r = benchmark(dir, 'F-001');
    const expected = ((r.naiveBytes - r.optimizedBytes) / r.naiveBytes) * 100;
    expect(r.reductionPercent).toBeCloseTo(expected, 6);
  });
});
