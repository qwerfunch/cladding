// Cladding · terminology canon pins (F-09a98261)
//
// Dogfood self-check (sibling home: tests/self-consistency.test.ts pins the
// glossary structure + count guards this suite extends; tests/cli/verb-residue.test.ts
// pins the verb-rename residue sweep this suite borrows conventions from). A
// 2026-07-05 terminology audit found five live-confusion surfaces: missing
// glossary rows (card family, context-slice-vs-working-set rule, the counting
// quartet, the check-vs-gate mapping, the drive-loop internal name), a forked
// attestation gloss ("committed stamp"/"검증 도장" vs "verification signature"/
// "검증 서명"), two stale user-visible strings (the removed ANSI panel, the old
// "Spec-conformance oracle brief" header), an unguarded README.ko.md count
// claim, and seven done shards still enumerating pre-rename verbs/personas
// (panel/drive, librarian/specialists) as current. These tests pin the five
// fixes so none can silently regress.
//
// Needles for anything self-trippable (old persona names, removed-verb
// phrases, the retired card label, the old attestation gloss) are assembled
// at runtime from fragments — never literal here — so this file (itself
// under tests/**/*.ts) cannot trip tests/cli/verb-residue.test.ts's
// AC-7026c2e7 tripwire, nor read as legacy-name residue of its own.
//
// cladding-SELF pins (they read this repo's own files), NOT shipped detectors.

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {describe, expect, test} from 'vitest';
import {parse as parseYaml} from 'yaml';

import {allDetectors} from '../src/stages/detectors/index.js';
// TIER_STAGES is the SSoT for the Iron Law stage list AND (via its own key
// set) the tier list; importing clad.ts is safe because its CLI entry is
// guarded by `isCliEntry` (no parse on import) — same precedent as
// tests/self-consistency.test.ts.
import {TIER_STAGES} from '../src/cli/clad.js';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const asm = (parts: string[]): string => parts.join('');

type SchemaVersion = '0.1' | '0.2';
type YamlRecord = Readonly<Record<string, unknown>>;

function workspaceSchema(): SchemaVersion {
  const schema = (parseYaml(read('spec.yaml')) as {readonly schema?: unknown}).schema;
  expect(schema, 'spec.yaml must declare a supported schema').toMatch(/^(?:0\.1|0\.2)$/);
  return schema as SchemaVersion;
}

function strings(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * Returns only the authored feature semantics for the active schema.
 *
 * Schema 0.1 gives EARS action/response/text equal semantic weight. Schema
 * 0.2 deliberately retires those fields, so this dogfood sweep follows its
 * statement, purpose, and declared dependency/module addresses instead of
 * treating historical implementation narration as live requirement prose.
 */
function semanticShardText(path: string): string {
  const source = read(path);
  if (workspaceSchema() === '0.1') return source;
  const feature = parseYaml(source) as YamlRecord;
  const topLevel = ['title', 'purpose', 'modules', 'depends_on', 'capability_refs']
    .flatMap((field) => strings(feature[field]));
  const criteria = Array.isArray(feature.acceptance_criteria) ? feature.acceptance_criteria : [];
  const criteriaText = criteria.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const criterion = entry as YamlRecord;
    return ['kind', 'statement', 'rationale', 'constraint_refs', 'oracle_refs', 'evidence_refs']
      .flatMap((field) => strings(criterion[field]));
  });
  return [...topLevel, ...criteriaText].join('\n');
}

const GLOSSARY = 'docs/glossary.md';
const README_VARIANTS = ['README.md', 'README.ko.md', 'README.html', 'README.ko.html'];

/** First line in `section` starting with `prefix`; fails loudly if absent. */
function rowStartingWith(section: string, prefix: string): string {
  const row = section.split('\n').find((l) => l.startsWith(prefix));
  expect(row, `row starting with "${prefix}"`).toBeTruthy();
  return row as string;
}

