// Cladding · unit tests for scripts/build-plugin.mjs Phase D (F-092)
//
// Phase D auto-recomputes `.claude-plugin/plugin.json` detector counts
// from the filesystem. These tests target Phase D in isolation by
// running build-plugin.mjs against a synthetic tree that contains
// only what Phase D touches (src/stages/detectors + plugin.json) plus
// the minimum stubs the earlier phases need to not throw.
//
// Verifies:
//   - current.detectors + target.detectors both rewritten to "N/N"
//   - idempotent (running with sync values produces no diff)
//   - other "detectors" keys outside `current` / `target` are not
//     touched (regex anchored to the field name, not the value shape)

import {execFileSync, type ExecFileSyncOptions} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

const SCRIPT_PATH = join(process.cwd(), 'scripts', 'build-plugin.mjs');
const MIRROR_PERSONAS = ['blind-author', 'developer', 'observability', 'orchestrator', 'planner', 'reviewer'];
const MIRROR_SKILLS = ['changelog', 'check', 'checkpoint', 'clarify', 'doctor', 'init', 'oracle', 'rollback', 'route', 'serve', 'status', 'sync'];

function seedTree(dir: string, detectorCount: number, declaredCurrent: string, declaredTarget: string): void {
  // The mirror policy fails closed on canonical inputs, so this fixture seeds
  // its exact persona/skill manifest rather than relying on old permissive
  // empty directories.
  mkdirSync(join(dir, 'src', 'agents'), {recursive: true});
  mkdirSync(join(dir, 'skills'), {recursive: true});
  mkdirSync(join(dir, 'scripts'), {recursive: true});
  mkdirSync(join(dir, 'src', 'stages', 'detectors'), {recursive: true});
  mkdirSync(join(dir, 'plugins', 'claude-code', '.claude-plugin'), {recursive: true});
  writeFileSync(join(dir, 'src', 'agents', 'README.md'), '# agents\n');
  writeFileSync(join(dir, 'package.json'), '{"name":"build-plugin-fixture"}\n');
  writeFileSync(join(dir, 'scripts', 'plugin-mirror-policy.mjs'), '// policy fixture\n');
  writeFileSync(join(dir, 'scripts', 'build-plugin.mjs'), '// build fixture\n');
  for (const persona of MIRROR_PERSONAS) {
    writeFileSync(join(dir, 'src', 'agents', `${persona}.md`), `---\ndescription: ${persona}\n---\n${persona}\n`);
  }
  for (const skill of MIRROR_SKILLS) {
    const skillDir = join(dir, 'skills', skill);
    mkdirSync(skillDir, {recursive: true});
    writeFileSync(join(skillDir, 'SKILL.md'), `---\ndescription: ${skill}\n---\n${skill}\n`);
  }

  for (let i = 0; i < detectorCount; i++) {
    writeFileSync(join(dir, 'src', 'stages', 'detectors', `det-${i}.ts`), '// stub\n');
  }
  // index.ts must be excluded from the count.
  writeFileSync(join(dir, 'src', 'stages', 'detectors', 'index.ts'), '// barrel\n');

  // Plugin.json with the two anchored fields plus a decoy "detectors"
  // key under a different parent — Phase D must not touch it.
  const manifest = {
    name: 'probe',
    version: '0.0.0',
    ironclad: {
      target: {detectors: declaredTarget},
      current: {detectors: declaredCurrent},
      other: {detectors: '99/99'},
    },
  };
  writeFileSync(
    join(dir, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );
}

function run(cwd: string): string {
  const opts: ExecFileSyncOptions = {cwd, stdio: 'pipe'};
  return execFileSync('node', [SCRIPT_PATH], opts).toString('utf8');
}

describe('scripts/build-plugin.mjs · Phase D detector count', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'build-plugin-test-'));
  });

  afterEach(() => {
    rmSync(tmp, {recursive: true, force: true});
  });

  test('[covers:F-098d3b/AC-001] drift is recomputed to filesystem-truth count', () => {
    seedTree(tmp, 7, '5/5', '5/5');
    const out = run(tmp);
    expect(out).toMatch(/detectors: recomputed → 7\/7/);
    const manifest = JSON.parse(
      readFileSync(join(tmp, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.ironclad.current.detectors).toBe('7/7');
    expect(manifest.ironclad.target.detectors).toBe('7/7');
  });

  test('[covers:F-098d3b/AC-002] idempotent — already-synced manifest produces no rewrite log', () => {
    seedTree(tmp, 4, '4/4', '4/4');
    const out = run(tmp);
    expect(out).toMatch(/detectors: 4\/4 \(already in sync\)/);
  });

  test('[covers:F-098d3b/AC-003] does not touch detector keys under unrelated parents', () => {
    seedTree(tmp, 3, '2/2', '2/2');
    run(tmp);
    const manifest = JSON.parse(
      readFileSync(join(tmp, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.ironclad.other.detectors).toBe('99/99');
  });

  test('excludes index.ts from the count', () => {
    // seedTree always creates index.ts on top of the N detectors; if
    // the script counted it, this test would see "8/8" not "7/7".
    seedTree(tmp, 7, '0/0', '0/0');
    const manifest = JSON.parse(
      readFileSync(join(tmp, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(manifest.ironclad.current.detectors).toBe('0/0');
    run(tmp);
    const after = JSON.parse(
      readFileSync(join(tmp, 'plugins', 'claude-code', '.claude-plugin', 'plugin.json'), 'utf8'),
    );
    expect(after.ironclad.current.detectors).toBe('7/7');
  });
});
