// Cladding · integration test — multi-developer concurrent feature creation
// (v0.3.11, F-086).
//
// Closes the verification loop for the v0.3.9 → v0.3.10 multi-dev safety
// design. Two simulated developers each invoke createFeature in their own
// working tree; the two output trees are then "merged" by copying both
// resulting yaml files into a single spec/features/ directory; the loaded
// spec is run through the relevant detectors and the expected outcome
// asserted.
//
// Why simulate two cwds instead of using actual `git worktree`:
//   - The git CLI isn't a hard prerequisite for `npm test`.
//   - The invariant under test is purely about createFeature's file-naming
//     output (does it produce path-unique files for same-slug concurrent
//     invocations) and the detectors' verdicts on the merged result.
//   - git worktree adds setup latency without exercising a different code
//     path; the two-cwd simulation hits the same surface.

import {copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {createFeature} from '../../src/spec/new.js';
import {slugConflict} from '../../src/stages/detectors/slug-conflict.js';
import {idCollision} from '../../src/stages/detectors/id-collision.js';

function writeMaster(dir: string): void {
  mkdirSync(dir, {recursive: true});
  writeFileSync(
    join(dir, 'spec.yaml'),
    'schema: "0.1"\nproject:\n  name: probe\n  language: typescript\n',
  );
}

/**
 * Copies every yaml file from one cwd's spec/features/ into another's,
 * simulating a `git merge` of the two branches. Two-branch git merge of
 * additive file-creation commits with non-overlapping paths produces
 * exactly this result.
 */
function simulateMerge(fromDir: string, toDir: string): void {
  const src = join(fromDir, 'spec', 'features');
  const dst = join(toDir, 'spec', 'features');
  mkdirSync(dst, {recursive: true});
  for (const f of readdirSync(src)) {
    if (!f.endsWith('.yaml')) continue;
    copyFileSync(join(src, f), join(dst, f));
  }
}

describe('multi-dev concurrent createFeature merge simulation (F-086)', () => {
  let aliceCwd: string;
  let bobCwd: string;
  let mergedCwd: string;
  beforeEach(() => {
    aliceCwd = mkdtempSync(join(tmpdir(), 'clad-alice-'));
    bobCwd = mkdtempSync(join(tmpdir(), 'clad-bob-'));
    mergedCwd = mkdtempSync(join(tmpdir(), 'clad-merged-'));
    writeMaster(aliceCwd);
    writeMaster(bobCwd);
    writeMaster(mergedCwd);
  });
  afterEach(() => {
    rmSync(aliceCwd, {recursive: true, force: true});
    rmSync(bobCwd, {recursive: true, force: true});
    rmSync(mergedCwd, {recursive: true, force: true});
  });

  test('different slugs → distinct file paths, merge clean, no SLUG_CONFLICT', () => {
    const aliceResult = createFeature({slug: 'login-flow', cwd: aliceCwd});
    const bobResult = createFeature({slug: 'checkout-cart', cwd: bobCwd});

    // Different slugs → different filename prefixes → no path overlap.
    expect(aliceResult.path).not.toBe(bobResult.path);
    expect(aliceResult.id).not.toBe(bobResult.id);

    // Simulate a merge — both files land in the merged tree.
    simulateMerge(aliceCwd, mergedCwd);
    simulateMerge(bobCwd, mergedCwd);
    const merged = readdirSync(join(mergedCwd, 'spec', 'features'));
    expect(merged).toContain(`login-flow-${aliceResult.id.slice(2)}.yaml`);
    expect(merged).toContain(`checkout-cart-${bobResult.id.slice(2)}.yaml`);

    // Drift detectors stay silent — no slug or id duplicate.
    expect(slugConflict.run({cwd: mergedCwd})).toEqual([]);
    expect(idCollision.run({cwd: mergedCwd})).toEqual([]);
  });

  test('[covers:F-59f093/AC-001][covers:F-59f093/AC-002] same slug on two cwds → distinct file paths (hash entropy), merge clean at file level, SLUG_CONFLICT raises on the merged result', () => {
    const aliceResult = createFeature({slug: 'auth-bypass', cwd: aliceCwd});
    const bobResult = createFeature({slug: 'auth-bypass', cwd: bobCwd});

    // Same slug, different hashes → different file paths. This is the
    // distributed safety property — file-level merge collision is zero.
    expect(aliceResult.slug).toBe('auth-bypass');
    expect(bobResult.slug).toBe('auth-bypass');
    expect(aliceResult.id).not.toBe(bobResult.id);
    expect(aliceResult.path).not.toBe(bobResult.path);

    simulateMerge(aliceCwd, mergedCwd);
    simulateMerge(bobCwd, mergedCwd);
    const merged = readdirSync(join(mergedCwd, 'spec', 'features'));
    // Both auth-bypass-* files coexist in the merged tree.
    expect(merged.filter((f) => f.startsWith('auth-bypass-'))).toHaveLength(2);

    // ID_COLLISION stays silent — different hashes.
    expect(idCollision.run({cwd: mergedCwd})).toEqual([]);
    // SLUG_CONFLICT raises — two features in the merged spec share 'auth-bypass'.
    // Human resolution required (archive one or rename one slug).
    const slugFindings = slugConflict.run({cwd: mergedCwd});
    expect(slugFindings).toHaveLength(1);
    expect(slugFindings[0].severity).toBe('error');
    expect(slugFindings[0].message).toContain('auth-bypass');
  });

  test('same cwd repeat call → distinct file paths (no auto-suffix needed)', () => {
    // The same developer calling createFeature twice with the same slug
    // — usually a mistake — produces two files because the hash entropy
    // includes hrtime. The SLUG_CONFLICT detector catches the duplicate
    // intent on the next `clad check --strict`.
    const r1 = createFeature({slug: 'feature-twice', cwd: aliceCwd});
    const r2 = createFeature({slug: 'feature-twice', cwd: aliceCwd});

    expect(r1.path).not.toBe(r2.path);
    expect(r1.id).not.toBe(r2.id);

    // Both files exist in alice's tree directly — no merge needed.
    const filesInAlice = readdirSync(join(aliceCwd, 'spec', 'features'));
    expect(filesInAlice.filter((f) => f.startsWith('feature-twice-'))).toHaveLength(2);

    const findings = slugConflict.run({cwd: aliceCwd});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('feature-twice');
  });

  test('three contributors with distinct slugs → three distinct files, merge fully clean', () => {
    const charlieCwd = mkdtempSync(join(tmpdir(), 'clad-charlie-'));
    writeMaster(charlieCwd);
    try {
      const a = createFeature({slug: 'login-flow', cwd: aliceCwd});
      const b = createFeature({slug: 'checkout-cart', cwd: bobCwd});
      const c = createFeature({slug: 'mfa-enroll', cwd: charlieCwd});

      simulateMerge(aliceCwd, mergedCwd);
      simulateMerge(bobCwd, mergedCwd);
      simulateMerge(charlieCwd, mergedCwd);

      const merged = readdirSync(join(mergedCwd, 'spec', 'features'));
      expect(merged.filter((f) => f.endsWith('.yaml'))).toHaveLength(3);

      const ids = new Set([a.id, b.id, c.id]);
      expect(ids.size).toBe(3);

      expect(slugConflict.run({cwd: mergedCwd})).toEqual([]);
      expect(idCollision.run({cwd: mergedCwd})).toEqual([]);
    } finally {
      rmSync(charlieCwd, {recursive: true, force: true});
    }
  });
});
