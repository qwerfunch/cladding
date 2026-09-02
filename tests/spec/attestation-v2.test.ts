// Cladding · F-b0f898a6 — attestation v2 (per-module hashes + constant feature
// markers, merge-friendly encoding). Authored from the shard ACs alone
// (anti-self-cert: the implementer's diff was not read).
//
//   AC-35f55851  v2 write format — two sorted sections, LF, shared module once,
//                byte-identical rewrite, one-line-per-changed-module surface.
//   AC-458c0035  dual reader — v1 verdicts preserved, v2-wins on a Frankenstein,
//                no-manual-step crossover to pure v2 on the next GREEN write.
//   AC-ec3d293e  v2 staleness — marker+hashes ⇒ fresh, drift names the module,
//                no marker ⇒ never-attested, duplicate lines last-win.
//   AC-d6e6f792  .gitattributes pin — attestation carries no merge driver.

import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  featureAttestation,
  moduleFileHash,
  moduleTreeHash,
  readAttestation,
  writeAttestation,
} from '../../src/spec/attestation.js';
import type {Feature, Spec} from '../../src/spec/types.js';

const ATT = ['spec', 'attestation.yaml'] as const;

function feat(id: string, modules: string[]): Feature {
  return {id, title: id, status: 'done', modules};
}

function specOf(features: Feature[]): Spec {
  return {schema: '0.1', project: {name: 'x', language: 'typescript'}, features};
}

/** Legacy in-memory fixtures now materialize the root that selects schema 0.1. */
function stamp(dir: string, spec: Spec): boolean {
  writeFileSync(join(dir, 'spec.yaml'), JSON.stringify(spec, null, 2));
  return writeAttestation(dir, spec);
}

function readText(dir: string): string {
  return readFileSync(join(dir, ...ATT), 'utf8');
}

/** Section-line accessors over the raw file. */
function moduleSectionLines(text: string): string[] {
  const lines = text.split('\n');
  const m = lines.indexOf('attested_modules:');
  const f = lines.indexOf('attested_features:');
  return lines.slice(m + 1, f).filter((l) => l.startsWith('  '));
}
function featureSectionLines(text: string): string[] {
  const lines = text.split('\n');
  const f = lines.indexOf('attested_features:');
  return lines.slice(f + 1).filter((l) => l.startsWith('  '));
}

/** Line-level multiset diff — the lines present on exactly one side. For a
 * single hash rewrite this is one removed + one added line at the same key,
 * i.e. a unified diff's `-`/`+` pair for one modified line. */
function lineDelta(before: string, after: string): {removed: string[]; added: string[]} {
  const count = (s: string): Map<string, number> => {
    const c = new Map<string, number>();
    for (const l of s.split('\n')) c.set(l, (c.get(l) ?? 0) + 1);
    return c;
  };
  const b = count(before);
  const a = count(after);
  const removed: string[] = [];
  const added: string[] = [];
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) removed.push(l);
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) added.push(l);
  return {removed, added};
}

