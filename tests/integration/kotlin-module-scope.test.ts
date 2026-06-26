// Cladding · integration — module-scoped gate on a multi-module Kotlin repo
//
// A real (fake) `./gradlew` is spawned, so this proves the full path:
//   clad done <id> → read feature.modules → resolveStageCommand →
//   `./gradlew :a:test` (or the root aggregate) → exit code → keep/revert.
//
// The stub gradlew is RED for the root aggregate (`test`) and for any `:b:`
// task (module B is broken), GREEN for `:a:` tasks. So:
//   • feature → module A  ⇒ `:a:test` ⇒ GREEN ⇒ done kept
//   • feature → module B  ⇒ `:b:test` ⇒ RED   ⇒ done reverted
//   • feature → no modules ⇒ `test` (aggregate) ⇒ RED (B drags it down)
//   • scope: repo override ⇒ aggregate even for A ⇒ RED

import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {runDone} from '../../src/cli/done.js';
import {runUnit} from '../../src/stages/unit.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-kt-int-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** A stub gradlew: RED for the bare aggregate `test` and any `:b:` task. */
const FAKE_GRADLEW = `#!/bin/sh
for a in "$@"; do
  case "$a" in
    test|compileKotlin|compileTestKotlin|ktlintCheck) echo "aggregate $a"; exit 1;;
    *:b:*) echo "module-b $a"; exit 1;;
  esac
done
exit 0
`;

function makeModule(name: string): void {
  mkdirSync(join(dir, name, 'src/main/kotlin'), {recursive: true});
  writeFileSync(join(dir, name, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  writeFileSync(join(dir, name, 'gradle.properties'), 'type=kotlin-library\n');
  writeFileSync(join(dir, name, `src/main/kotlin/${name}.kt`), `package ${name}\n`);
}

function makeRepo(): void {
  writeFileSync(join(dir, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  writeFileSync(join(dir, 'gradle.properties'), '\n');
  writeFileSync(join(dir, 'settings.gradle.kts'), 'include(":a", ":b")\n');
  const gw = join(dir, 'gradlew');
  writeFileSync(gw, FAKE_GRADLEW);
  chmodSync(gw, 0o755);
  makeModule('a');
  makeModule('b');
}

function writeShard(modulesYaml: string): string {
  const featuresDir = join(dir, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});
  const path = join(featuresDir, 'feat-aa11bb22.yaml');
  writeFileSync(
    path,
    'id: F-aa11bb22\nslug: feat\nstatus: in_progress\ntitle: A feature\n' + modulesYaml,
  );
  return path;
}

// A faithful stand-in for runCheckStages that runs ONLY the unit stage against
// the fake gradlew — enough to exercise modules → scope → exit-code, without
// the full 9-stage pre-push gate (which needs a complete spec).
function unitOnlyGate() {
  return (opts: {focusModules?: readonly string[]}) => {
    const r = runUnit({cwd: dir, focusModules: opts.focusModules});
    return {worst: r.pass ? 0 : r.exitCode, anyFailed: !r.pass};
  };
}

describe('multi-module Kotlin gate scope', () => {
  test('runUnit scoped to module A is GREEN; module B is RED', () => {
    makeRepo();
    expect(runUnit({cwd: dir, focusModules: ['a']}).pass).toBe(true);
    expect(runUnit({cwd: dir, focusModules: ['b']}).pass).toBe(false);
  });

  test('no focus modules runs the root aggregate → RED (module B drags it down)', () => {
    makeRepo();
    const r = runUnit({cwd: dir, focusModules: []});
    expect(r.pass).toBe(false);
  });

  test('clad done KEEPS done when the feature points only at the GREEN module A', () => {
    makeRepo();
    const shard = writeShard('modules:\n  - a\n');
    const res = runDone(dir, 'F-aa11bb22', {checkStages: unitOnlyGate()});
    expect(res.ok).toBe(true);
    expect(readFileSync(shard, 'utf8')).toMatch(/status: done/);
  });

  test('clad done REVERTS when the feature points at the RED module B', () => {
    makeRepo();
    const shard = writeShard('modules:\n  - b\n');
    const res = runDone(dir, 'F-aa11bb22', {checkStages: unitOnlyGate()});
    expect(res.ok).toBe(false);
    expect(readFileSync(shard, 'utf8')).toMatch(/status: in_progress/);
  });

  test('a modules-less feature falls back to the whole-repo aggregate → RED', () => {
    makeRepo();
    writeShard(''); // no modules → whole-repo
    const res = runDone(dir, 'F-aa11bb22', {checkStages: unitOnlyGate()});
    expect(res.ok).toBe(false);
  });

  test('gate.scope: repo forces the aggregate even for the GREEN module A → RED', () => {
    makeRepo();
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    writeFileSync(join(dir, '.cladding', 'config.yaml'), 'gate:\n  scope: repo\n');
    writeShard('modules:\n  - a\n');
    const res = runDone(dir, 'F-aa11bb22', {checkStages: unitOnlyGate()});
    expect(res.ok).toBe(false);
  });
});
