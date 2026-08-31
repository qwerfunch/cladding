// Cladding · README record-honesty pins (F-3c2bf8b9)
//
// Dogfood self-check (sibling home: tests/self-consistency.test.ts): cladding
// is a drift-detection tool, so its own front-page honesty claims must not
// drift. Continuation of the 0.6.x "Honest release" series — a 2026-07-04
// audit found the who/what/why record claim overclaimed on durability and on
// who/when, so these tests pin all four README variants at the VERIFIED level
// (what verified → committed content, who/when → local session ledger, why →
// spec) and sweep out the audit-/regulation-grade overclaims that were cut.
// The who-ledger deferral (shipped as a backlog note, not code) is pinned too.
//
// These are cladding-SELF pins (they read this repo's own files), NOT shipped
// detectors — an adopting project may word its own README however it likes.

import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// The four shipped README variants — the module list of F-3c2bf8b9.
const EN_VARIANTS = ['README.md', 'README.html'];
const KO_VARIANTS = ['README.ko.md', 'README.ko.html'];
const ALL_VARIANTS = [...EN_VARIANTS, ...KO_VARIANTS];

test('current worktree feature counts match the canonical inventory', () => {
  const featureFiles = readdirSync(join(ROOT, 'spec', 'features'))
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'));
  const total = featureFiles.length;
  const done = featureFiles.filter((name) =>
    /^status:\s*done\s*$/m.test(read(`spec/features/${name}`)),
  ).length;
  const claims: Readonly<Record<string, readonly string[]>> = {
    'README.md': [`${done} of its ${total} features`, 'v0.9.4 worktree', `${total} (${done} done)`],
    'README.ko.md': [`기능 ${total}개 중 ${done}개`, 'v0.9.4 worktree', `${total} · ${done} done`],
    'README.ja.md': [`${total} 個の feature のうち ${done} 個`, 'v0.9.4 worktree', `${total}（${done} done）`],
    'README.zh.md': [`${total} 个 feature 里有 ${done} 个`, 'v0.9.4 worktree', `${total}（${done} done）`],
    'README.html': [`${done} of its ${total} features`, '2026-08 · worktree', `>${total}</div>`, `>${done} done · self-spec</div>`],
    'README.ko.html': [`기능 ${total}개 중 ${done}개`, '2026-08 · worktree', `>${total}</div>`, `>${done} done · 자기 스펙</div>`],
  };
  for (const [file, expected] of Object.entries(claims)) {
    const body = read(file);
    for (const claim of expected) expect(body, `${file}: ${claim}`).toContain(claim);
  }
});

describe('AC-ce8fe171 · record claim states the verified level in every variant', () => {
  test("[covers:F-3c2bf8b9/AC-ce8fe171] EN variants pin what -> committed content, who/when -> local session ledger", () => {
    for (const f of EN_VARIANTS) {
      const body = read(f);
      expect(body, `${f}: "on the record" headline`).toContain('What shipped is on the record');
      expect(body, `${f}: what verified lands in committed content`).toContain('committed content');
      expect(body, `${f}: who/when land in the local session ledger`).toContain('local session ledger');
    }
  });

  test('KO variants pin 무엇 -> 커밋된 내용, 누가·언제 -> 로컬 세션 로그', () => {
    for (const f of KO_VARIANTS) {
      const body = read(f);
      expect(body, `${f}: 기록 헤드라인`).toContain('나간 것은 기록에 남는다');
      expect(body, `${f}: 무엇 -> 커밋된 내용`).toContain('커밋된 내용');
      expect(body, `${f}: 누가·언제 -> 로컬 세션 로그`).toContain('로컬 세션 로그');
    }
  });
});