// ═══════════════════════════════════════════════════════════════════════
// AC-5a249349 — glossary defines the previously missing concept rows.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-5a249349 · glossary defines the previously missing concept rows', () => {
  const glossary = read(GLOSSARY);

  /** Slice a `## Heading` section up to the next `## ` heading (or EOF).
   *  Anchored on a short, special-character-free prefix of the real heading
   *  so this helper never has to reproduce the heading's em dash / ≡ bytes. */
  const sectionFrom = (headingPrefix: string): string => {
    const start = glossary.indexOf(headingPrefix);
    expect(start, `glossary must contain a heading starting "${headingPrefix}"`).toBeGreaterThanOrEqual(0);
    const after = glossary.slice(start + headingPrefix.length);
    const end = after.indexOf('\n## ');
    return end === -1 ? after : after.slice(0, end);
  };

  test("[covers:F-09a98261/AC-5a249349] impact-card row: Tier-1 one-liner + Tier-2 rich card", () => {
    const section = sectionFrom('## Context surfaces');
    const row = rowStartingWith(section, '| `impact card`');
    expect(row, 'Tier-1 one-liner').toContain('**Tier-1** = a one-liner');
    expect(row, 'Tier-2 rich card').toContain('**Tier-2** = a rich card');
  });

  test('the retired mini-working-set-card label appears only as a retired mention', () => {
    const retiredLabel = asm(['mini working-set', ' card']);
    const lines = glossary.split('\n').filter((l) => l.includes(retiredLabel));
    expect(lines.length, 'the retired label should still be documented, as a retired mention').toBeGreaterThan(0);
    for (const line of lines) {
      expect(line, `"${line}" must mark the label retired, not present it as a live term`).toMatch(/retired/i);
    }
  });

  test('session card and prompt suggestion rows carry their KO glosses', () => {
    const section = sectionFrom('## Context surfaces');
    expect(rowStartingWith(section, '| `session card`')).toContain('세션 카드');
    expect(rowStartingWith(section, '| `prompt suggestion`')).toContain('프롬프트 제안');
  });

  test('context-slice vs working-set rule row: frozen no-code slice vs code-bearing superset', () => {
    const section = sectionFrom('## Context surfaces');
    const row = rowStartingWith(section, '| context slice vs working set');
    expect(row, 'context slice = frozen').toContain('frozen');
    expect(row, 'context slice = no-code').toContain('no-code');
    expect(row, 'context slice pull surface').toContain('clad_get_context');
    expect(row, 'working set = code-bearing').toContain('code-bearing');
    expect(row, 'working set pull surface').toContain('clad_get_working_set');
    expect(row, 'KO gloss').toContain('컨텍스트 슬라이스');
  });

  test('the check ≡ gate mapping row pins clad_run_gate equivalence + drift-only-subset wording', () => {
    const section = sectionFrom('## The check');
    const gateRow = rowStartingWith(section, '| `clad_run_gate`');
    expect(gateRow, 'clad_run_gate named as the MCP twin of clad check --strict').toContain('MCP twin of');
    expect(gateRow, 'clad_run_gate row names clad check --strict').toContain('clad check --strict');
    const checkRow = rowStartingWith(section, '| `clad_run_check`');
    expect(checkRow, 'clad_run_check pinned as the drift-detector subset').toContain('drift-detector subset');
    expect(checkRow, 'clad_run_check explicitly NOT the full gate').toContain('NOT the full gate');
    // Closing paragraph: the equivalence symbol + the FULL/LIGHT contrast.
    expect(section, 'equivalence symbol present').toContain('≡');
    expect(section, 'drift-only slice phrasing').toContain('drift-only slice');
    expect(section, 'CLI check is FULL').toContain('is FULL');
    expect(section, 'MCP _check is LIGHT').toContain('is LIGHT');
  });

  test('counting-quartet rows exist for phases/stages/tiers/detectors', () => {
    const section = sectionFrom('## Counting nouns');
    for (const noun of ['phases', 'stages', 'tiers', 'detectors']) {
      expect(rowStartingWith(section, `| ${noun} |`)).toBeTruthy();
    }
  });

  test('the stages/detectors counts derive from the same SSoT self-consistency.test.ts uses (not hardcoded)', () => {
    const section = sectionFrom('## Counting nouns');
    const stagesRow = rowStartingWith(section, '| stages |');
    const detectorsRow = rowStartingWith(section, '| detectors |');
    const stagesCount = Number(stagesRow.match(/\|\s*stages\s*\|\s*(\d+)\s*\|/)?.[1]);
    const detectorsCount = Number(detectorsRow.match(/\|\s*detectors\s*\|\s*(\d+)\s*\|/)?.[1]);
    expect(stagesCount, 'glossary "stages" count vs TIER_STAGES.all.length').toBe(TIER_STAGES.all.length);
    expect(detectorsCount, 'glossary "detectors" count vs allDetectors.length').toBe(allDetectors.length);
  });

  test("the tiers count derives from TIER_STAGES' own key set (pre-commit/pre-push/all)", () => {
    const section = sectionFrom('## Counting nouns');
    const tiersRow = rowStartingWith(section, '| tiers |');
    const tiersCount = Number(tiersRow.match(/\|\s*tiers\s*\|\s*(\d+)\s*\|/)?.[1]);
    expect(tiersCount, 'glossary "tiers" count vs TIER_STAGES key count').toBe(Object.keys(TIER_STAGES).length);
  });

  test("the phases count is internally consistent with the glossary's own Iron Law row", () => {
    const ironLawRow = rowStartingWith(glossary, '| `Iron Law`');
    const ironLawPhases = Number(ironLawRow.match(/(\d+)-phase/)?.[1]);
    const section = sectionFrom('## Counting nouns');
    const phasesRow = rowStartingWith(section, '| phases |');
    const phasesCount = Number(phasesRow.match(/\|\s*phases\s*\|\s*(\d+)\s*\|/)?.[1]);
    expect(phasesCount, 'counting-quartet "phases" count vs the Iron Law row\'s own count').toBe(ironLawPhases);
  });

  test('the drive-loop internal-name note: clad-drive frozen for audit compatibility, KO gloss present', () => {
    const idx = glossary.indexOf('Internal name');
    expect(idx, 'drive-loop internal-name note').toBeGreaterThanOrEqual(0);
    const note = glossary.slice(idx, idx + 900);
    expect(note, 'names the drive loop module').toContain('src/drive/loop.ts');
    expect(note, 'names the frozen evidence identity').toContain(asm(['clad', '-drive']));
    expect(note, 'states the freeze reason').toContain('frozen for audit-log compatibility');
    expect(note, 'states drive is not a CLI verb').toContain('never as a CLI verb');
    expect(note, 'KO gloss line present').toContain('KO:');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-c73c675e — one canonical attestation gloss across glossary + 4 READMEs.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-c73c675e · attestation gloss is one canonical pair everywhere', () => {
  const OLD_EN = asm(['committed', ' ', 'stamp']);
  const OLD_KO = asm(['검증', ' ', '도장']);
  const NEW_EN = 'verification signature';
  const NEW_KO = '검증 서명';
  const ALL_FILES = [GLOSSARY, ...README_VARIANTS];
  const EN_FILES = [GLOSSARY, 'README.md', 'README.html'];
  const KO_FILES = [GLOSSARY, 'README.ko.md', 'README.ko.html'];

  test("[covers:F-09a98261/AC-c73c675e] zero occurrences of the old EN/KO attestation gloss pair across glossary + all 4 READMEs", () => {
    const hits: string[] = [];
    for (const f of ALL_FILES) {
      const body = read(f);
      if (body.includes(OLD_EN)) hits.push(`${f} :: ${OLD_EN}`);
      if (body.includes(OLD_KO)) hits.push(`${f} :: ${OLD_KO}`);
    }
    expect(hits, `stale attestation gloss found: ${hits.join(' | ')}`).toEqual([]);
  });

  test('planted-needle control — the old-gloss scanner has teeth (clean=[], poisoned=[needle])', () => {
    const scan = (corpus: string): string[] => [OLD_EN, OLD_KO].filter((n) => corpus.includes(n));
    expect(scan('honest prose with the current verification signature gloss')).toEqual([]);
    expect(scan(`prose ... ${OLD_EN} ... prose`)).toContain(OLD_EN);
  });

  test('the EN canonical gloss "verification signature" is present in glossary + EN READMEs', () => {
    for (const f of EN_FILES) expect(read(f), f).toContain(NEW_EN);
  });

  test('the KO canonical gloss "검증 서명" is present in glossary + KO READMEs', () => {
    for (const f of KO_FILES) expect(read(f), f).toContain(NEW_KO);
  });

  // The philosophy tagline ("claim" -> "proof" / 증명) is a DIFFERENT concept
  // from the attestation gloss and must never be flagged. This suite's
  // needles are the exact two-word OLD phrases ("committed stamp"/"검증
  // 도장"), which never match the single words "proof"/"증명" used in the
  // tagline — so no exclusion filter is needed; this test instead documents
  // (and positively pins) that the tagline is a distinct, intentional
  // sentence, not a silently-deleted one and not the attestation gloss.
  test('the philosophy tagline (EN "proof" / KO 증명) is confirmed distinct from the attestation gloss', () => {
    const enTagline = read('README.md').split('\n').find((l) => l.includes('a **proof**'));
    const koTagline = read('README.ko.md').split('\n').find((l) => l.includes('증명'));
    expect(enTagline, 'EN philosophy tagline (claim -> proof) must still exist').toBeTruthy();
    expect(koTagline, 'KO philosophy tagline (증명) must still exist').toBeTruthy();
    expect(enTagline as string, 'tagline sentence is not the attestation gloss').not.toContain(NEW_EN);
    expect(koTagline as string, 'tagline sentence is not the attestation gloss').not.toContain(NEW_KO);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-1c0c639e — the two user-visible string repairs.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-1c0c639e · two user-visible string repairs', () => {
  test("[covers:F-09a98261/AC-1c0c639e] clad status --json help: \"integrity matrix\" present, the removed ANSI-panel phrase absent", () => {
    const src = read('src/cli/clad.ts');
    const cmdIdx = src.indexOf(".command('status')");
    expect(cmdIdx, "the .command('status') registration").toBeGreaterThanOrEqual(0);
    const nextCmdIdx = src.indexOf('.command(', cmdIdx + 1);
    const block = nextCmdIdx === -1 ? src.slice(cmdIdx) : src.slice(cmdIdx, nextCmdIdx);
    const m = block.match(/\.option\('--json',\s*'([^']*)'\)/);
    expect(m, 'status --json option description').toBeTruthy();
    const helpText = (m as RegExpMatchArray)[1];
    expect(helpText, 'names the integrity matrix').toContain('integrity matrix');
    const removedPhrase = ['ANSI', ' panel'].join('');
    expect(helpText, 'no longer names the removed ANSI panel').not.toContain(removedPhrase);
  });

  test('planted-needle control — a reintroduced ANSI-panel phrase would be caught', () => {
    const removedPhrase = ['ANSI', ' panel'].join('');
    const clean = 'emit the row model as JSON — the same integrity matrix rendered to the terminal';
    const poisoned = 'emit the row model as JSON — the same feature × stage matrix the ANSI panel renders';
    expect(clean.includes(removedPhrase)).toBe(false);
    expect(poisoned.includes(removedPhrase)).toBe(true);
  });

  test("[covers:F-09a98261/AC-1c0c639e] oracle brief header names itself impl-blind, not the old spec-conformance header", () => {
    const src = read('src/oracle/payload.ts');
    expect(src, 'Impl-blind oracle brief header').toContain('Impl-blind oracle brief');
    const oldHeader = asm(['Spec-conformance', ' oracle brief']);
    expect(src, 'old header phrase must be gone').not.toContain(oldHeader);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-4772bf42 — the self-consistency KO count guard is structurally present.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-4772bf42 · self-consistency.test.ts guards README.ko.md counts', () => {
  const src = read('tests/self-consistency.test.ts');

  /** Body of the named test('...') up to the next sibling test( at the same
   *  2-space indent (a structural pin, not a content pin — so this guard
   *  can't be silently dropped from the count-guard sections). */
  const testBodyNamed = (nameSubstring: string): string => {
    const idx = src.indexOf(nameSubstring);
    expect(idx, `test named "${nameSubstring}"`).toBeGreaterThanOrEqual(0);
    const after = src.slice(idx);
    const end = after.indexOf('\n  test(', 1);
    return end === -1 ? after : after.slice(0, end);
  };

  test("[covers:F-09a98261/AC-4772bf42] the detector-count guard section references README.ko.md", () => {
    const body = testBodyNamed('README prose detector-count claims match the actual detector count');
    expect(body, 'detector-count guard must reference README.ko.md').toContain('README.ko.md');
  });

  test("[covers:F-09a98261/AC-4772bf42] the stage-count guard section references README.ko.md", () => {
    const body = testBodyNamed('README/AGENTS stage-count claims match TIER_STAGES.all.length');
    expect(body, 'stage-count guard must reference README.ko.md').toContain('README.ko.md');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// AC-50704241 — the seven done shards present current verb/persona names.
// ═══════════════════════════════════════════════════════════════════════
describe('AC-50704241 · seven done shards present current verb/persona names', () => {
  const SHARDS = [
    'spec/features/F-077.yaml',
    'spec/features/F-036.yaml',
    'spec/features/F-073.yaml',
    'spec/features/F-076.yaml',
    'spec/features/F-078.yaml',
    'spec/features/ai-hints-consumer-instructions-0ed2db.yaml',
    'spec/features/persona-skill-md-cleanup-40327b.yaml',
  ];
  // Old persona names + removed-verb bare tokens, assembled from fragments so
  // this file never carries the literal old names (same hygiene precedent as
  // tests/cli/verb-residue.test.ts's AC-7026c2e7 runtime-assembled needles).
  const OLD_PERSONAS = [asm(['libra', 'rian']), asm(['special', 'ists'])];
  const OLD_VERBS = [asm(['pa', 'nel']), asm(['dri', 've'])];
  const OLD_NEEDLES = [...OLD_PERSONAS, ...OLD_VERBS];
  const scanFor = (corpus: string): string[] =>
    OLD_NEEDLES.filter((n) => new RegExp(`\\b${n}\\b`, 'i').test(corpus));

  test("[covers:F-09a98261/AC-50704241] none of the seven shards name an old persona or removed-verb token (files-visited === 7)", () => {
    let visited = 0;
    const hits: string[] = [];
    for (const f of SHARDS) {
      visited += 1;
      for (const n of scanFor(semanticShardText(f))) hits.push(`${f} :: ${n}`);
    }
    expect(visited, 'the sweep must visit exactly the seven target shards').toBe(7);
    expect(hits, `stale name(s) found: ${hits.join(' | ')}`).toEqual([]);
  });

  test('planted-needle control — the scanner has teeth (clean=[], poisoned=[needle])', () => {
    expect(scanFor('five personas: orchestrator, planner, reviewer, observability, developer')).toEqual([]);
    expect(scanFor(`the old persona was called ${OLD_PERSONAS[0]}`)).toContain(OLD_PERSONAS[0]);
  });

  test('every shard instead names the current planner/developer persona pair', () => {
    if (workspaceSchema() === '0.2') {
      // F-078 formerly named the pair only in legacy action/response
      // narration. Its schema-0.2 statement does not make that enumeration a
      // requirement, so require the six shards that still declare the pair in
      // active statements or module ownership rather than falsely reading a
      // retired field as an authoritative vocabulary.
      const explicitPair = SHARDS.filter((f) => {
        const body = semanticShardText(f);
        return /\bplanner\b/.test(body) && /\bdeveloper\b/.test(body);
      });
      expect(explicitPair).toEqual([
        'spec/features/F-077.yaml',
        'spec/features/F-036.yaml',
        'spec/features/F-073.yaml',
        'spec/features/F-076.yaml',
        'spec/features/ai-hints-consumer-instructions-0ed2db.yaml',
        'spec/features/persona-skill-md-cleanup-40327b.yaml',
      ]);
      return;
    }
    for (const f of SHARDS) {
      const body = semanticShardText(f);
      expect(body, `${f}: should name 'planner'`).toMatch(/\bplanner\b/);
      expect(body, `${f}: should name 'developer'`).toMatch(/\bdeveloper\b/);
    }
  });
});
