// Cladding · F7-B4 · byte-exact plugin persona/skill mirror census.

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {criterionObservationRule, inspectPluginMirrorWorkspace} from '../../src/assurance/criterion-observations.js';
import {PERSONAS, SKILLS, derivePluginMirror, mirrorClosurePaths, mirrorInputPaths, mirrorOperationPlan, mirrorOutputPaths} from '../../scripts/plugin-mirror-policy.mjs';

function seedCanonical(root: string): void {
  mkdirSync(join(root, 'src', 'agents'), {recursive: true});
  mkdirSync(join(root, 'skills'), {recursive: true});
  mkdirSync(join(root, 'scripts'), {recursive: true});
  writeFileSync(join(root, 'package.json'), '{"name":"mirror-fixture"}\n');
  writeFileSync(join(root, 'scripts', 'plugin-mirror-policy.mjs'), '// policy fixture\n');
  writeFileSync(join(root, 'scripts', 'build-plugin.mjs'), '// build fixture\n');
  writeFileSync(join(root, 'src', 'agents', 'README.md'), '# canonical agent catalog\n');
  for (const persona of PERSONAS) {
    writeFileSync(join(root, 'src', 'agents', `${persona}.md`), `---\ndescription: ${persona}\n---\n${persona}\n`);
  }
  for (const skill of SKILLS) {
    const path = join(root, 'skills', skill);
    mkdirSync(path, {recursive: true});
    writeFileSync(join(path, 'SKILL.md'), `---\ndescription: ${skill}\n---\n${skill}\n`);
  }
}

function apply(root: string): void {
  const census = derivePluginMirror(root);
  if (!census.complete) throw new Error('fixture census is incomplete');
  for (const operation of mirrorOperationPlan(census)) {
    if (operation.operation === 'delete') rmSync(join(root, operation.path), {recursive: true, force: true});
    else {
      mkdirSync(dirname(join(root, operation.path)), {recursive: true});
      writeFileSync(join(root, operation.path), operation.bytes!);
    }
  }
}

describe('plugin mirror policy', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'plugin-mirror-policy-'));
    seedCanonical(root);
  });

  afterEach(() => rmSync(root, {recursive: true, force: true}));

  test('[covers:F-40327b/AC-004] derives every persona/skill lane, rejects missing/extra/stale bytes, and has an idempotent byte map', () => {
    const initial = derivePluginMirror(root);
    expect(initial.complete).toBe(true);
    const outputPaths = mirrorOutputPaths();
    const closurePaths = mirrorClosurePaths();
    expect(initial.expected.map((entry) => entry.path)).toEqual(outputPaths);
    expect(initial.outputs.map((entry) => entry.path)).toEqual(outputPaths);
    expect(closurePaths).toEqual([...new Set([...mirrorInputPaths(), ...outputPaths])].sort());
    expect(initial.inputAddresses).toEqual(closurePaths.map((path) => `artifact:${path}`));
    expect(criterionObservationRule('F-40327b/AC-004')!.inputAddresses)
      .toEqual(closurePaths.map((path) => `artifact:${path}`));
    for (const path of outputPaths) {
      expect(closurePaths).toContain(path);
      expect(initial.inputAddresses).toContain(`artifact:${path}`);
    }
    expect(initial.issues.some((issue) => issue.kind === 'missing')).toBe(true);
    apply(root);
    const clean = derivePluginMirror(root);
    expect(clean.clean).toBe(true);
    const first = clean.outputs.map((entry) => [entry.path, entry.actual_sha256]);
    apply(root);
    expect(derivePluginMirror(root).outputs.map((entry) => [entry.path, entry.actual_sha256])).toEqual(first);

    writeFileSync(join(root, 'plugins', 'codex', 'skills', 'check', 'SKILL.md'), 'stale\n');
    writeFileSync(join(root, 'plugins', 'antigravity', 'skills', 'nested-extra.md'), 'extra\n');
    const drifted = derivePluginMirror(root);
    expect(drifted.issues).toContainEqual(expect.objectContaining({kind: 'stale', path: 'plugins/codex/skills/check/SKILL.md'}));
    expect(drifted.issues).toContainEqual(expect.objectContaining({kind: 'extra', path: 'plugins/antigravity/skills/nested-extra.md'}));
    expect(inspectPluginMirrorWorkspace(root)).toMatchObject({state: 'fail', current: true, complete: true});
  });

  test('seals policy bytes and actual destination hashes, including a stale A-to-B mutation', () => {
    apply(root);
    const clean = derivePluginMirror(root);
    writeFileSync(join(root, 'plugins', 'claude-code', 'agents', 'planner.md'), 'A\n');
    const staleA = derivePluginMirror(root);
    writeFileSync(join(root, 'plugins', 'claude-code', 'agents', 'planner.md'), 'B\n');
    const staleB = derivePluginMirror(root);
    expect(staleA.inputSha256).not.toBe(staleB.inputSha256);
    writeFileSync(join(root, 'scripts', 'plugin-mirror-policy.mjs'), '// changed policy fixture\n');
    expect(derivePluginMirror(root).inputSha256).not.toBe(clean.inputSha256);
  });

  test('missing/malformed canonical input, collisions, and root/ancestor/leaf symlinks fail closed', () => {
    apply(root);
    rmSync(join(root, 'skills', 'init', 'SKILL.md'));
    expect(derivePluginMirror(root).complete).toBe(false);
    expect(inspectPluginMirrorWorkspace(root)).toMatchObject({state: 'unobserved', complete: false});

    seedCanonical(root);
    writeFileSync(join(root, 'src', 'agents', 'planner.md'), '---\ndescription: 7\n---\nplanner\n');
    expect(derivePluginMirror(root).issues).toContainEqual(expect.objectContaining({kind: 'malformed', path: 'src/agents/planner.md'}));
    seedCanonical(root);
    mkdirSync(join(root, 'skills', 'developer'), {recursive: true});
    writeFileSync(join(root, 'skills', 'developer', 'SKILL.md'), 'collision\n');
    expect(derivePluginMirror(root).issues).toContainEqual(expect.objectContaining({kind: 'collision', path: 'plugins/codex/skills/developer'}));

    const leaf = join(root, 'plugins', 'codex', 'skills', 'check', 'SKILL.md');
    rmSync(leaf);
    symlinkSync(join(root, 'src', 'agents', 'planner.md'), leaf);
    expect(derivePluginMirror(root).issues).toContainEqual(expect.objectContaining({kind: 'symlink', path: 'plugins/codex/skills/check/SKILL.md'}));
    rmSync(join(root, 'plugins'), {recursive: true, force: true});
    symlinkSync(join(root, 'src'), join(root, 'plugins'));
    expect(derivePluginMirror(root).issues).toContainEqual(expect.objectContaining({kind: 'symlink', path: 'plugins'}));
    const linkedRoot = `${root}-linked`;
    symlinkSync(root, linkedRoot);
    expect(derivePluginMirror(linkedRoot).issues).toContainEqual(expect.objectContaining({kind: 'symlink', path: '.'}));
    rmSync(linkedRoot);
  });
});
