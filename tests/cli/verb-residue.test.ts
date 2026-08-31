// Cladding · verb-rename residue sweep — regression suite for F-b8d74801.
//
// The 0.6.0 verb rename (refine→clarify, drive→run, panel→status) left
// residue in provenance banners, detector remediation messages, pinned
// fixtures, and the docs banner table — a first-run trust break where a new
// user is told to run a command that no longer exists. This suite pins the
// four acceptance criteria of the closing sweep.
//
// TEST-AUTHOR NOTE (anti-self-certification): authored from the shard's
// acceptance_criteria + the module signatures only. The implementation diff
// was NOT read.
//
// SELF-EXCLUSION (AC-7026c2e7 trap): the tripwire below walks src/**/*.ts AND
// tests/**/*.ts — i.e. it walks THIS FILE too. To keep that honest this file
// contains ZERO literal occurrences of the three removed two-word verb
// phrases; every such phrase is assembled at runtime from parts (see
// `REMOVED`). No path-based exclusion is used — including this file in the
// walk keeps the ">100 files" vacuous-walk guard honest and proves the
// runtime construction is sound (if a literal ever crept in, the tripwire
// scanning this file would catch it).

import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

import {runInit} from '../../src/cli/init.js';
import {
  renderGreenfieldArchitectureYaml,
  renderGreenfieldCapabilitiesYaml,
  renderGreenfieldConventionsMd,
} from '../../src/cli/scan/greenfield-seeds.js';
import {
  deterministicOnboarding,
  interpretOnboardingWithFallback,
  type OnboardingObserved,
} from '../../src/cli/scan/intent-onboarding.js';
import {
  loadState,
  saveState,
  type OnboardingState,
} from '../../src/cli/scan/onboarding-state.js';
import {extractTierFromDoc} from '../../src/graph/model.js';
import {linkCapability} from '../../src/spec/new.js';
import {specConformance} from '../../src/stages/detectors/spec-conformance.js';

// ───────────────────────── runtime-assembled needles ─────────────────────────
// The literal phrases never appear in this file's source; they are built here.
const CLAD = 'clad';
const REMOVED_VERBS = ['refine', 'drive', 'panel'] as const;
/** The three removed two-word verb phrases, assembled at runtime (never literal here). */
const REMOVED: readonly string[] = REMOVED_VERBS.map((v) => `${CLAD} ${v}`);
/** The pre-0.6.0 refresh clause (init + the first removed verb), assembled at runtime. */
const OLD_REFINE_CLAUSE = `${CLAD} init / ${CLAD} ${REMOVED_VERBS[0]}`;

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

/** Recursively collect files matching an extension, skipping build/vendor dirs. */
function walk(dir: string, exts: readonly string[], acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(full);
  }
  return acc;
}

/** Returns every {file, needle} hit for the given needles across the file set. */
function scanForNeedles(
  files: readonly string[],
  needles: readonly string[],
): {file: string; needle: string}[] {
  const hits: {file: string; needle: string}[] = [];
  for (const f of files) {
    const content = readFileSync(f, 'utf8');
    for (const n of needles) if (content.includes(n)) hits.push({file: f, needle: n});
  }
  return hits;
}

/** Asserts a string names no removed verb. */
function expectNoRemovedVerbs(s: string, label: string): void {
  for (const n of REMOVED) {
    expect(s.includes(n), `${label} must not name a removed verb ("${n}")`).toBe(false);
  }
}

function tmp(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `clad-verb-residue-${prefix}-`));
}

const observed = (): OnboardingObserved => ({
  cwdBasename: 'demo',
  language: 'typescript',
  sourceFileCount: 0,
  readmePresent: false,
  readmeFirstParagraph: null,
  projectName: 'demo',
});

function stubDispatcher(response: string) {
  return async (_prompt: string): Promise<string> => response;
}

/** A parsable onboarding LLM response with all mandatory sentinels non-blank. */
function onboardingResponse(capabilitiesBody = 'schema: "0.1"\nsource: intent\ncapabilities: []'): string {
  return [
    '=== ONBOARDING_MODE ===', 'greenfield', '',
    '=== PROJECT_CONTEXT_MD ===', '# Demo Project', '', 'A body paragraph describing purpose.', '',
    '=== CAPABILITIES_YAML ===', capabilitiesBody, '',
    '=== ARCHITECTURE_YAML ===', 'layers: []', '',
    '=== SPEC_SEED_TITLE ===', 'First feature', '',
  ].join('\n');
}

