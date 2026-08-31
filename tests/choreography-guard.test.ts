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
const plannerPath = fileURLToPath(new URL('../src/agents/planner.md', import.meta.url));
const plannerMd = readFileSync(plannerPath, 'utf8');
const PLANNER_MIRRORS: ReadonlyArray<{name: string; path: string}> = [
  {
    name: 'plugins/claude-code/agents/planner.md',
    path: fileURLToPath(new URL('../plugins/claude-code/agents/planner.md', import.meta.url)),
  },
  {
    name: 'plugins/codex/skills/planner/SKILL.md',
    path: fileURLToPath(new URL('../plugins/codex/skills/planner/SKILL.md', import.meta.url)),
  },
  {
    name: 'plugins/antigravity/skills/planner/SKILL.md',
    path: fileURLToPath(new URL('../plugins/antigravity/skills/planner/SKILL.md', import.meta.url)),
  },
  {
    name: 'plugins/claude-code/dist/agents/planner.md',
    path: fileURLToPath(new URL('../plugins/claude-code/dist/agents/planner.md', import.meta.url)),
  },
];

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
    test('[covers:F-600272d7/AC-805ee617] contains the literal "the host owns execution"', () => {
      expect(orchestratorMd.includes(HOST_OWNS_EXECUTION)).toBe(true);
    });

    test('[covers:F-600272d7/AC-805ee617] contains both evidence-based independence labels', () => {
      expect(orchestratorMd.includes('independent')).toBe(true);
      expect(orchestratorMd.includes('self-certified')).toBe(true);
    });

    test('[covers:F-600272d7/AC-805ee617][covers:F-600272d7/AC-ee97a22e] contains the literal "Agents propose; the gates dispose."', () => {
      expect(orchestratorMd.includes(AGENTS_PROPOSE_GATES_DISPOSE)).toBe(true);
    });
  });

  describe('AC-bc42f601 — feature-cycle guide positions the CI/SDK lane', () => {
    test('[covers:F-600272d7/AC-bc42f601] docs/feature-cycle.md contains the literal "CI/SDK lane"', () => {
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

describe('planner guidance keeps clarification and design-impact authority distinct', () => {
  test('[covers:F-09d68b/AC-006] planner guidance states the clarify and design-impact boundary and mirrors reproduce its source', () => {
    expect(plannerMd).toContain('Treat `clad clarify` as answer collection, not design-impact resolution.');
    expect(plannerMd).toContain('Design-impact resolution remains human-owned.');
    for (const {name, path} of PLANNER_MIRRORS) {
      expect(readFileSync(path, 'utf8'), `${name} must reproduce planner.md`).toBe(plannerMd);
    }
  });

  test('[covers:F-b99577/AC-005] planner guidance states the design-impact responsibility and human-resolution boundary', () => {
    expect(plannerMd).toContain('record the design impact and ask a human to resolve it');
    expect(plannerMd).toContain('it must not clear a pending\n' + 'design-impact review or infer approval from a clarification answer.');
    for (const {name, path} of PLANNER_MIRRORS) {
      expect(readFileSync(path, 'utf8'), `${name} must reproduce the design-impact boundary`).toBe(plannerMd);
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

// F-9d8ece66 — planner brief loses dogfood-only npm script commands (E2E gap
// G3): `npm run spec:validate` / `npm run stage:drift` are cladding's own
// package.json scripts, not something an external adopter running clad as a
// dependency has. The planner brief must instead point at the `clad` CLI.
const DOGFOOD_NPM_SCRIPTS = /npm run (spec:validate|stage:drift)/;

describe('planner brief points external users at the clad CLI, not dogfood-only npm scripts (F-9d8ece66)', () => {
  const plannerPersona = SPECIALIST_PERSONAS.find((p) => p.id === 'planner')!;

  describe('AC-65e247dc — no npm run spec:validate / stage:drift guidance remains', () => {
    test('[covers:F-9d8ece66/AC-65e247dc] src/agents/planner.md matches no /npm run (spec:validate|stage:drift)/', () => {
      const body = readFileSync(plannerPersona.srcPath, 'utf8');
      expect(body, 'src/agents/planner.md must not match /npm run (spec:validate|stage:drift)/').not.toMatch(
        DOGFOOD_NPM_SCRIPTS,
      );
    });

    test('mirror parity: plugins/claude-code/agents/planner.md matches no /npm run (spec:validate|stage:drift)/', () => {
      const body = readFileSync(plannerPersona.mirrorPath, 'utf8');
      expect(
        body,
        'plugins/claude-code/agents/planner.md must not match /npm run (spec:validate|stage:drift)/',
      ).not.toMatch(DOGFOOD_NPM_SCRIPTS);
    });
  });
});

// F-96d1f69d — README Multi-Agent section speaks the role contract, not
// choreography. Opus's rewrite (all 6 README variants + the 4 localized
// docs/img/<lang>/multi-agent.svg diagrams) replaced the "orchestrator
// dispatches agents" story with the role-contract framing: separation of
// duties is a declared outcome condition cladding judges from the record
// (every `clad done` / `clad verdict` completion is labeled `independent` or
// `self-certified`), and how agents run is the host's decision. This guard
// pins the same needle-genre check the rewrite must hold to, same genre as
// the orchestrator/specialist guards above.
//
// The section-slice locator is adapted from tests/readme-loop-section.test.ts
// rather than invented fresh: that file's placement test already anchors on
// the literal '## Multi-Agent' / '<h2>Multi-Agent' token (its per-variant
// translated subtitle after the mdash differs, but "Multi-Agent" itself is a
// cross-variant invariant), and its md/html next-heading markers ('\n## ' /
// '<h2') are reused verbatim as the slice's end boundary.
const README_VARIANTS: readonly string[] = ['README.md', 'README.ko.md', 'README.ja.md', 'README.zh.md', 'README.html', 'README.ko.html'];
const README_EN_KO_VARIANTS: readonly string[] = ['README.md', 'README.ko.md', 'README.html', 'README.ko.html'];

const repoRead = (rel: string): string => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const isHtmlReadme = (f: string): boolean => f.endsWith('.html');
const multiAgentStartOf = (f: string): string => (isHtmlReadme(f) ? '<h2>Multi-Agent' : '## Multi-Agent');
const nextHeadingMarkerOf = (f: string): string => (isHtmlReadme(f) ? '<h2' : '\n## ');

// Slice each variant's Multi-Agent section: from the Multi-Agent heading
// token to the next same-level heading (Ecosystem, in every variant today).
const multiAgentSliceOf = (f: string): string => {
  const body = repoRead(f);
  const start = multiAgentStartOf(f);
  const at = body.indexOf(start);
  if (at === -1) return '';
  const after = body.slice(at + start.length);
  const end = after.indexOf(nextHeadingMarkerOf(f));
  return end === -1 ? after : after.slice(0, end);
};

describe('README Multi-Agent section speaks the role contract, not choreography (F-96d1f69d)', () => {
  describe('AC-8d63da98 — no README variant describes the story as cladding dispatching/sequencing agents', () => {
    test('[covers:F-96d1f69d/AC-8d63da98] README.md: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.md');
    });
    test('[covers:F-96d1f69d/AC-8d63da98] README.ko.md: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.ko.md');
    });
    test('[covers:F-96d1f69d/AC-8d63da98] README.ja.md: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.ja.md');
    });
    test('[covers:F-96d1f69d/AC-8d63da98] README.zh.md: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.zh.md');
    });
    test('[covers:F-96d1f69d/AC-8d63da98] README.html: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.html');
    });
    test('[covers:F-96d1f69d/AC-8d63da98] README.ko.html: Multi-Agent slice matches no /dispatch/i', () => {
      expectNoDispatchInMultiAgentSlice('README.ko.html');
    });
  });

  describe('AC-0a8ea4d7 — EN/KO variants ground separation-of-duties in the evidence-based independence label', () => {
    test('[covers:F-96d1f69d/AC-0a8ea4d7] README.md: Multi-Agent slice contains both "independent" and "self-certified"', () => {
      expectSeparationLabelsInMultiAgentSlice('README.md');
    });
    test('[covers:F-96d1f69d/AC-0a8ea4d7] README.ko.md: Multi-Agent slice contains both "independent" and "self-certified"', () => {
      expectSeparationLabelsInMultiAgentSlice('README.ko.md');
    });
    test('[covers:F-96d1f69d/AC-0a8ea4d7] README.html: Multi-Agent slice contains both "independent" and "self-certified"', () => {
      expectSeparationLabelsInMultiAgentSlice('README.html');
    });
    test('[covers:F-96d1f69d/AC-0a8ea4d7] README.ko.html: Multi-Agent slice contains both "independent" and "self-certified"', () => {
      expectSeparationLabelsInMultiAgentSlice('README.ko.html');
    });
  });
});