// ─────────────────────────────────────────────────────────────────────────────
describe('attestation v2 write format (F-b0f898a6 · AC-35f55851)', () => {
  let dir: string;
  // Two done features sharing src/shared.ts, each owning a private module.
  const fA = feat('F-aaaa1111', ['src/shared.ts', 'src/priv-a.ts']);
  const fB = feat('F-bbbb2222', ['src/shared.ts', 'src/priv-b.ts']);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-attv2-'));
    mkdirSync(join(dir, 'src'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(join(dir, 'src', 'shared.ts'), 'export const shared = 1;\n');
    writeFileSync(join(dir, 'src', 'priv-a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'priv-b.ts'), 'export const b = 1;\n');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-b0f898a6/AC-35f55851] emits two sorted sections in order (modules then features), LF-terminated, shared module once, constant ok markers', () => {
    expect(stamp(dir, specOf([fA, fB]))).toBe(true);
    const text = readText(dir);
    const lines = text.split('\n');

    // Two sections, modules strictly before features.
    const modIdx = lines.indexOf('attested_modules:');
    const featIdx = lines.indexOf('attested_features:');
    expect(modIdx).toBeGreaterThanOrEqual(0);
    expect(featIdx).toBeGreaterThan(modIdx);

    // LF only, file ends with a newline.
    expect(text.includes('\r')).toBe(false);
    expect(text.endsWith('\n')).toBe(true);

    const moduleLines = moduleSectionLines(text);
    const featureLines = featureSectionLines(text);

    // Both sections sorted.
    expect(moduleLines).toEqual([...moduleLines].sort());
    expect(featureLines).toEqual([...featureLines].sort());

    // Union of both features' modules = 3 distinct files; the SHARED one once.
    expect(moduleLines).toHaveLength(3);
    expect(moduleLines.filter((l) => l.startsWith('  src/shared.ts:'))).toHaveLength(1);
    for (const l of moduleLines) expect(l).toMatch(/^ {2}\S+: [0-9a-f]{16}$/);

    // Feature markers are the constant token `ok` (no per-feature hash).
    expect(featureLines).toHaveLength(2);
    for (const l of featureLines) expect(l).toMatch(/^ {2}F-[\w-]+: ok$/);
    expect(featureLines).toEqual(['  F-aaaa1111: ok', '  F-bbbb2222: ok']);
  });

  test('[covers:F-b0f898a6/AC-35f55851] rewrites byte-identically when the module tree is unchanged', () => {
    stamp(dir, specOf([fA, fB]));
    const first = readText(dir);
    stamp(dir, specOf([fA, fB]));
    const second = readText(dir);
    expect(second).toBe(first);
  });

  test('[covers:F-b0f898a6/AC-35f55851] editing one shared module file changes exactly one module line and zero feature-marker lines', () => {
    stamp(dir, specOf([fA, fB]));
    const before = readText(dir);

    // v1 contrast, captured pre-edit: the per-feature tree-hash of BOTH
    // co-owners is a function of shared.ts, so v1 would rewrite two lines.
    const treeA0 = moduleTreeHash(dir, fA.modules ?? []);
    const treeB0 = moduleTreeHash(dir, fB.modules ?? []);

    // Edit ONLY the shared file.
    writeFileSync(join(dir, 'src', 'shared.ts'), 'export const shared = 2; // changed\n');
    stamp(dir, specOf([fA, fB]));
    const after = readText(dir);

    // No lines inserted or removed — same line count.
    expect(after.split('\n').length).toBe(before.split('\n').length);

    // Exactly one line changed, and it is the shared module's line.
    const {removed, added} = lineDelta(before, after);
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0]).toMatch(/^ {2}src\/shared\.ts: [0-9a-f]{16}$/);
    expect(added[0]).toMatch(/^ {2}src\/shared\.ts: [0-9a-f]{16}$/);
    expect(removed[0]).not.toBe(added[0]);

    // ZERO feature-marker lines moved — the whole point of the v2 split.
    expect([...removed, ...added].filter((l) => /: ok$/.test(l))).toHaveLength(0);
    // The private-module lines are untouched.
    expect([...removed, ...added].some((l) => l.includes('priv-'))).toBe(false);

    // Contrast holds: v1's per-feature hashes for BOTH co-owners moved.
    expect(moduleTreeHash(dir, fA.modules ?? [])).not.toBe(treeA0);
    expect(moduleTreeHash(dir, fB.modules ?? [])).not.toBe(treeB0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('attestation dual reader + adopter transition (F-b0f898a6 · AC-458c0035)', () => {
  let dir: string;
  const F = feat('F-c0ffee11', ['src/m.ts']);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-attv1-'));
    mkdirSync(join(dir, 'src'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(join(dir, 'src', 'm.ts'), 'export const m = 1;\n');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  function writeV1(entries: Record<string, string>): void {
    const body =
      'attested:\n' +
      Object.entries(entries)
        .map(([id, h]) => `  ${id}: ${h}`)
        .join('\n') +
      '\n';
    writeFileSync(join(dir, ...ATT), body, 'utf8');
  }

  test('[covers:F-b0f898a6/AC-458c0035] reads a v1 file and preserves its verdicts: matching tree-hash fresh, mismatch stale, absent entry unattested', () => {
    // A real v1 record: feature id → tree-hash over all its module bytes.
    const tree = moduleTreeHash(dir, F.modules ?? []);
    writeV1({[F.id]: tree});

    const att = readAttestation(dir);
    expect(att).not.toBeNull();
    expect(att!.v1?.get(F.id)).toBe(tree); // v1 section parsed
    expect(att!.modules).toBeNull(); // no v2 sections present
    expect(att!.features).toBeNull();
    expect(featureAttestation(att!, dir, F)).toEqual({state: 'fresh'});

    // Mismatch: a stale tree-hash → stale, with NO per-module resolution.
    writeV1({[F.id]: '0'.repeat(16)});
    expect(featureAttestation(readAttestation(dir)!, dir, F)).toEqual({state: 'stale'});

    // Absent entry: the file records a different feature → unattested.
    writeV1({'F-deadbeef': moduleTreeHash(dir, [])});
    expect(featureAttestation(readAttestation(dir)!, dir, F)).toEqual({state: 'unattested'});
  });

  test('[covers:F-b0f898a6/AC-458c0035] a Frankenstein file with a stale v1 hash but fresh v2 sections resolves v2-wins (fresh)', () => {
    const body =
      'attested:\n' +
      `  ${F.id}: ${'0'.repeat(16)}\n` + // stale v1 hash
      'attested_modules:\n' +
      `  src/m.ts: ${moduleFileHash(dir, 'src/m.ts')}\n` + // fresh v2 hash
      'attested_features:\n' +
      `  ${F.id}: ok\n`;
    writeFileSync(join(dir, ...ATT), body, 'utf8');

    const att = readAttestation(dir);
    // All three sections present (the union-merge shape).
    expect(att!.v1?.get(F.id)).toBe('0'.repeat(16));
    expect(att!.modules?.get('src/m.ts')).toBe(moduleFileHash(dir, 'src/m.ts'));
    expect(att!.features?.has(F.id)).toBe(true);
    // v2 wins: fresh, despite the stale v1 hash.
    expect(featureAttestation(att!, dir, F)).toEqual({state: 'fresh'});
  });

  test('[covers:F-b0f898a6/AC-458c0035] a GREEN write crosses a v1 file over to pure v2 with no manual step', () => {
    writeV1({[F.id]: moduleTreeHash(dir, F.modules ?? [])});
    expect(readAttestation(dir)!.v1).not.toBeNull(); // starts as v1

    // The next GREEN gate simply writes — no migration command.
    expect(stamp(dir, specOf([F]))).toBe(true);

    const text = readText(dir);
    expect(text.split('\n').includes('attested:')).toBe(false); // v1 section gone
    const att = readAttestation(dir);
    expect(att!.v1).toBeNull(); // pure v2 now
    expect(att!.modules?.get('src/m.ts')).toBeDefined();
    expect(att!.features?.has(F.id)).toBe(true);
    expect(featureAttestation(att!, dir, F)).toEqual({state: 'fresh'});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('attestation v2 staleness (F-b0f898a6 · AC-ec3d293e)', () => {
  let dir: string;
  const F = feat('F-abcd1234', ['src/a.ts', 'src/b.ts']);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-attstale-'));
    mkdirSync(join(dir, 'src'), {recursive: true});
    mkdirSync(join(dir, 'spec'), {recursive: true});
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 1;\n');
  });
  afterEach(() => rmSync(dir, {recursive: true, force: true}));

  test('[covers:F-b0f898a6/AC-ec3d293e] fresh only when the marker is present and every module hash matches', () => {
    stamp(dir, specOf([F]));
    expect(featureAttestation(readAttestation(dir)!, dir, F)).toEqual({state: 'fresh'});
  });

  test('[covers:F-b0f898a6/AC-ec3d293e] a byte-edited module is stale and the verdict names that module', () => {
    stamp(dir, specOf([F]));
    // Edit only src/b.ts; src/a.ts still matches, so the FIRST drift is b.
    writeFileSync(join(dir, 'src', 'b.ts'), 'export const b = 2; // changed\n');
    expect(featureAttestation(readAttestation(dir)!, dir, F)).toEqual({
      state: 'stale',
      module: 'src/b.ts',
    });
  });

  test('[covers:F-b0f898a6/AC-ec3d293e] a done feature with modules but no marker is never-attested', () => {
    // Attest ONLY feature F; a hand-flipped done feature G is not in the file.
    stamp(dir, specOf([F]));
    writeFileSync(join(dir, 'src', 'g.ts'), 'export const g = 1;\n');
    const G = feat('F-99998888', ['src/g.ts']);
    expect(featureAttestation(readAttestation(dir)!, dir, G)).toEqual({state: 'unattested'});
  });

  test('[covers:F-b0f898a6/AC-ec3d293e] a v2 file with duplicate module lines does not crash and the last line wins', () => {
    const body =
      'attested_modules:\n' +
      '  src/a.ts: aaaaaaaaaaaaaaaa\n' +
      '  src/a.ts: bbbbbbbbbbbbbbbb\n' + // duplicate key, later value
      'attested_features:\n' +
      '  F-abcd1234: ok\n';
    writeFileSync(join(dir, ...ATT), body, 'utf8');
    const att = readAttestation(dir);
    expect(att).not.toBeNull();
    expect(att!.modules?.get('src/a.ts')).toBe('bbbbbbbbbbbbbbbb'); // last wins
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('.gitattributes merge-driver pin (F-b0f898a6 · AC-d6e6f792)', () => {
  const gitattributesPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '.gitattributes',
  );

  test('[covers:F-b0f898a6/AC-d6e6f792] spec/attestation.yaml has no merge driver while spec/index.yaml keeps merge=union', () => {
    const text = readFileSync(gitattributesPath, 'utf8');
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));

    // index.yaml keeps the union driver.
    expect(lines).toContain('spec/index.yaml merge=union');

    // The ONLY line carrying a merge driver is index.yaml. This fails if
    // someone re-adds `spec/attestation.yaml merge=union` OR sweeps it in via a
    // glob (`spec/*.yaml merge=union`, `*.yaml merge=union`, …).
    const mergeLines = lines.filter((l) => /\bmerge=/.test(l));
    expect(mergeLines).not.toHaveLength(0);
    for (const l of mergeLines) {
      expect(l.split(/\s+/)[0]).toBe('spec/index.yaml');
    }

    // Explicit, readable guard: attestation is never assigned a merge attribute.
    expect(text).not.toMatch(/spec\/attestation\.yaml\b[^\n]*\bmerge/);
  });
});
