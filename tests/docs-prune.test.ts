// Cladding · docs-prune AC tests (F-987be195)
//
// C1 verifier lane (Sonnet) — authored independently of the implementation
// per C1-brief.md / C1-impl.md: two superseded docs deleted after relocating
// their sole unique content, the roadmap compacted with the Transport section
// kept verbatim, four A/B docs gaining a dated snapshot footnote, and
// docs/README.md dropping the two tier-index rows.
//
// Dogfood self-check (sibling home: tests/merge-ritual-docs.test.ts pattern,
// tests root). The two deleted docs' filenames are assembled at runtime —
// never spelled out contiguously below — so this file cannot match its own
// "zero dangling references" scan: it lives under tests/, one of the three
// trees that scan walks.

import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {describe, expect, test} from 'vitest';

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

// ── Dynamic needles — assembled at runtime, never written contiguously ────
const MARKETPLACE_DOC = ['marketplace', 'self-contained'].join('-') + '.md';
const SSOT_AUDIT_DOC = ['ssot', 'audit'].join('-') + '.md';
const DELETED_DOCS: readonly string[] = [MARKETPLACE_DOC, SSOT_AUDIT_DOC];

const removedVerb = (v: string): string => ['clad', v].join(' ');
const REMOVED_VERBS: readonly string[] = [removedVerb('drive'), removedVerb('panel')];

// Known, pre-adjudicated exceptions outside src/ tests/ docs/ — repo-root
// history, the regenerated doc-link index, and this feature's own shard.
// (AC-4c28425b's response clause: "CHANGELOG history tolerated; the doc-link
// index regenerates at sync".)
const TOLERATED_FILES: ReadonlySet<string> = new Set([
  'CHANGELOG.md',
  'spec/_doc-links.yaml',
  'spec/features/docs-prune-987be195.yaml',
  'spec/generated/migration-baseline-0.1-to-0.2.yaml',
]);

// Build artifacts / caches / vendor trees — regenerated, not the SSoT prose
// or code this AC governs. Matched by basename at any depth (also catches
// the committed plugins/*/dist mirrors, which are built FROM src/ and would
// otherwise double-count or go stale independently of this cleanup).
const WALK_EXCLUDE_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', '.cladding', 'coverage']);
const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.mov', '.woff', '.woff2', '.ttf',
]);

interface WalkResult {
  readonly filesVisited: number;
  readonly hits: Map<string, string[]>;
}

/** Walks the given cwd-relative start dirs ('.' for repo root), skipping
 * build/vendor dirs, and records which files contain each needle. Pure
 * read — no writes, consistent with the "no src/docs modifications" rule. */
function walkForNeedles(startDirs: readonly string[], needles: readonly string[]): WalkResult {
  let filesVisited = 0;
  const hits = new Map<string, string[]>(needles.map((n): [string, string[]] => [n, []]));
  const queue: string[] = startDirs.map((d) => join(ROOT, d));
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (WALK_EXCLUDE_DIRS.has(name)) continue;
      const abs = join(dir, name);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      if (s.isDirectory()) {
        queue.push(abs);
        continue;
      }
      if (!s.isFile()) continue;
      const ext = name.slice(name.lastIndexOf('.'));
      if (BINARY_EXTENSIONS.has(ext)) continue;
      filesVisited++;
      let content: string;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      const relPath = relative(ROOT, abs).split('\\').join('/');
      for (const needle of needles) {
        if (content.includes(needle)) hits.get(needle)!.push(relPath);
      }
    }
  }
  return {filesVisited, hits};
}