// F-8476ccb1 — README Multi-Agent section inverts the frame in prose alone:
// yours to run, cladding's to judge. Supersedes F-4498eb3d (now archived):
// the four docs/img/<lang>/multi-agent.svg diagrams are deleted, and the
// three-shape contrast that used to live in the diagram now lives as a
// compact prose list. This block replaces the former SVG-guard describe
// ('localized multi-agent.svg diagrams draw the role contract (F-4498eb3d)')
// which asserted against files that no longer exist.
describe('README Multi-Agent section carries the inversion in prose alone (F-8476ccb1)', () => {
  describe('AC-111fb976 — opens by denying the old identity', () => {
    test('[covers:F-8476ccb1/AC-111fb976] README.md: Multi-Agent slice contains "not a multi-agent framework"', () => {
      const slice = multiAgentSliceOf('README.md');
      expect(slice, 'README.md: Multi-Agent slice must contain "not a multi-agent framework"').toContain(
        'not a multi-agent framework',
      );
    });
  });

  // Narrowed by F-3fd220d8: the invariant is that the RETIRED CAST diagram
  // (multi-agent.svg, four drafts of it, each reading as a fixed roster) never
  // returns, and that the contrast still stands as a list with no picture at
  // all. A diagram of the LABEL DECISION now ships at docs/img/<lang>/
  // independence.svg — a different drawing at a different path, guarded below.
  describe('AC-7d433517 — the retired cast diagram stays gone; the contrast stands as a list', () => {
    for (const f of README_VARIANTS) {
      test(`${f}: does not match /multi-agent\\.svg/`, () => {
        const body = repoRead(f);
        expect(body, `${f}: must not match /multi-agent\\.svg/`).not.toMatch(/multi-agent\.svg/);
      });
    }

    test('[covers:F-3fd220d8/AC-6b0a1f74][covers:F-8476ccb1/AC-7d433517] README.md: Multi-Agent slice presents the three-shape contrast as a list (>= 3 lines starting with "- ")', () => {
      const slice = multiAgentSliceOf('README.md');
      const listLines = slice.split('\n').filter((line) => line.startsWith('- '));
      expect(
        listLines.length,
        'README.md: Multi-Agent slice must contain at least 3 lines starting with "- "',
      ).toBeGreaterThanOrEqual(3);
    });
  });
});

