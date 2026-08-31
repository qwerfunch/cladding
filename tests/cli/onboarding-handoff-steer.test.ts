// Cladding · F-195cb59e — the onboarding→development handoff steers to the first
// feature's spec, not straight to code.
//
// The ungoverned-code case (a whole project scaffolded with features: []) traced
// to the init host instruction: "report that ordinary development can begin". This
// pins the corrected instruction so the handoff points at the spec-first cycle.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';

import {describe, expect, test} from 'vitest';

const SKILL = readFileSync(join(process.cwd(), 'skills', 'init', 'SKILL.md'), 'utf8');

describe('F-195cb59e — onboarding handoff steer (init SKILL.md)', () => {
  test('[covers:F-195cb59e/AC-f75cc3de] AC-f75cc3de — the completion instruction steers to authoring the first feature spec, not bare "ordinary development can begin"', () => {
    expect(SKILL).not.toContain('ordinary development can begin');
    expect(SKILL).toMatch(/author the first feature'?s spec/i);
    expect(SKILL).toMatch(/before writing (any )?code/i);
  });

  test('[covers:F-195cb59e/AC-d21ead41] AC-d21ead41 — the steer names what the spec contains (acceptance criteria + the files it covers) and stays plain', () => {
    // isolate the steer SENTENCE (the init skill legitimately names clad_* tools
    // elsewhere — that is agent-facing protocol, not the user-facing steer).
    const start = SKILL.indexOf('author the first feature');
    const steer = SKILL.slice(start, SKILL.indexOf('scaffolding', start) + 'scaffolding'.length);
    // names WHAT to write — not vague
    expect(steer).toContain('acceptance criteria');
    expect(steer).toMatch(/files it will cover/i);
    // plain: the steer never says "shard"
    expect(steer).not.toMatch(/\bshard\b/i);
  });
});