const sampleState = (): OnboardingState => ({
  intent: 'demo intent',
  language: 'typescript',
  projectName: 'demo',
  mode: 'greenfield',
  startedAt: '2026-01-01T00:00:00Z',
  status: 'active',
  qa: [{question: 'q1', answer: null}],
});

/** The `# Cladding · ` / `<!-- Cladding · ` prefix, sliced from a real emitter
 *  banner so the middle-dot bytes are guaranteed correct for the recognizers. */
function claddingPrefix(currentBanner: string): string {
  const i = currentBanner.indexOf('Tier');
  return currentBanner.slice(0, i);
}

const firstLine = (s: string): string => s.split('\n')[0];

// ══════════════════════════════════════════════════════════════════════════
// AC-7026c2e7 — tripwire: no removed verb phrase under src/ or tests/ (.ts)
//               or docs/ssot-model.md.
// ══════════════════════════════════════════════════════════════════════════
describe('AC-7026c2e7 — removed-verb tripwire', () => {
  test('[covers:F-b8d74801/AC-7026c2e7] src/**/*.ts, tests/**/*.ts and docs/ssot-model.md name zero removed verbs', () => {
    const files = [
      ...walk(join(ROOT, 'src'), ['.ts']),
      ...walk(join(ROOT, 'tests'), ['.ts']),
      join(ROOT, 'docs/ssot-model.md'),
    ];
    // Vacuous-walk guard: an empty/failed walk must not pass silently.
    expect(files.length).toBeGreaterThan(100);
    const hits = scanForNeedles(files, REMOVED);
    expect(hits, `removed verb phrases found:\n${JSON.stringify(hits, null, 2)}`).toEqual([]);
  });

  test('the scanner is non-vacuous — a planted needle is detected (negative control)', () => {
    const dir = tmp('neg');
    try {
      // Content carries a needle assembled at runtime (no literal in this source).
      writeFileSync(join(dir, 'bad.ts'), `// legacy hint: run ${REMOVED[0]} first\nexport {};\n`);
      writeFileSync(join(dir, 'clean.ts'), '// nothing to see\nexport {};\n');
      const hits = scanForNeedles(walk(dir, ['.ts']), REMOVED);
      expect(hits).toHaveLength(1);
      expect(hits[0].needle).toBe(REMOVED[0]);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-2f20bc65 — emitted banners & detector messages name only current verbs.
//               Driven through the real emitters wherever a seam exists.
// ══════════════════════════════════════════════════════════════════════════
describe('AC-2f20bc65 — emitters name only current verbs', () => {
  test('greenfield architecture seed banner → clad clarify, no removed verb', () => {
    const banner = firstLine(renderGreenfieldArchitectureYaml('typescript'));
    expect(banner).toContain('clad clarify');
    expectNoRemovedVerbs(banner, 'architecture seed banner');
  });

  test('greenfield capabilities seed banner → clad clarify, no removed verb', () => {
    const banner = firstLine(renderGreenfieldCapabilitiesYaml('demo'));
    expect(banner).toContain('clad clarify');
    expectNoRemovedVerbs(banner, 'capabilities seed banner');
  });

  test('greenfield conventions seed header → clad init --scan, no removed verb', () => {
    const header = firstLine(renderGreenfieldConventionsMd('typescript', 'demo'));
    expect(header).toContain('clad init --scan');
    expectNoRemovedVerbs(header, 'conventions seed header');
  });

  test('onboarding-state banner (saveState) → clad clarify, no removed verb', () => {
    const dir = tmp('state');
    try {
      saveState(dir, sampleState());
      const banner = firstLine(readFileSync(join(dir, '.cladding/onboarding/state.yaml'), 'utf8'));
      expect(banner).toContain('clad clarify');
      expectNoRemovedVerbs(banner, 'state.yaml banner');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('capabilities.yaml header (linkCapability) → clad clarify, no removed verb', () => {
    const dir = tmp('link');
    try {
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: link\n  language: typescript\n');
      linkCapability({cwd: dir, capability: 'auth', feature: 'F-abcdef12'});
      const banner = firstLine(readFileSync(join(dir, 'spec/capabilities.yaml'), 'utf8'));
      expect(banner).toContain('clad clarify');
      expectNoRemovedVerbs(banner, 'linkCapability header');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('deterministic onboarding project-context header → clad clarify, no removed verb', () => {
    const banner = firstLine(deterministicOnboarding('build a thing', observed()).projectContextMd);
    expect(banner).toContain('clad clarify');
    expectNoRemovedVerbs(banner, 'deterministic project-context header');
  });

  test('LLM onboarding banners (project-context + tier-B yaml) → clad clarify, no removed verb', async () => {
    const r = await interpretOnboardingWithFallback('build a thing', observed(), stubDispatcher(onboardingResponse()));
    const pc = firstLine(r.projectContextMd);
    expect(pc).toContain('clad clarify');
    expect(firstLine(r.capabilitiesYaml)).toContain('clad clarify');
    expect(firstLine(r.architectureYaml)).toContain('clad clarify');
    expectNoRemovedVerbs(r.projectContextMd, 'onboarding project-context');
    expectNoRemovedVerbs(r.capabilitiesYaml, 'onboarding capabilities');
    expectNoRemovedVerbs(r.architectureYaml, 'onboarding architecture');
  });

  test('init-emitted spec.yaml Tier A banner names no removed verb (clad_create_feature / manual)', async () => {
    const dir = tmp('init');
    try {
      await runInit({cwd: dir});
      const banner = firstLine(readFileSync(join(dir, 'spec.yaml'), 'utf8'));
      expect(banner).toContain('clad_create_feature');
      expectNoRemovedVerbs(banner, 'spec.yaml banner');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('scenario Tier A banner (init.ts + clarify.ts) → clad clarify, no removed verb', () => {
    for (const f of ['src/cli/init.ts', 'src/cli/clarify.ts']) {
      const line = read(f).split('\n').find((l) => l.includes('onboarding output, edit-friendly'));
      expect(line, `${f} should emit the scenario Tier A banner`).toBeTruthy();
      expect(line as string).toContain('clad clarify');
      expectNoRemovedVerbs(line as string, `${f} scenario banner`);
    }
  });

  test('run-loop auto-stub string names clad run, no removed verb', () => {
    const src = read('src/drive/loop.ts');
    expect(src).toContain('auto-stub created by clad run');
    expectNoRemovedVerbs(src, 'src/drive/loop.ts');
  });

  test('spec-conformance "no clad run history" message names clad run, no removed verb', () => {
    // Drive the detector to its info branch: an oracle mandate is active, a
    // done AC declares a resolvable oracle with a provenance record, but NO
    // implementer identity is recorded — so author≠implementer can't be
    // verified and the message names the current run verb.
    const dir = tmp('conf');
    try {
      mkdirSync(join(dir, 'tests/oracle'), {recursive: true});
      writeFileSync(
        join(dir, 'tests/oracle/foo.test.ts'),
        "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));\n",
      );
      mkdirSync(join(dir, '.cladding'), {recursive: true});
      const oracleEv = {
        id: 'ev-o', featureId: 'F-001', acId: 'AC-001', stage: 'stage_2.3',
        identity: {author: 'llm', name: 'oracle-model', timestamp: '2026-06-02T00:00:00Z'},
        kind: 'oracle', content: 'oracle authored', artifact: 'tests/oracle/foo.test.ts',
        readManifest: [], blind: true,
      };
      // ONLY an oracle record — deliberately no implementer evidence.
      writeFileSync(join(dir, '.cladding/audit.log.jsonl'), `${JSON.stringify(oracleEv)}\n`);
      writeFileSync(
        join(dir, 'spec.yaml'),
        'schema: "0.1"\nproject: {name: f, language: typescript, require_oracles: true}\nfeatures:\n' +
          '  - id: F-001\n    title: f\n    status: done\n    acceptance_criteria:\n' +
          '      - id: AC-001\n        ears: ubiquitous\n        text: t\n' +
          '        oracle_refs: [tests/oracle/foo.test.ts]\n',
      );
      const findings = specConformance.run({cwd: dir}).filter((f) => f.detector === 'SPEC_CONFORMANCE');
      const info = findings.find((f) => f.severity === 'info' && f.message.includes('no clad run history to compare'));
      expect(info, `expected the info message; got ${JSON.stringify(findings)}`).toBeTruthy();
      expect((info as {message: string}).message).toContain('clad run');
      expectNoRemovedVerbs(findings.map((f) => f.message).join('\n'), 'spec-conformance messages');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-fd3a02a3 — adopter files carrying pre-0.6.0 banners stay valid: banner
//               recognition is prefix-based; old & new classify identically.
// ══════════════════════════════════════════════════════════════════════════
describe('AC-fd3a02a3 — pre-0.6.0 banner recognition is prefix-based', () => {
  // Prefixes sliced from live emitters → recognizer-critical bytes are correct.
  const yamlPrefix = claddingPrefix(firstLine(renderGreenfieldArchitectureYaml('typescript'))); // "# Cladding · "
  const mdPrefix = claddingPrefix(firstLine(renderGreenfieldConventionsMd('typescript', 'demo'))); // "<!-- Cladding · "

  test('TIER_BANNER_RE (extractTierFromDoc) classifies old & new banners identically', () => {
    const dir = tmp('tier');
    try {
      const oldYaml = `${yamlPrefix}Tier B — editable, cross-validated · Refreshed by: ${OLD_REFINE_CLAUSE}`;
      const newYaml = `${yamlPrefix}Tier B · SSoT — editable, cross-validated · Refreshed by: ${CLAD} init / ${CLAD} clarify`;
      const oldMd = `${mdPrefix}Tier B — intent + Why/What/Purpose · Refreshed by: ${OLD_REFINE_CLAUSE} -->`;
      const newMd = `${mdPrefix}Tier B · SSoT — intent + Why/What/Purpose · Refreshed by: ${CLAD} init / ${CLAD} clarify -->`;
      writeFileSync(join(dir, 'old.yaml'), `${oldYaml}\nlayers: []\n`);
      writeFileSync(join(dir, 'new.yaml'), `${newYaml}\nlayers: []\n`);
      writeFileSync(join(dir, 'old.md'), `${oldMd}\n\nbody\n`);
      writeFileSync(join(dir, 'new.md'), `${newMd}\n\nbody\n`);
      // Old and new classify to the SAME tier — recognition is verb-independent.
      expect(extractTierFromDoc('old.yaml', dir)).toBe('B');
      expect(extractTierFromDoc('new.yaml', dir)).toBe('B');
      expect(extractTierFromDoc('old.md', dir)).toBe('B');
      expect(extractTierFromDoc('new.md', dir)).toBe('B');
      expect(extractTierFromDoc('old.yaml', dir)).toBe(extractTierFromDoc('new.yaml', dir));
      expect(extractTierFromDoc('old.md', dir)).toBe(extractTierFromDoc('new.md', dir));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('ensureTierBBannerYaml (onboarding) preserves an adopter\'s old banner, prefix-based', async () => {
    const oldBanner = `${yamlPrefix}Tier B — editable, cross-validated · Refreshed by: ${OLD_REFINE_CLAUSE}`;
    const newBanner = firstLine(renderGreenfieldArchitectureYaml('typescript')); // current, real banner
    const oldR = await interpretOnboardingWithFallback(
      'x', observed(), stubDispatcher(onboardingResponse(`${oldBanner}\nschema: "0.1"\ncapabilities: []`)));
    const newR = await interpretOnboardingWithFallback(
      'x', observed(), stubDispatcher(onboardingResponse(`${newBanner}\nschema: "0.1"\ncapabilities: []`)));
    // Old banner recognized as already-present → preserved verbatim, not
    // stripped or double-bannered. New banner handled identically.
    expect(oldR.capabilitiesYaml.startsWith(oldBanner)).toBe(true);
    expect(newR.capabilitiesYaml.startsWith(newBanner)).toBe(true);
    expect(oldR.capabilitiesYaml.startsWith('# Cladding · ')).toBe(
      newR.capabilitiesYaml.startsWith('# Cladding · '),
    );
  });

  test('onboarding-state recognizes a pre-0.6.0 file: loadState round-trips, prefix verb-free', () => {
    const dir = tmp('adopter');
    try {
      const oldBanner = `${yamlPrefix}Tier D — transient — Q&A audit · Refreshed by: ${OLD_REFINE_CLAUSE}`;
      mkdirSync(join(dir, '.cladding/onboarding'), {recursive: true});
      writeFileSync(
        join(dir, '.cladding/onboarding/state.yaml'),
        `${oldBanner}\nintent: legacy\nlanguage: typescript\nprojectName: demo\n` +
          'mode: greenfield\nstartedAt: \'2026-01-01T00:00:00Z\'\nstatus: active\nqa:\n' +
          '  - question: q1\n    answer: null\n',
      );
      // The adopter's pre-0.6.0 file is still readable (comment banner ignored).
      const loaded = loadState(dir);
      expect(loaded).not.toBeNull();
      expect((loaded as OnboardingState).intent).toBe('legacy');
      // saveState re-emits the CURRENT banner while preserving data.
      saveState(dir, loaded as OnboardingState);
      const reBanner = firstLine(readFileSync(join(dir, '.cladding/onboarding/state.yaml'), 'utf8'));
      expect(reBanner).toContain('clad clarify');
      expectNoRemovedVerbs(reBanner, 're-saved state banner');
      // The recognition prefix is verb-free: old & new banners both satisfy it,
      // so an adopter's old banner classifies exactly like a current one.
      expect(oldBanner.startsWith('# Cladding · ')).toBe(true);
      expect(reBanner.startsWith('# Cladding · ')).toBe(true);
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// AC-a527f028 — the docs/ssot-model.md banner table matches emitted banners.
// ══════════════════════════════════════════════════════════════════════════
describe('AC-a527f028 — docs banner table matches emitters', () => {
  /** Everything after "Refreshed by:" up to the closing `-->` / end of line. */
  const refreshedBy = (banner: string): string => {
    const m = banner.match(/Refreshed by:\s*(.+?)\s*(?:-->\s*)?$/);
    return m ? m[1].trim() : '';
  };
  const tierOf = (banner: string): string => {
    const m = banner.match(/Tier\s+([A-D])\b/);
    return m ? m[1] : '';
  };

  /** Parse the `| \`path\` | \`banner\` |` rows of the "### Examples" table. */
  function parseBannerTable(): Map<string, string> {
    const lines = read('docs/ssot-model.md').split('\n');
    const start = lines.findIndex((l) => l.trim() === '### Examples');
    expect(start, 'the "### Examples" banner table must exist').toBeGreaterThanOrEqual(0);
    const out = new Map<string, string>();
    for (let i = start + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) break; // next section ends the table
      const m = lines[i].match(/^\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/);
      if (m) out.set(m[1], m[2]);
    }
    return out;
  }

  test('[covers:F-b8d74801/AC-a527f028] every documented banner matches its emitter (verb clause + tier), no removed verbs', async () => {
    const table = parseBannerTable();

    // Live banners from the real emitters, keyed by the documented path.
    const initDir = tmp('doc-init');
    const stateDir = tmp('doc-state');
    let specBanner: string;
    let stateBanner: string;
    try {
      await runInit({cwd: initDir});
      specBanner = firstLine(readFileSync(join(initDir, 'spec.yaml'), 'utf8'));
      saveState(stateDir, sampleState());
      stateBanner = firstLine(readFileSync(join(stateDir, '.cladding/onboarding/state.yaml'), 'utf8'));
    } finally {
      rmSync(initDir, {recursive: true, force: true});
      rmSync(stateDir, {recursive: true, force: true});
    }
    const pcBanner = firstLine(
      (await interpretOnboardingWithFallback('x', observed(), stubDispatcher(onboardingResponse()))).projectContextMd,
    );
    const scenarioBanner = (read('src/cli/init.ts').split('\n').find((l) => l.includes('onboarding output, edit-friendly')) ?? '')
      .replace(/^\s*'|',?\s*$/g, ''); // strip the source-literal quoting

    // exact:false where the emitter legitimately injects extra text (the
    // greenfield conventions seed appends "(greenfield seed for <lang>)").
    const live: Record<string, {banner: string; exact: boolean}> = {
      'spec.yaml': {banner: specBanner, exact: true},
      'spec/architecture.yaml': {banner: firstLine(renderGreenfieldArchitectureYaml('typescript')), exact: true},
      'spec/capabilities.yaml': {banner: firstLine(renderGreenfieldCapabilitiesYaml('demo')), exact: true},
      'spec/scenarios/<slug>-<hash8>.yaml': {banner: scenarioBanner, exact: true},
      'docs/project-context.md': {banner: pcBanner, exact: true},
      'docs/conventions.md': {banner: firstLine(renderGreenfieldConventionsMd('typescript', 'demo')), exact: false},
      '.cladding/onboarding/state.yaml': {banner: stateBanner, exact: true},
    };

    for (const [path, {banner, exact}] of Object.entries(live)) {
      const documented = table.get(path);
      expect(documented, `docs/ssot-model.md banner table must document ${path}`).toBeTruthy();
      const doc = documented as string;
      // Load-bearing: the verb clause and the tier letter must match exactly.
      expect(refreshedBy(doc), `${path}: Refreshed-by clause`).toBe(refreshedBy(banner));
      expect(tierOf(doc), `${path}: tier letter`).toBe(tierOf(banner));
      // Neither the doc nor the emitted banner may name a removed verb.
      expectNoRemovedVerbs(doc, `documented ${path} banner`);
      expectNoRemovedVerbs(banner, `emitted ${path} banner`);
      // Where the emitter reproduces the banner verbatim, pin full equality.
      if (exact) expect(doc, `${path}: full banner`).toBe(banner);
    }
  });
});