// F-3fd220d8 — the section reads plainly and draws the label decision.
//
// The prior inversion (F-8476ccb1) fixed the framing but left a comprehension
// defect: a yes/no question ("was it checked by someone else?") answered with
// three examples carrying only two labels, with nothing saying that two of the
// three land on the SAME label. A reader counts three, counts two, and stalls.
// These guards pin the repair — labels named before the examples, the two
// self-certified cases adjacent with the last one marked as sharing the label,
// the mechanism stated as tool reach rather than assurance, and the
// non-accusation clause — plus the new locale diagram of the label decision.
const MULTIAGENT_NEEDLES: Readonly<
  Record<string, {stakes: string; sameness: string; noCodeAccess: string; notAnAccusation: string}>
> = {
  'README.md': {
    stakes: 'proves nothing',
    sameness: 'as well',
    noCodeAccess: 'no way to open the code',
    notAnAccusation: "isn't a mark against the work",
  },
  'README.html': {
    stakes: 'proves nothing',
    sameness: 'as well',
    noCodeAccess: 'no way to open the code',
    notAnAccusation: "isn't a mark against the work",
  },
  'README.ko.md': {
    stakes: '아무것도 증명하지 못하는',
    sameness: '마찬가지로',
    noCodeAccess: '코드는 못 본 채',
    notAnAccusation: '잘못했다는 뜻이 아니다',
  },
  'README.ko.html': {
    stakes: '아무것도 증명하지 못하는',
    sameness: '마찬가지로',
    noCodeAccess: '코드는 못 본 채',
    notAnAccusation: '잘못했다는 뜻이 아니다',
  },
};