describe('AC-374f723c · every EU AI Act mention carries the not-a-certification hedge', () => {
  const MENTION = 'EU AI Act';
  // Same-sentence proxy: slice from a mention forward to the first
  // sentence-terminating period (ASCII or fullwidth); the hedge must fall
  // inside that slice. Delete the hedge clause and the slice ends earlier, so
  // the assertion fails — that is the teeth against a vacuous pass.
  const sentenceFrom = (text: string, at: number): string => {
    const rest = text.slice(at);
    const end = rest.search(/[.。](\s|<|$)/);
    return end === -1 ? rest : rest.slice(0, end + 1);
  };
  const hedgeFor = (f: string): string => (f.includes('.ko.') ? '인증이 아니다' : 'not a certification');

  test('the mention appears >= 4 times across variants (no vacuous pass on a deletion)', () => {
    let total = 0;
    for (const f of ALL_VARIANTS) {
      const n = read(f).split(MENTION).length - 1;
      expect(n, `${f}: at least one "${MENTION}" mention`).toBeGreaterThanOrEqual(1);
      total += n;
    }
    expect(total, 'four variants -> at least four EU AI Act mentions').toBeGreaterThanOrEqual(4);
  });

  test("[covers:F-3c2bf8b9/AC-374f723c] each mention is followed in-sentence by the language-appropriate hedge", () => {
    let checked = 0;
    for (const f of ALL_VARIANTS) {
      const body = read(f);
      const hedge = hedgeFor(f);
      let idx = body.indexOf(MENTION);
      expect(idx, `${f}: must contain "${MENTION}"`).toBeGreaterThanOrEqual(0);
      while (idx !== -1) {
        expect(sentenceFrom(body, idx), `${f}: EU AI Act sentence must carry "${hedge}"`).toContain(hedge);
        checked += 1;
        idx = body.indexOf(MENTION, idx + MENTION.length);
      }
    }
    expect(checked, 'every EU AI Act occurrence across the four variants was hedge-checked').toBeGreaterThanOrEqual(4);
  });
});

describe('AC-23cfa17d · needle sweep — zero unhedged overclaims across four variants', () => {
  // TRAP-avoidance: forbidden phrases are assembled from fragments at runtime,
  // so this pin file never contains a literal needle — a future repo-wide
  // honesty sweep must not trip on its own test. MIDDOT = U+00B7, the
  // interpunct the READMEs actually use, so the KO needle would catch a real
  // re-introduction of the overclaim.
  const MIDDOT = '·';
  const asm = (parts: string[]): string => parts.join('');
  const NEEDLES: string[] = [
    asm(['audits, ', 'regulatory ', 'response']),
    asm(['감사', `${MIDDOT}규제 `, '대응']),
    asm(['immut', 'able']),
    asm(['Immut', 'able']),
    asm(['tamp', 'er']),
    asm(['다 ', '기록에 ', '남는다']),
    asm(['언제든 ', '추적']),
    asm(['수정 ', '불가']),
  ];
  const scan = (corpus: string): string[] => NEEDLES.filter((n) => corpus.includes(n));

  test("[covers:F-3c2bf8b9/AC-23cfa17d] all four variants are free of every forbidden needle (files-visited === 4)", () => {
    let visited = 0;
    const hits: string[] = [];
    for (const f of ALL_VARIANTS) {
      visited += 1;
      for (const n of scan(read(f))) hits.push(`${f} :: ${n}`);
    }
    expect(visited, 'the sweep must visit exactly the four README variants').toBe(4);
    expect(hits, `unhedged overclaim(s) found: ${hits.join(' | ')}`).toEqual([]);
  });

  test('planted-needle control — the scanner has teeth (clean=[], poisoned=[needle])', () => {
    const planted = asm(['immut', 'able']);
    expect(scan('harmless honest prose with no overclaims'), 'clean corpus -> no hits').toEqual([]);
    expect(scan(`prose ... ${planted} ... prose`), 'poisoned corpus -> planted needle caught').toContain(planted);
  });
});

describe('AC-bf20e7cc · who-ledger deferral + reopen trigger survive in the backlog', () => {
  test("[covers:F-3c2bf8b9/AC-bf20e7cc] refinement-backlog.md carries the deferral entry and its reopen trigger", () => {
    const backlog = read('docs/refinement-backlog.md');
    expect(backlog, 'names the deferred who-ledger idea').toContain('who-ledger');
    expect(backlog, 'marks it deferred, not shipped').toMatch(/[Dd]eferred/);
    expect(backlog, 'ties the entry to this feature').toContain('F-3c2bf8b9');
    expect(backlog, 'records a reopen trigger').toContain('Reopen trigger');
    expect(backlog, 'trigger = a real external team requiring audit evidence').toContain('external team requires audit evidence');
  });
});
