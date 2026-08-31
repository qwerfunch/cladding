// Cladding · F6 execution identity — compiler scope and executed module closure.

import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {assuranceProfile} from '../../src/assurance/kernel.js';
import {effectiveFeatureScope} from '../../src/assurance/workspace.js';
import {runCheckStages} from '../../src/cli/clad.js';
import {compileSpecWorkspace} from '../../src/spec/compiler/compile.js';

const roots: string[] = [];

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'clad-effective-scope-'));
  roots.push(cwd);
  mkdirSync(join(cwd, 'spec', 'features'), {recursive: true});
  writeFileSync(join(cwd, 'spec.yaml'), [
    'schema: "0.2"', 'project:', '  name: execution-identity', '  language: kotlin',
    '  purpose: Prove that an authoritative gate runs its claimed closure.', '  assurance_level: L1', '  scenario_policy: advisory', '',
  ].join('\n'));
  writeFileSync(join(cwd, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
  writeFileSync(join(cwd, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
  return cwd;
}

function feature(id: string, modules: readonly string[], dependsOn: readonly string[] = []): string {
  return [
    `id: ${id}`, `title: ${id}`, 'status: done', `purpose: Keep ${id} in the authoritative execution closure.`,
    `modules: [${modules.join(', ')}]`, `depends_on: [${dependsOn.join(', ')}]`, 'capability_refs: []', 'acceptance_criteria:',
    `  - id: AC-${id.slice(2)}`, '    kind: behavior', `    statement: The system shall keep ${id} in its execution closure.`, '',
  ].join('\n');
}

function writeScopeFixture(cwd: string): void {
  writeFileSync(join(cwd, 'spec', 'features', 'a.yaml'), feature('F-aaaaaaaa', ['a/src/main/kotlin/A.kt', 'shared/src/main/kotlin/Common.kt'], ['F-cccccccc']));
  writeFileSync(join(cwd, 'spec', 'features', 'b.yaml'), feature('F-bbbbbbbb', ['b/src/main/kotlin/B.kt', 'shared/src/main/kotlin/Common.kt'], ['F-aaaaaaaa']));
  writeFileSync(join(cwd, 'spec', 'features', 'p.yaml'), feature('F-cccccccc', ['p/src/main/kotlin/P.kt']));
  writeFileSync(join(cwd, 'spec', 'features', 'd.yaml'), feature('F-dddddddd', ['d/src/main/kotlin/D.kt']));
}

function writeGradleProject(cwd: string, module: string, source: string): void {
  mkdirSync(join(cwd, module, 'src', 'main', 'kotlin'), {recursive: true});
  writeFileSync(join(cwd, module, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
  writeFileSync(join(cwd, module, 'gradle.properties'), 'type=kotlin-library\n');
  writeFileSync(join(cwd, module, 'src', 'main', 'kotlin', source), `package ${module}\n`);
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('F6 compiler-effective execution scope', () => {
  test('completion fixed point includes prerequisite, dependent, and shared-artifact co-owner', () => {
    const cwd = workspace();
    writeScopeFixture(cwd);
    const scope = effectiveFeatureScope(
      compileSpecWorkspace(cwd), assuranceProfile('completion', 'L1'), ['feature:F-aaaaaaaa'],
    );

    // Independent hand-authored expectation: A names P, B depends on A, and
    // A/B share Common.kt. Every edge must participate in the next expansion.
    expect(scope.complete).toBe(true);
    expect(scope.repository).toBe(false);
    expect(scope.scopeAddresses).toEqual(['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb', 'feature:F-cccccccc']);
    expect(scope.focusModules).toEqual([
      'a/src/main/kotlin/A.kt', 'b/src/main/kotlin/B.kt', 'p/src/main/kotlin/P.kt', 'shared/src/main/kotlin/Common.kt',
    ]);
  });

  test('the resolved closure reaches dependent B in the actual Gradle stage command and fails its defect', () => {
    const cwd = workspace();
    writeScopeFixture(cwd);
    writeFileSync(join(cwd, 'build.gradle.kts'), 'plugins { kotlin("jvm") }\n');
    writeFileSync(join(cwd, 'gradle.properties'), '\n');
    writeGradleProject(cwd, 'a', 'A.kt');
    writeGradleProject(cwd, 'b', 'B.kt');
    writeGradleProject(cwd, 'p', 'P.kt');
    writeGradleProject(cwd, 'shared', 'Common.kt');
    writeGradleProject(cwd, 'd', 'D.kt');
    mkdirSync(join(cwd, '.cladding'), {recursive: true});
    writeFileSync(join(cwd, '.cladding', 'config.yaml'), 'gate:\n  commands:\n    type: ["./gradlew", "{modules:compileKotlin}"]\n');
    const invocation = join(cwd, 'gradle-argv.txt');
    const gradlew = join(cwd, 'gradlew');
    writeFileSync(gradlew, `#!/bin/sh\nprintf '%s\\n' "$@" >> "${invocation}"\nfor arg in "$@"; do case "$arg" in *:b:*) exit 1;; esac; done\nexit 0\n`);
    chmodSync(gradlew, 0o755);

    const previous = process.cwd();
    try {
      process.chdir(cwd);
      const outcome = runCheckStages({profile: 'completion', scopeSubjects: ['feature:F-aaaaaaaa'], silent: true});
      expect(outcome.worst).toBeGreaterThanOrEqual(1);
      const invoked = readFileSync(invocation, 'utf8');
      expect(invoked).toContain(':b:compileKotlin');
      expect(invoked).not.toContain(':d:compileKotlin');
      expect(invoked).not.toContain('\ncompileKotlin\n');
    } finally {
      process.chdir(previous);
    }
  });

  test('unknown or incomplete compiler scope expands to the repository and disables focus modules', () => {
    const cwd = workspace();
    writeScopeFixture(cwd);
    writeFileSync(join(cwd, 'spec', 'features', 'a.yaml'), feature('F-aaaaaaaa', ['a/src/main/kotlin/A.kt'], ['F-eeeeeeee']));
    const scope = effectiveFeatureScope(
      compileSpecWorkspace(cwd), assuranceProfile('completion', 'L1'), ['feature:F-aaaaaaaa'],
    );

    expect(scope.complete).toBe(false);
    expect(scope.repository).toBe(true);
    expect(scope.scopeAddresses).toEqual(['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb', 'feature:F-cccccccc', 'feature:F-dddddddd']);
    expect(scope.focusModules).toBeUndefined();
  });

  test('push ignores a raw feature hint and remains repository-scoped', () => {
    const cwd = workspace();
    writeScopeFixture(cwd);
    const scope = effectiveFeatureScope(
      compileSpecWorkspace(cwd), assuranceProfile('push', 'L1'), ['feature:F-aaaaaaaa'],
    );

    expect(scope.repository).toBe(true);
    expect(scope.scopeAddresses).toEqual(['feature:F-aaaaaaaa', 'feature:F-bbbbbbbb', 'feature:F-cccccccc', 'feature:F-dddddddd']);
    expect(scope.focusModules).toBeUndefined();
  });
});
