// Cladding · unit tests for stages/toolchain/module-scope.ts
//
// The path→Gradle-project mapping is the structural core of module-scoped
// gating. Pins: nested paths, file paths (normalized to their dir), the root
// module, dedup + deterministic sort, and a LOUD throw on an unmappable path
// (never a silent whole-repo fallback).

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  gradleTask,
  isGradleCmd,
  mapModulesToProjects,
} from '../../../src/stages/toolchain/module-scope.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-modscope-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Marks `<dir>/<rel>` as a Gradle module root (build script + gradle.properties). */
function makeModule(rel: string): void {
  const d = rel ? join(dir, rel) : dir;
  mkdirSync(d, {recursive: true});
  writeFileSync(join(d, 'build.gradle.kts'), '');
  writeFileSync(join(d, 'gradle.properties'), 'type=kotlin-library\n');
}

describe('mapModulesToProjects', () => {
  test('[covers:F-c6c3daaf/AC-0653c05d] maps a nested module dir to its colon project path', () => {
    makeModule('worker/statistics-aggregator/application');
    const projects = mapModulesToProjects(dir, ['worker/statistics-aggregator/application']);
    expect(projects.map((p) => p.path)).toEqual([':worker:statistics-aggregator:application']);
  });

  test('maps a sibling module dir one level up', () => {
    makeModule('worker/statistics-aggregator');
    const projects = mapModulesToProjects(dir, ['worker/statistics-aggregator']);
    expect(projects.map((p) => p.path)).toEqual([':worker:statistics-aggregator']);
  });

  test('[covers:F-c6c3daaf/AC-0653c05d] normalizes a FILE path to its owning module', () => {
    makeModule('worker/ingest');
    mkdirSync(join(dir, 'worker/ingest/src/main/kotlin'), {recursive: true});
    writeFileSync(join(dir, 'worker/ingest/src/main/kotlin/Foo.kt'), 'package x\n');
    const projects = mapModulesToProjects(dir, [
      'worker/ingest/src/main/kotlin/Foo.kt',
    ]);
    expect(projects.map((p) => p.path)).toEqual([':worker:ingest']);
  });

  test('[covers:F-c6c3daaf/AC-0653c05d] walks up from a non-module subdir to the nearest module root', () => {
    makeModule('app');
    const projects = mapModulesToProjects(dir, ['app/src/main/kotlin/pkg']);
    expect(projects.map((p) => p.path)).toEqual([':app']);
  });

  test('maps the ROOT module to `:`', () => {
    makeModule(''); // root carries build.gradle.kts + gradle.properties
    const projects = mapModulesToProjects(dir, ['src/main/kotlin']);
    expect(projects.map((p) => p.path)).toEqual([':']);
  });

  test('[covers:F-c6c3daaf/AC-0653c05d] dedups modules that resolve to the same project, sorted deterministically', () => {
    makeModule('b-mod');
    makeModule('a-mod');
    const projects = mapModulesToProjects(dir, [
      'b-mod/src/x',
      'a-mod',
      'b-mod', // dup of the first → one :b-mod
    ]);
    expect(projects.map((p) => p.path)).toEqual([':a-mod', ':b-mod']);
  });

  test('[covers:F-c6c3daaf/AC-0653c05d] THROWS (no silent fallback) on a path with no Gradle module ancestor', () => {
    makeModule('a');
    expect(() => mapModulesToProjects(dir, ['a', 'nope/over/here'])).toThrow(/nope\/over\/here/);
  });

  test('THROWS when a dir has build script but NO gradle.properties', () => {
    mkdirSync(join(dir, 'half'), {recursive: true});
    writeFileSync(join(dir, 'half/build.gradle.kts'), '');
    expect(() => mapModulesToProjects(dir, ['half'])).toThrow(/half/);
  });
});

describe('gradleTask', () => {
  test('prefixes a nested project path', () => {
    expect(gradleTask(':a:b', 'test')).toBe(':a:b:test');
  });
  test('root project yields `:task`', () => {
    expect(gradleTask(':', 'test')).toBe(':test');
  });
});

describe('isGradleCmd', () => {
  test.each([
    ['./gradlew', true],
    ['gradle', true],
    ['npx', false],
    ['mvn', false],
    [undefined, false],
  ])('%s → %s', (cmd, want) => {
    expect(isGradleCmd(cmd as string | undefined)).toBe(want);
  });
});
