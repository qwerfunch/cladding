// Cladding — orchestrator persona is a declarative cycle contract card, not
// choreography (F-600272d7).
//
// The old orchestrator.md prescribed EXECUTION FORM — a routing table (user
// intent -> agent), imperative "dispatch them concurrently" instructions, and
// a numbered "Invocation Principles" list. Per the role-contract
// architecture, cladding declares WHAT must hold for a feature to be done
// (spec-first, ACs satisfied, independent verification, gated completion) and
// leaves HOW the work is decomposed across agents to the host. This guard
// pins that shift: the banned choreography needles must stay absent from the
// orchestrator persona (and its built mirrors, so a stale mirror fails too),
// while the new contract-card content — the outcome conditions and the
// "host owns execution" boundary — must be literally present. It also pins
// docs/feature-cycle.md's CI/SDK-lane positioning for headless `clad run`.
//
// Sibling: tests/shard-term-guard.test.ts is the same guard genre (needle
// presence/absence across AI-facing surfaces) for the shard->spec-entry
// terminology fix.

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {describe, expect, test} from 'vitest';

// Banned choreography needles (AC-ee97a22e) — procedural agent-sequencing
// prose that belongs to the host, not the persona card.
const ROUTING_TABLE = /routing table/i;
const DISPATCH_CONCURRENTLY = /dispatch (them )?concurrently/i;
const INVOCATION_PRINCIPLES = /invocation principles/i;
const BANNED_NEEDLES: ReadonlyArray<{name: string; pattern: RegExp}> = [
  {name: 'routing table', pattern: ROUTING_TABLE},
  {name: 'dispatch (them) concurrently', pattern: DISPATCH_CONCURRENTLY},
  {name: 'invocation principles', pattern: INVOCATION_PRINCIPLES},
];

// Contract-card literals (AC-805ee617) — the outcome-condition content that
// must replace the removed choreography.
const HOST_OWNS_EXECUTION = 'the host owns execution';
const AGENTS_PROPOSE_GATES_DISPOSE = 'Agents propose; the gates dispose.';

const orchestratorPath = fileURLToPath(new URL('../src/agents/orchestrator.md', import.meta.url));
const orchestratorMd = readFileSync(orchestratorPath, 'utf8');

const featureCyclePath = fileURLToPath(new URL('../docs/feature-cycle.md', import.meta.url));
const featureCycleMd = readFileSync(featureCyclePath, 'utf8');

// Built mirrors — the build copies src/agents/orchestrator.md verbatim (or
// wraps it) into each surface; a stale mirror must fail this guard too.
const MIRRORS: ReadonlyArray<{name: string; path: string}> = [
  {
    name: 'plugins/claude-code/agents/orchestrator.md',
    path: fileURLToPath(new URL('../plugins/claude-code/agents/orchestrator.md', import.meta.url)),
  },
  {
    name: 'plugins/codex/skills/orchestrator/SKILL.md',
    path: fileURLToPath(new URL('../plugins/codex/skills/orchestrator/SKILL.md', import.meta.url)),
  },
];

describe('orchestrator persona is a cycle contract card, not choreography', () => {
  describe('AC-ee97a22e — no procedural choreography in the source persona', () => {
    for (const {name, pattern} of BANNED_NEEDLES) {
      test(`src/agents/orchestrator.md does not match /${name}/`, () => {
        expect(orchestratorMd, `orchestrator.md must not contain "${name}"`).not.toMatch(pattern);
      });
    }
  });

  describe('AC-805ee617 — the persona declares the cycle contract', () => {
    test('contains the literal "the host owns execution"', () => {
      expect(orchestratorMd.includes(HOST_OWNS_EXECUTION)).toBe(true);
    });

    test('contains both evidence-based independence labels', () => {
      expect(orchestratorMd.includes('independent')).toBe(true);
      expect(orchestratorMd.includes('self-certified')).toBe(true);
    });

    test('contains the literal "Agents propose; the gates dispose."', () => {
      expect(orchestratorMd.includes(AGENTS_PROPOSE_GATES_DISPOSE)).toBe(true);
    });
  });

  describe('AC-bc42f601 — feature-cycle guide positions the CI/SDK lane', () => {
    test('docs/feature-cycle.md contains the literal "CI/SDK lane"', () => {
      expect(featureCycleMd.includes('CI/SDK lane')).toBe(true);
    });
  });

  describe('mirror drift guard — built copies stay in lockstep', () => {
    for (const {name, path} of MIRRORS) {
      describe(name, () => {
        const body = readFileSync(path, 'utf8');

        for (const {name: needleName, pattern} of BANNED_NEEDLES) {
          test(`does not match /${needleName}/`, () => {
            expect(body, `${name} must not contain "${needleName}"`).not.toMatch(pattern);
          });
        }
      });
    }
  });
});