describe('AC-4c28425b · deleted docs leave zero dangling references outside history', () => {
  test('non-vacuous guard: the src/tests/docs scan visits a real number of files', () => {
    const {filesVisited} = walkForNeedles(['src', 'tests', 'docs'], DELETED_DOCS);
    expect(filesVisited, 'files visited under src/ tests/ docs/').toBeGreaterThan(300);
  });

  test('zero references to the deleted filenames under src/, tests/, docs/', () => {
    const {hits} = walkForNeedles(['src', 'tests', 'docs'], DELETED_DOCS);
    for (const doc of DELETED_DOCS) {
      expect(hits.get(doc), `no file under src/ tests/ docs/ mentions ${doc}`).toEqual([]);
    }
  });

  test('repo-wide, the only remaining mentions are the pre-adjudicated tolerated files', () => {
    const {filesVisited, hits} = walkForNeedles(['.'], DELETED_DOCS);
    expect(filesVisited, 'repo-wide scan (minus build/vendor dirs) visits a real number of files').toBeGreaterThan(700);
    for (const doc of DELETED_DOCS) {
      const foundIn = hits.get(doc) ?? [];
      for (const f of foundIn) {
        expect(
          TOLERATED_FILES.has(f),
          `${doc} mentioned in ${f} — only tolerated in ${[...TOLERATED_FILES].join(', ')}`,
        ).toBe(true);
      }
    }
  });

  test('docs/README.md tier index no longer lists either deleted doc row', () => {
    const readme = read('docs/README.md');
    for (const doc of DELETED_DOCS) {
      expect(readme, `docs/README.md row for ${doc}`).not.toContain(doc);
    }
  });

  test('src/init/host-setup.ts carries the project-scoped Antigravity boundary directly', () => {
    const hostSetup = read('src/init/host-setup.ts');
    expect(hostSetup, 'load-bearing WHY: global install must not leak context').toContain(
      'Installing the CLI globally must not make Cladding visible to every AI',
    );
    expect(hostSetup, 'AGY uses its project MCP discovery file').toContain("'.agents', 'mcp_config.json'");
    expect(hostSetup, 'AGY shares only the project init skill').toContain("'.agents', 'skills', 'cladding-init'");
    expect(hostSetup, 'does not point back to the deleted marketplace design').not.toContain(MARKETPLACE_DOC);
  });

  test('src/spec/types.ts J5b comment cites the ac-hash-ids shard, not the deleted doc', () => {
    const typesTs = read('src/spec/types.ts');
    expect(typesTs, 'cites the shard carrying the J5b rationale').toContain('spec/features/ac-hash-ids-a04cd9.yaml');
    expect(typesTs, 'cites the specific AC').toContain('AC-003');
    expect(typesTs, 'no longer points at the deleted doc').not.toContain(SSOT_AUDIT_DOC);
  });
});

describe('AC-51b8dbee · the roadmap keeps Transport verbatim and drops removed-verb / planned-v0.2.0 framing', () => {
  const ROADMAP = 'docs/multi-provider-roadmap.md';
  const TRANSPORT_HEADING = '## Transport architectural decision';

  const TRANSPORT_CITING_FILES: readonly string[] = [
    'src/adapters/host/transport.ts',
    'src/adapters/host/claude-code.ts',
    'src/adapters/host/generic-mcp.ts',
  ];
  const OTHER_SECTION_CITING_FILES: ReadonlyArray<{file: string; heading: string}> = [
    {file: 'src/adapters/index.ts', heading: '## Adapter matrix'},
    {file: 'src/adapters/sdk/anthropic.ts', heading: '## Adapter matrix'},
    {file: 'src/adapters/types.ts', heading: '## Two modes'},
  ];

  test('the Transport architectural decision heading is present verbatim', () => {
    expect(read(ROADMAP)).toContain(TRANSPORT_HEADING);
  });

  test('zero removed-verb phrases remain in the roadmap', () => {
    const roadmap = read(ROADMAP);
    for (const phrase of REMOVED_VERBS) {
      expect(roadmap, `roadmap must not mention "${phrase}"`).not.toContain(phrase);
    }
  });

  test('the three Transport-citing adapter files still name the section, and the section still resolves', () => {
    const roadmap = read(ROADMAP);
    expect(roadmap).toContain(TRANSPORT_HEADING);
    for (const file of TRANSPORT_CITING_FILES) {
      const content = read(file);
      expect(content, `${file} still names the Transport section`).toContain('Transport architectural decision');
      expect(content, `${file} still @see-references ${ROADMAP}`).toContain(ROADMAP);
    }
  });

  test('the other three @see anchors (adapter matrix ×2, two-modes overview ×1) still resolve to real headings', () => {
    const roadmap = read(ROADMAP);
    for (const {file, heading} of OTHER_SECTION_CITING_FILES) {
      const content = read(file);
      expect(content, `${file} still @see-references ${ROADMAP}`).toContain(ROADMAP);
      expect(roadmap, `${file}'s target heading (${heading}) still exists verbatim`).toContain(heading);
    }
  });

  test('all six @see docs/multi-provider-roadmap.md anchors are accounted for', () => {
    const allSix = [...TRANSPORT_CITING_FILES, ...OTHER_SECTION_CITING_FILES.map((x) => x.file)];
    expect(new Set(allSix).size, 'six distinct adapter files').toBe(6);
    for (const file of allSix) {
      expect(read(file), `${file} still @see-references ${ROADMAP}`).toContain(ROADMAP);
    }
  });
});

