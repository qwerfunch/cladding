// Cladding · README loop-engineering section pins (F-49facde9)
//
// Dogfood self-check (sibling home: tests/readme-record-honesty.test.ts at the
// tests root, kept in a separate file for clean test_refs). Backlog B8 added a
// loop-engineering section positioning cladding as the agent loop's verifier +
// state layer — the honest frame (verification signal + earned stop + local
// memory) the A/B program can defend, replacing correctness claims it refuted.
// These pins hold all four README variants at EN/KO parity and consistent
// placement, and sweep the loop-memory claim clean of the two universals it
// must never make (every gate run recorded / audit trail).
//
// cladding-SELF pins (they read this repo's own READMEs), NOT shipped detectors.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const EN_MD = 'README.md';
const KO_MD = 'README.ko.md';
const EN_HTML = 'README.html';
const KO_HTML = 'README.ko.html';
const MD_VARIANTS = [EN_MD, KO_MD];
const HTML_VARIANTS = [EN_HTML, KO_HTML];
const ALL_VARIANTS = [...MD_VARIANTS, ...HTML_VARIANTS];

// The section heading per variant — both the presence pin and the slice anchor.
const HEADING: Record<string, string> = {
  [EN_MD]: '## cladding backs your AI loop',
  [KO_MD]: '## cladding이 당신의 AI 루프를 받쳐 준다',
  [EN_HTML]: '<h2>cladding backs your AI loop</h2>',
  [KO_HTML]: '<h2>cladding이 당신의 AI 루프를 받쳐 준다</h2>',
};

const isHtml = (f: string): boolean => f.endsWith('.html');
const isKo = (f: string): boolean => f.includes('.ko.');
// End-of-section marker: the next same-level heading.
const nextHeadingOf = (f: string): string => (isHtml(f) ? '<h2>' : '\n## ');

// Slice the loop section: from its heading up to the next same-level heading.
const sectionOf = (f: string): string => {
  const body = read(f);
  const heading = HEADING[f];
  const start = body.indexOf(heading);
  if (start === -1) return '';
  const after = body.slice(start + heading.length);
  const end = after.indexOf(nextHeadingOf(f));
  return end === -1 ? after : after.slice(0, end);
};

describe('AC-a101072b · all four README variants carry the loop-engineering section', () => {
  test('every variant heads the section (EN "cladding backs your AI loop", KO "받쳐 준다") — files-visited === 4', () => {
    let visited = 0;
    for (const f of ALL_VARIANTS) {
      visited += 1;
      expect(read(f), `${f}: loop section heading`).toContain(HEADING[f]);
    }
    expect(visited, 'the sweep visits exactly the four README variants').toBe(4);
  });

  test('every variant carries the three loop anchors: feedback signal, honest stop, loop memory', () => {
    for (const f of ALL_VARIANTS) {
      const section = sectionOf(f);
      // Feedback signal — the machine-readable check command (all variants).
      expect(section, `${f}: clad check --json feedback anchor`).toContain('clad check --json');
      // Honest stop — the flip-gate-revert phrasing.
      expect(section, `${f}: honest-stop phrase`).toContain(isKo(f) ? '게이트가 통과시켰다' : 'the gate let it stand');
      // Loop memory — the local event log.
      expect(section, `${f}: loop-memory event-log anchor`).toContain('.cladding/events.log.jsonl');
    }
  });
});

describe('AC-1660fbaa · the loop-memory claim makes no falsifiable universal about the ledger', () => {
  // Needles are assembled from fragments at runtime, so this pin file never
  // contains a literal forbidden phrase — a future repo-wide honesty sweep must
  // not trip on its own test (the tests/readme-record-honesty.test.ts precedent).
  // The section is honest: gate_run dedupes per HEAD (so not "every run") and
  // the log is a local rotating file (so not an "audit trail"). A whole-file
  // scan is safe because these strings appear NOWHERE in the four READMEs
  // today, so any positive claim would be a regression the sweep catches.
  const asm = (parts: string[]): string => parts.join('');
  const NEEDLES: string[] = [
    asm(['every ', 'gate ', 'run']),
    asm(['모든 ', '게이트 ', '실행']),
    asm(['audit ', 'trail']),
    asm(['감사 ', '추적']),
  ];
  const scan = (corpus: string): string[] => NEEDLES.filter((n) => corpus.includes(n));

  test('no README variant makes the every-run / audit-trail overclaim (files-visited === 4)', () => {
    let visited = 0;
    const hits: string[] = [];
    for (const f of ALL_VARIANTS) {
      visited += 1;
      for (const n of scan(read(f))) hits.push(`${f} :: ${n}`);
    }
    expect(visited, 'the sweep visits exactly the four README variants').toBe(4);
    expect(hits, `forbidden universal(s) found: ${hits.join(' | ')}`).toEqual([]);
  });

  test('planted-needle control — the scanner has teeth (clean=[], poisoned=[needle])', () => {
    const planted = asm(['audit ', 'trail']);
    expect(scan('honest local rotating loop memory'), 'clean corpus -> no hits').toEqual([]);
    expect(scan(`prose ... ${planted} ... prose`), 'poisoned corpus -> planted needle caught').toContain(planted);
  });
});

describe('AC-f3e3d35d · EN/KO parity and consistent placement across markdown and HTML', () => {
  test('both markdown variants have exactly three bullets in the section', () => {
    for (const f of MD_VARIANTS) {
      const bullets = sectionOf(f).match(/^- /gm) ?? [];
      expect(bullets.length, `${f}: three loop-section bullets`).toBe(3);
    }
  });

  test('both HTML variants have exactly three list items in the section', () => {
    for (const f of HTML_VARIANTS) {
      const items = sectionOf(f).match(/<li>/g) ?? [];
      expect(items.length, `${f}: three loop-section list items`).toBe(3);
    }
  });

  test('the loop section precedes the Multi-Agent section in every variant (consistent placement)', () => {
    for (const f of ALL_VARIANTS) {
      const body = read(f);
      const here = body.indexOf(HEADING[f]);
      expect(here, `${f}: loop section present`).toBeGreaterThan(0);
      const multiAgent = body.indexOf(isHtml(f) ? '<h2>Multi-Agent' : '## Multi-Agent', here);
      expect(multiAgent, `${f}: Multi-Agent section follows the loop section`).toBeGreaterThan(here);
    }
  });
});