// F-ef93141b — specialist personas are selectable role briefs, not agents
// cladding mandates spawning. The orchestrator's contract-card shift (above)
// covered the ORCHESTRATOR persona only; this block extends the same
// guard-genre needle checks to the five SPECIALIST personas (planner,
// developer, reviewer, observability, blind-author) — both the source and
// the claude-code mirror, so a stale mirror fails too.
const ROLE_BRIEF = /role brief/i;

// Needle set pinned by AC-46fef26f verbatim — distinct from BANNED_NEEDLES
// above (that set is scoped to the orchestrator's AC-ee97a22e and includes
// "dispatch (them) concurrently", which AC-46fef26f does not ban).
const SPECIALIST_BANNED_NEEDLES: ReadonlyArray<{name: string; pattern: RegExp}> = [
  {name: 'invocation principle(s)', pattern: /invocation principles?/i},
  {name: 'principle N', pattern: /principle \d/i},
  {name: 'routing table', pattern: /routing table/i},
];

const SPECIALIST_PERSONAS: ReadonlyArray<{id: string; srcPath: string; mirrorPath: string}> = [
  'planner',
  'developer',
  'reviewer',
  'observability',
  'blind-author',
].map((id) => ({
  id,
  srcPath: fileURLToPath(new URL(`../src/agents/${id}.md`, import.meta.url)),
  mirrorPath: fileURLToPath(new URL(`../plugins/claude-code/agents/${id}.md`, import.meta.url)),
}));

describe('specialist personas are selectable role briefs, not mandated agents', () => {
  describe('AC-163773ad — each specialist persona presents itself as a role brief', () => {
    for (const {id, srcPath} of SPECIALIST_PERSONAS) {
      test(`src/agents/${id}.md contains "role brief"`, () => {
        const body = readFileSync(srcPath, 'utf8');
        expect(body, `src/agents/${id}.md must contain "role brief"`).toMatch(ROLE_BRIEF);
      });
    }
  });

  describe('AC-46fef26f — no specialist persona references the removed choreography layer', () => {
    for (const {id, srcPath} of SPECIALIST_PERSONAS) {
      describe(`src/agents/${id}.md`, () => {
        const body = readFileSync(srcPath, 'utf8');

        for (const {name, pattern} of SPECIALIST_BANNED_NEEDLES) {
          test(`does not match /${name}/`, () => {
            expect(body, `src/agents/${id}.md must not contain "${name}"`).not.toMatch(pattern);
          });
        }
      });
    }
  });

  describe('mirror drift guard — plugins/claude-code/agents/<id>.md stays in lockstep', () => {
    for (const {id, mirrorPath} of SPECIALIST_PERSONAS) {
      describe(`plugins/claude-code/agents/${id}.md`, () => {
        const body = readFileSync(mirrorPath, 'utf8');

        test('contains "role brief"', () => {
          expect(body, `plugins/claude-code/agents/${id}.md must contain "role brief"`).toMatch(ROLE_BRIEF);
        });

        for (const {name, pattern} of SPECIALIST_BANNED_NEEDLES) {
          test(`does not match /${name}/`, () => {
            expect(body, `plugins/claude-code/agents/${id}.md must not contain "${name}"`).not.toMatch(pattern);
          });
        }
      });
    }
  });
});