const INDEPENDENCE_SVG_LOCALES: readonly string[] = ['en', 'ko', 'ja', 'zh'];
// First list item of a Multi-Agent slice, md ('- ' line) or html ('<li>').
const firstListItemIndexOf = (f: string, slice: string): number =>
  isHtmlReadme(f) ? slice.indexOf('<li>') : slice.indexOf('\n- ');

// The slice's example items in document order, md ('- ' lines) or html (<li> bodies).
const listItemsOf = (f: string, slice: string): readonly string[] =>
  isHtmlReadme(f)
    ? [...slice.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => m[1]!)
    : slice.split('\n').filter((line) => line.startsWith('- '));

const expectNoDispatchInMultiAgentSlice = (f: string): void => {
  const slice = multiAgentSliceOf(f);
  expect(slice.length, `${f}: Multi-Agent section heading must be found (non-empty slice)`).toBeGreaterThan(0);
  expect(slice, `${f}: Multi-Agent slice must not match /dispatch/i`).not.toMatch(/dispatch/i);
};

const expectSeparationLabelsInMultiAgentSlice = (f: string): void => {
  const slice = multiAgentSliceOf(f);
  expect(slice, `${f}: Multi-Agent slice must contain "independent"`).toContain('independent');
  expect(slice, `${f}: Multi-Agent slice must contain "self-certified"`).toContain('self-certified');
};

const expectNoCodeAccessInMultiAgentSlice = (f: string): void => {
  const slice = multiAgentSliceOf(f);
  const {noCodeAccess} = MULTIAGENT_NEEDLES[f]!;
  expect(slice, `${f}: must explain independence as what the test writer can reach ("${noCodeAccess}")`).toContain(
    noCodeAccess,
  );
};

const expectNonAccusationInMultiAgentSlice = (f: string): void => {
  const slice = multiAgentSliceOf(f);
  const {notAnAccusation} = MULTIAGENT_NEEDLES[f]!;
  expect(slice, `${f}: must contain the non-accusation clause ("${notAnAccusation}")`).toContain(notAnAccusation);
};

const expectLocaleDiagramInMultiAgentSlice = (f: string, locale: string): void => {
  const slice = multiAgentSliceOf(f);
  expect(slice, `${f}: Multi-Agent slice must embed docs/img/${locale}/independence.svg`).toContain(
    `docs/img/${locale}/independence.svg`,
  );
};

