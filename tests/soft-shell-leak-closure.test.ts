// Cladding · F-ebbb20af — Soft Shell leak closure + language-agnostic firing.
//
// Proves the closed leaks stay closed (no "shard"/MCP name in user-facing output
// or generated files; a stop-block renders a plain lead, not a raw detector id)
// and that the behavior-triggered signals fire from one English source regardless
// of the user's language (an all-Korean spec still triggers them).

import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';

type DriftReport = {pass: boolean; exitCode: number; findings: unknown[]};
const DRIFT_CLEAN: DriftReport = {pass: true, exitCode: 0, findings: []};
vi.mock('../src/stages/drift.js', () => ({runDrift: () => DRIFT_CLEAN}));
vi.mock('../src/stages/arch.js', () => ({runArch: () => ({pass: true, exitCode: 0})}));
vi.mock('../src/stages/secret.js', () => ({runSecret: () => ({pass: true, exitCode: 0})}));

const {DETECTOR_PLAIN, plainLead} = await import('../src/ui/softShell.js');
const {runDone} = await import('../src/cli/done.js');
const {enforcementAdvisory} = await import('../src/cli/enforcement-advisory.js');
const {runInit} = await import('../src/cli/init.js');
const {runHookEvent} = await import('../src/cli/hook.js');

const SHARD = /\bshards?\b/i;
const MCP = /\bclad_[a-z_]+/;
const NUDGE = "recent source edits aren't tracked by any feature";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-ssl-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
  vi.clearAllMocks();
});

describe('F-ebbb20af — Soft Shell leak closure', () => {
  test('AC-77f0ec75 — the INVENTORY_DRIFT lead says "spec", not "shard"', () => {
    expect(DETECTOR_PLAIN.INVENTORY_DRIFT.lead).not.toMatch(SHARD);
    expect(DETECTOR_PLAIN.INVENTORY_DRIFT.lead).toContain('spec');
  });

  test('AC-77f0ec75 — the clad done no-feature refusal says "spec", not "shard"', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: t, language: typescript}\nfeatures: []\n');
    const res = runDone(dir, 'F-nope', {checkStages: () => ({worst: 0})});
    expect(res.ok).toBe(false);
    expect(res.reason).not.toMatch(SHARD);
    expect(res.reason).toContain('no feature in the spec');
  });

  test('[covers:F-ebbb20af/AC-78c153fa] AC-78c153fa — a stop-block detector renders its plain lead, never the raw id', () => {
    expect(plainLead('AC_DRIFT', 'a prior check')).toBe(DETECTOR_PLAIN.AC_DRIFT.lead);
    expect(plainLead('AC_DRIFT', 'a prior check')).not.toBe('AC_DRIFT');
    // an unregistered detector falls back to a plain phrase, not the raw token
    expect(plainLead('WEIRD_UNREGISTERED', 'a prior check')).toBe('a prior check');
  });

  test('[covers:F-ebbb20af/AC-c7c1c6e1] AC-c7c1c6e1 — the init-generated scenarios README prose names no MCP tool and no "shard"', async () => {
    await runInit({cwd: dir});
    const readmePath = join(dir, 'spec', 'scenarios', 'README.md');
    expect(existsSync(readmePath), 'scenarios README should be generated').toBe(true);
    const readme = readFileSync(readmePath, 'utf8');
    expect(readme, 'scenarios README').not.toMatch(MCP);
    expect(readme, 'scenarios README').not.toMatch(SHARD);
  });

  // ── per-language firing: one English source, triggered by behavior, not words ──

  // NOTE: by design a slug is a machine id (ASCII kebab-case, schema-pinned);
  // the human-facing title, project name, and AC text are any language. So the
  // realistic Korean project keeps ASCII slugs and Korean everywhere a human reads.
  test('AC-408e6838 — the enforcement advisory fires on a spec with Korean title/name/text', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: 한글프로젝트, language: typescript}\nfeatures:\n' +
        '  - id: F-aaa111\n    slug: login\n    title: 사용자 로그인 기능\n    status: in_progress\n' +
        '    modules: [src/login.ts]\n    acceptance_criteria:\n' +
        '      - id: AC-001\n        ears: ubiquitous\n        text: 사용자는 로그인할 수 있어야 한다\n',
    );
    const out = enforcementAdvisory(dir);
    expect(out).toBeTypeOf('string'); // fires despite non-ASCII human content
    expect(out).toContain('not yet done');
  });

  test('AC-408e6838 — the unbound-edit nudge fires on a Korean-named path under a Korean-titled spec', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: 프로젝트, language: typescript}\nfeatures:\n' +
        '  - id: F-aaa111\n    slug: alpha\n    title: 알파 기능\n    status: done\n' +
        '    modules: [src/foo.ts]\n    acceptance_criteria:\n' +
        '      - id: AC-001\n        ears: ubiquitous\n        text: t\n',
    );
    const editKoreanUnbound = (): string => {
      rmSync(join(dir, '.cladding', 'hook-drift-ts'), {force: true});
      return runHookEvent('PostToolUse', {
        tool_name: 'Edit',
        tool_input: {file_path: 'src/주문처리.ts', old_string: '', new_string: '한'.repeat(60)},
      }, dir);
    };
    expect(editKoreanUnbound()).not.toContain(NUDGE); // 1
    expect(editKoreanUnbound()).not.toContain(NUDGE); // 2
    expect(editKoreanUnbound()).toContain(NUDGE); // 3 — fires regardless of language
  });
});