describe('AC-28a53560 · four A/B docs carry the dated snapshot footnote near the top', () => {
  const AB_FOOTNOTE_FILES: readonly string[] = [
    'docs/ab-evaluation/summary.md',
    'docs/ab-evaluation/README.md',
    'docs/ab-evaluation/case-payment-saas.md',
    'docs/ab-evaluation/case-existing-adoption.md',
  ];
  const HISTORICAL_SNAPSHOT_NEEDLE = 'this historical M2 report reflects the detector registry available at that run. Body preserved as an append-only snapshot.';
  const RETIRED_NUMERIC_SNAPSHOT_NEEDLES = [
    'detector count was 25 at this run',
    'grown to 41',
  ];

  test('all four A/B docs carry the dated snapshot footnote near the top', () => {
    for (const file of AB_FOOTNOTE_FILES) {
      const lines = read(file).split('\n').slice(0, 15).join('\n');
      expect(lines, `${file}: non-numeric historical snapshot footnote within the first 15 lines`)
        .toContain(HISTORICAL_SNAPSHOT_NEEDLE);
      for (const retiredNeedle of RETIRED_NUMERIC_SNAPSHOT_NEEDLES) {
        expect(lines, `${file}: retired numeric snapshot wording is absent`).not.toContain(retiredNeedle);
      }
    }
  });

  test('renderCaseReport (the generator) emits the footnote, so it is not a hand-edit the next regen would erase', () => {
    // The two generated case files (case-payment-saas.md, case-existing-adoption.md)
    // are byte-exact snapshots asserted by writeOrAssertReport (tests/scenarios/ab/_report.ts).
    // Re-diffing that here would re-implement the generator's own guard; the actual
    // proof is re-running tests/scenarios/ab/case-*.test.ts (see C1-verify.md receipts).
    // This test instead pins that the footnote is emitted BY the generator function
    // itself, not hand-pasted into the .md (so the next UPDATE_AB_REPORTS regen keeps it).
    const generatorSource = read('tests/scenarios/ab/_report.ts');
    const fnStart = generatorSource.indexOf('export function renderCaseReport');
    const fnEnd = generatorSource.indexOf('\nfunction renderMilestoneTable');
    expect(fnStart, 'renderCaseReport found').toBeGreaterThan(-1);
    expect(fnEnd, 'renderMilestoneTable found (end of renderCaseReport body)').toBeGreaterThan(fnStart);
    const body = generatorSource.slice(fnStart, fnEnd);
    expect(body, 'the footnote line lives inside renderCaseReport, not elsewhere in the file')
      .toContain(HISTORICAL_SNAPSHOT_NEEDLE);
    for (const retiredNeedle of RETIRED_NUMERIC_SNAPSHOT_NEEDLES) {
      expect(body, 'renderCaseReport does not revive retired numeric snapshot wording').not.toContain(retiredNeedle);
    }
  });
});