describe('README Multi-Agent section reads plainly and draws the label decision (F-3fd220d8)', () => {
  describe('AC-6b0a1f74 — the stake lands before any label, and the list ends on the way out', () => {
    for (const f of README_EN_KO_VARIANTS) {
      test(`${f}: the green-run-proves-nothing problem is stated before the first list item`, () => {
        const slice = multiAgentSliceOf(f);
        const firstItem = firstListItemIndexOf(f, slice);
        const {stakes} = MULTIAGENT_NEEDLES[f]!;
        expect(firstItem, `${f}: Multi-Agent slice must contain a list`).toBeGreaterThan(0);
        const stakesAt = slice.indexOf(stakes);
        expect(
          stakesAt,
          `${f}: the section must open with why the question matters — one AI writing both code and tests makes a green run prove nothing ("${stakes}")`,
        ).toBeGreaterThan(-1);
        expect(stakesAt, `${f}: the stake must land before the examples, not after them`).toBeLessThan(firstItem);
      });

      test(`${f}: two adjacent self-certified cases, marked as sharing a label, then independent last`, () => {
        const items = listItemsOf(f, multiAgentSliceOf(f));
        const {sameness} = MULTIAGENT_NEEDLES[f]!;
        expect(items.length, `${f}: expected at least 3 example items`).toBeGreaterThanOrEqual(3);
        const [first, second] = items;
        const last = items[items.length - 1]!;
        expect(first, `${f}: the first example must land on self-certified`).toContain('self-certified');
        expect(second, `${f}: the second example must also land on self-certified`).toContain('self-certified');
        expect(
          second,
          `${f}: the second self-certified case must say it shares the label ("${sameness}"), so two examples mapping to one label never reads as a contradiction`,
        ).toContain(sameness);
        expect(
          last,
          `${f}: the list must close on the independent case, so the way out is the last thing read`,
        ).toContain('independent');
      });
    }
  });

  describe('AC-c1e7a3b5 — independence is explained as tool reach, and self-certified is explained as absence, not fault', () => {
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.md: states the test writer has no means of opening the code', () => {
      expectNoCodeAccessInMultiAgentSlice('README.md');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.ko.md: states the test writer has no means of opening the code', () => {
      expectNoCodeAccessInMultiAgentSlice('README.ko.md');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.html: states the test writer has no means of opening the code', () => {
      expectNoCodeAccessInMultiAgentSlice('README.html');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.ko.html: states the test writer has no means of opening the code', () => {
      expectNoCodeAccessInMultiAgentSlice('README.ko.html');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.md: says self-certified is not an accusation', () => {
      expectNonAccusationInMultiAgentSlice('README.md');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.ko.md: says self-certified is not an accusation', () => {
      expectNonAccusationInMultiAgentSlice('README.ko.md');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.html: says self-certified is not an accusation', () => {
      expectNonAccusationInMultiAgentSlice('README.html');
    });
    test('[covers:F-3fd220d8/AC-c1e7a3b5] README.ko.html: says self-certified is not an accusation', () => {
      expectNonAccusationInMultiAgentSlice('README.ko.html');
    });
  });

  describe('AC-4d92c806 — the locale diagram draws the label decision, never a roster', () => {
    for (const locale of INDEPENDENCE_SVG_LOCALES) {
      const rel = `docs/img/${locale}/independence.svg`;
      test(`${rel}: exists, carries both labels, and names no roster`, () => {
        const body = repoRead(rel);
        expect(body.length, `${rel}: must exist and be non-empty`).toBeGreaterThan(0);
        expect(body, `${rel}: must contain "independent"`).toContain('independent');
        expect(body, `${rel}: must contain "self-certified"`).toContain('self-certified');
        expect(body, `${rel}: must not match /dispatch/i anywhere, comments included`).not.toMatch(/dispatch/i);
        expect(body, `${rel}: must not match /orchestrat/i anywhere, comments included`).not.toMatch(/orchestrat/i);
      });
    }
  });

  describe('AC-83f1ba27 — each variant embeds its own locale diagram', () => {
    test('[covers:F-3fd220d8/AC-83f1ba27] README.md: references docs/img/en/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.md', 'en');
    });
    test('[covers:F-3fd220d8/AC-83f1ba27] README.html: references docs/img/en/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.html', 'en');
    });
    test('[covers:F-3fd220d8/AC-83f1ba27] README.ko.md: references docs/img/ko/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.ko.md', 'ko');
    });
    test('[covers:F-3fd220d8/AC-83f1ba27] README.ko.html: references docs/img/ko/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.ko.html', 'ko');
    });
    test('[covers:F-3fd220d8/AC-83f1ba27] README.ja.md: references docs/img/ja/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.ja.md', 'ja');
    });
    test('[covers:F-3fd220d8/AC-83f1ba27] README.zh.md: references docs/img/zh/independence.svg', () => {
      expectLocaleDiagramInMultiAgentSlice('README.zh.md', 'zh');
    });
  });
});

describe('static proof carriers for role-contract surfaces', () => {
  test('[covers:F-3fd220d8/AC-4d92c806] every localized independence diagram carries the decision, not a roster', () => {
    for (const locale of INDEPENDENCE_SVG_LOCALES) {
      const body = repoRead(`docs/img/${locale}/independence.svg`);
      expect(body.length).toBeGreaterThan(0);
      expect(body).toContain('hostband');
      expect(body).toContain('The single question');
      expect(body).toContain('independent');
      expect(body).toContain('self-certified');
      expect(body).toContain('independence_policy: require');
      expect(body).not.toMatch(/dispatch|orchestrat/i);
    }
  });

  test('[covers:F-ef93141b/AC-163773ad] every specialist source is a selectable role brief', () => {
    for (const {srcPath} of SPECIALIST_PERSONAS) {
      const body = readFileSync(srcPath, 'utf8');
      expect(body).toMatch(ROLE_BRIEF);
      expect(body).toMatch(/not an agent cladding mandates spawning|host[\s\S]*?agent shape/i);
    }
  });

  test('[covers:F-ef93141b/AC-46fef26f] specialist role briefs exclude every removed choreography needle', () => {
    for (const {srcPath} of SPECIALIST_PERSONAS) {
      const body = readFileSync(srcPath, 'utf8');
      for (const {pattern} of SPECIALIST_BANNED_NEEDLES) expect(body).not.toMatch(pattern);
    }
  });
});
