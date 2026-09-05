// Cladding · retirement guard — the headless drive loop (0.10.0).
//
// 0.10.0 retires the experimental headless agent loop and its loop-only
// adapters, skill, and features: no recorded session ever ran the loop
// (0 runs across 5,176 events measured 2026-09-02) and the host-delegated
// cycle owns execution. This suite is the tripwire that keeps the retired
// surface from creeping back — the source tree, the shipped skill catalog,
// the feature corpus, and the one dependency that must NOT leave with it.
//
// SELF-EXCLUSION: the removed-verb tripwire in tests/cli/verb-residue.test.ts
// walks tests/**/*.ts, so this file contains zero literal occurrences of the
// retired two-word verb phrase; every such needle is assembled at runtime.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

import {loadSpec} from '../../src/spec/load.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
/** The retired verb phrase, assembled so this file carries no literal needle. */
const RETIRED_INVOCATION = `${'clad'} ${'run'}`;

/** Every .ts file under a directory, skipping build and vendor trees. */
function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTs(full, acc);
    else if (entry.name.endsWith('.ts')) acc.push(full);
  }
  return acc;
}

describe('drive-loop retirement · source tree', () => {
  test('[covers:F-9fcdd0a0/AC-8752a68c] no drive module and no import of the retired agent-invocation adapters survives under src/', () => {
    expect(existsSync(join(ROOT, 'src/drive'))).toBe(false);
    for (const gone of [
      'src/adapters/index.ts',
      'src/adapters/sdk/anthropic.ts',
      'src/adapters/host/claude-code.ts',
      'src/adapters/host/generic-mcp.ts',
      'src/core/postmortem.ts',
    ]) {
      expect(existsSync(join(ROOT, gone)), `${gone} is retired`).toBe(false);
    }

    const files = walkTs(join(ROOT, 'src'));
    // Vacuous-walk guard: an empty or failed walk must not pass silently.
    expect(files.length).toBeGreaterThan(100);
    const needles = [
      'drive/loop',
      'drive/agent',
      'drive/halt',
      'adapters/index',
      'sdk/anthropic',
      'host/claude-code',
      'host/generic-mcp',
      'core/postmortem',
      'pulseProgress',
      'haltMessage',
    ];
    const hits: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, 'utf8');
      for (const needle of needles) if (body.includes(needle)) hits.push(`${file.slice(ROOT.length + 1)} · ${needle}`);
    }
    expect(hits, `retired references still present:\n${hits.join('\n')}`).toEqual([]);

    // The surviving host layer is what the onboarding scan dispatcher consumes.
    expect(existsSync(join(ROOT, 'src/adapters/host/transport.ts'))).toBe(true);
    expect(existsSync(join(ROOT, 'src/adapters/host/sampling-context.ts'))).toBe(true);
  });
});

describe('drive-loop retirement · shipped skill surfaces', () => {
  test('[covers:F-9fcdd0a0/AC-157aeb33][covers:F-076/AC-224][covers:F-077/AC-231] the skill catalog and its plugin mirrors ship five verbs and never invoke the retired loop', () => {
    expect(existsSync(join(ROOT, 'skills/run'))).toBe(false);
    for (const verb of ['sync', 'check', 'status', 'init', 'serve']) {
      expect(existsSync(join(ROOT, `skills/${verb}/SKILL.md`)), `skills/${verb}/SKILL.md ships`).toBe(true);
      expect(existsSync(join(ROOT, `plugins/codex/skills/${verb}/SKILL.md`)), `codex mirror of ${verb}`).toBe(true);
    }
    for (const persona of ['orchestrator', 'planner', 'reviewer', 'observability', 'developer']) {
      expect(existsSync(join(ROOT, `plugins/codex/skills/${persona}/SKILL.md`)), `codex persona ${persona}`).toBe(true);
    }
    for (const mirror of ['plugins/codex/skills/run', 'plugins/antigravity/skills/run', 'plugins/claude-code/skills/run']) {
      expect(existsSync(join(ROOT, mirror)), `${mirror} is retired`).toBe(false);
    }

    // No persona brief or skill surface — canonical or mirrored — still tells a
    // reader to invoke the retired loop.
    const surfaces: string[] = [];
    for (const dir of ['skills', 'src/agents', 'plugins']) {
      const base = join(ROOT, dir);
      if (!existsSync(base)) continue;
      const stack = [base];
      while (stack.length > 0) {
        const current = stack.pop() as string;
        for (const entry of readdirSync(current, {withFileTypes: true})) {
          if (entry.name === 'dist' || entry.name === 'node_modules') continue;
          const full = join(current, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith('.md') || entry.name.endsWith('.toml')) surfaces.push(full);
        }
      }
    }
    expect(surfaces.length).toBeGreaterThan(20);
    const offenders = surfaces.filter((file) => readFileSync(file, 'utf8').includes(RETIRED_INVOCATION));
    expect(offenders.map((f) => f.slice(ROOT.length + 1)), 'skill/persona surfaces still name the retired loop').toEqual([]);
  });
});

describe('drive-loop retirement · feature corpus', () => {
  const LOOP_ONLY = [
    'F-2de65d', 'F-5d3ed2', 'F-ba4b7a', 'F-048', 'F-049', 'F-069', 'F-070', 'F-071', 'F-072',
  ] as const;

  test('[covers:F-9fcdd0a0/AC-6128e8ca] every loop-only feature loads as archived with an archive reason and no bound modules', () => {
    const spec = loadSpec(ROOT);
    for (const id of LOOP_ONLY) {
      const feature = spec.features.find((f) => f.id === id);
      expect(feature, `${id} is still in the corpus as history`).toBeTruthy();
      expect(feature?.status, `${id} status`).toBe('archived');
      expect((feature?.archive_reason ?? '').length, `${id} archive reason`).toBeGreaterThan(0);
      expect(feature?.modules ?? [], `${id} modules`).toEqual([]);
      // Criteria stay as history — archiving records the retirement, it does
      // not erase what the feature once promised.
      expect((feature?.acceptance_criteria ?? []).length, `${id} criteria`).toBeGreaterThan(0);
    }
  });
});

describe('drive-loop retirement · retained dependency', () => {
  test('[covers:F-9fcdd0a0/AC-2433eb15] the Anthropic SDK stays a declared dependency because the onboarding scan dispatcher loads it', () => {
    const pkg = JSON.parse(read('package.json')) as {dependencies?: Record<string, string>};
    expect(pkg.dependencies?.['@anthropic-ai/sdk'], 'the API-key fallback path needs the SDK').toBeTruthy();
    const dispatcher = read('src/cli/scan/dispatcher.ts');
    expect(dispatcher, 'the dispatcher still loads the SDK on its fallback path').toContain('@anthropic-ai/sdk');
    expect(statSync(join(ROOT, 'src/cli/scan/dispatcher.ts')).isFile()).toBe(true);
  });
});
