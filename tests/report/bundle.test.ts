// Cladding · tests for the self-contained HTML audit bundle (F-e940fffe)
//
// Written from the acceptance criteria + module signatures (impl-blind test
// authoring): buildBundleHtml is PURE (all I/O pre-gathered by the CLI), so
// the unit layer feeds synthetic inputs and regex-asserts the emitted bytes;
// the integration layer spawns the real CLI against a temp git project (the
// report-cli.test.ts pattern) and against cladding itself.
//   - AC-9f191790 · six content sections + provenance; ZERO network surface
//   - AC-f511c519 · provenance banner (sha / version / date) before content
//   - AC-15bb0b99 · no anchor ref → changes+audit degrade, the rest renders
//   - AC-e5f48ce5 · status --json mirrors buildPanelModel (one SSoT)
//   - AC-0116e8d0 · byte-identical for fixed inputs + fixed now; <5MB on self
//   - md subset  · heading/list/table/inline pins, <br> protection, XSS escape

import {execFileSync, spawnSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterAll, beforeAll, describe, expect, test, vi} from 'vitest';

import {runBundleCommand} from '../../src/cli/clad.js';
import {buildBundleHtml, type BundleChanges, type BundleInputs} from '../../src/report/bundle.js';
import {loadSpec} from '../../src/spec/load.js';
import type {Spec} from '../../src/spec/types.js';
import {buildPanelModel, type CellGlyph, type PanelModel, type PanelRow} from '../../src/ui/panel.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TSX = join(REPO, 'node_modules', '.bin', 'tsx');
const CLAD = join(REPO, 'src', 'cli', 'clad.ts');

// ─── shared helpers ──────────────────────────────────────────────────────────

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function executableCssContexts(html: string): string[] {
  const styleBodies = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((match) => match[1]);
  const inlineStyles = [...html.matchAll(/\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)]
    .map((match) => match[1] ?? match[2]);
  return [...styleBodies, ...inlineStyles];
}

interface Ran {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs `clad <args>` with `cwd`; returns exit status + streams. */
function runClad(cwd: string, args: readonly string[]): Ran {
  const res = spawnSync(TSX, [CLAD, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? ''};
}

// ─── synthetic fixtures (pure layer) ─────────────────────────────────────────

const STAGE_IDS: readonly string[] = [
  'stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6',
  'stage_2.1', 'stage_2.2',
  'stage_3.1', 'stage_3.2', 'stage_3.3',
  'stage_4.1', 'stage_4.2',
];
const COLUMNS: readonly string[] = [...STAGE_IDS, 'att'];

function mkRow(featureId: string, title: string, status: PanelRow['status'], att: CellGlyph): PanelRow {
  const stageCells = STAGE_IDS.map<CellGlyph>(() => '-');
  return {featureId, title, status, cells: [...stageCells, att]};
}

function mkSpec(): Spec {
  return {
    schema: '0.1',
    project: {
      name: 'probe',
      language: 'typescript',
      description: 'A probe project for bundle tests',
      version: '1.2.3',
      repository: 'https://example.com/probe.git',
    },
    features: [
      {id: 'F-aaaa1111', title: 'Alpha payments', status: 'done', modules: ['src/a.ts']},
      {id: 'F-bbbb2222', title: 'Beta reports', status: 'in_progress'},
      {id: 'F-cccc3333', title: 'Gamma cleanup', status: 'done', modules: ['src/c.ts']},
    ],
    capabilities: [{id: 'payments', title: 'Payments', features: ['F-aaaa1111']}],
    inventory: {features: 3, scenarios: 1, capabilities: 1, test_files: 2},
  };
}

function mkPanel(): PanelModel {
  return {
    columns: COLUMNS,
    rows: [
      mkRow('F-aaaa1111', 'Alpha payments', 'done', '✓'),
      mkRow('F-bbbb2222', 'Beta reports', 'in_progress', '·'),
      mkRow('F-cccc3333', 'Gamma cleanup', 'done', '!'),
    ],
  };
}

const CATALOG_MD = [
  '# Catalog',
  '',
  'Intro with **bold**, `code`, and _ital_ tokens.',
  '',
  '## Payments',
  '',
  '- top item',
  '  - nested item',
  '',
  '| name | count |',
  '|---|---|',
  '| payments | 2 |',
  '',
  '### Deep heading',
].join('\n');

const CHANGELOG_MD = [
  '# Shipped changes',
  '',
  '- **Alpha payments** — charge flow shipped',
  '  - handles the `POST /charge` route',
].join('\n');

const AUDIT_MD = [
  '| feature | acceptance | evidence |',
  '|---|---|---|',
  '| F-aaaa1111 | AC-1 | tests/a.test.ts#one<br>tests/b.test.ts#two & more |',
].join('\n');

function mkPresent(): BundleChanges {
  return {kind: 'present', sinceRef: 'v0', changelogMarkdown: CHANGELOG_MD, auditMarkdown: AUDIT_MD};
}

function mkInputs(overrides: Partial<BundleInputs> = {}): BundleInputs {
  return {
    spec: mkSpec(),
    panel: mkPanel(),
    provenance: {
      gitHead: 'deadbeefcafe00000000000000000000deadbeef',
      version: '9.9.9-test',
      generatedAt: '2026-07-01T12:00:00.000Z',
    },
    catalogMarkdown: CATALOG_MD,
    changes: mkPresent(),
    ...overrides,
  };
}

/** The seven section anchors in the order the bundle must present them. */
const SECTION_IDS = ['provenance', 'overview', 'matrix', 'catalog', 'changes', 'audit', 'attestation'] as const;

const OMITTED_NOTICE = 'Omitted — no anchor ref resolved';

// ─── AC-9f191790 / AC-f511c519 / AC-15bb0b99 / AC-0116e8d0 (pure) ────────────

describe('report/bundle — buildBundleHtml (F-e940fffe)', () => {
  test('AC-9f191790 · renders all seven sections (provenance + six content) in order', () => {
    const html = buildBundleHtml(mkInputs());
    const positions = SECTION_IDS.map((id) => html.indexOf(`<section id="${id}"`));
    for (const [i, pos] of positions.entries()) {
      expect(pos, `section ${SECTION_IDS[i]} missing`).toBeGreaterThanOrEqual(0);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `${SECTION_IDS[i]} out of order`).toBeGreaterThan(positions[i - 1]);
    }
    // Section substance, not just anchors: matrix rows, catalog, changes, audit, attestation.
    expect(count(html, '<span class="badge')).toBe(3); // one badge per matrix row
    expect(html).toContain('<h3>Payments</h3>'); // catalog ## → h3
    expect(html).toContain('charge flow shipped'); // changelog content
    expect(html).toContain('tests/a.test.ts#one'); // audit table content (ids kept)
    expect(html).toContain('need attention'); // attestation summary stat
    // Overview inventory counts render.
    expect(html).toContain('A probe project for bundle tests');
    expect(html).toContain('Matrix rows: 3 features.');
  });

  test('AC-9f191790 · zero network surface — no script/src/link/@import/url(, anchors only', () => {
    const html = buildBundleHtml(mkInputs());
    const css = executableCssContexts(html).join('\n');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\bsrc\s*=/i);
    expect(html).not.toMatch(/<link/i);
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/url\s*\(/i);
    const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0); // the nav exists
    for (const h of hrefs) {
      expect(h.startsWith('#'), `external href leaked: ${h}`).toBe(true);
    }
    // The repository URL appears as display TEXT (overview metadata), never as a link.
    expect(html).toContain('https://example.com/probe.git');
    expect(html).not.toMatch(/href="https?:/i);
  });

  test('AC-9f191790 · CSS network tokens are forbidden only in executable CSS', () => {
    const displayText = '<p>Proof reference: @import url(https://example.test/proof.css)</p>';
    expect(executableCssContexts(displayText)).toEqual([]);

    const styleBlock = '<style>@import url("https://example.test/style.css");</style>';
    expect(executableCssContexts(styleBlock).join('\n')).toMatch(/@import/);

    const inlineStyle = '<p style=\'background-image: url("https://example.test/image.png")\'>proof</p>';
    expect(executableCssContexts(inlineStyle).join('\n')).toMatch(/url\s*\(/i);
  });

  test('AC-f511c519 · provenance banner carries head sha, version, and date before the first content section', () => {
    const html = buildBundleHtml(mkInputs());
    const firstContent = html.indexOf('<section id="overview"');
    expect(firstContent).toBeGreaterThan(0);
    for (const needle of ['deadbeefcafe00000000000000000000deadbeef', '9.9.9-test', '2026-07-01T12:00:00.000Z']) {
      const idx = html.indexOf(needle);
      expect(idx, `${needle} missing`).toBeGreaterThanOrEqual(0);
      expect(idx, `${needle} not in the banner (renders after overview)`).toBeLessThan(firstContent);
    }
    expect(html.indexOf('<section id="provenance"')).toBeLessThan(firstContent);
  });

  test('AC-f511c519 · a null git head renders as "not a git repository", never blank', () => {
    const html = buildBundleHtml(
      mkInputs({provenance: {gitHead: null, version: null, generatedAt: '2026-07-01T12:00:00.000Z'}}),
    );
    expect(html).toContain('not a git repository');
    expect(html).toContain('unknown'); // version fallback
  });

  test('AC-15bb0b99 · omitted anchor degrades ONLY changes+audit to notices; the rest renders fully', () => {
    const html = buildBundleHtml(
      mkInputs({changes: {kind: 'omitted', reason: 'no tags found & --since omitted'}}),
    );
    // Exactly two omitted notices: the changes section and the audit section.
    expect(count(html, OMITTED_NOTICE)).toBe(2);
    expect(count(html, 'no tags found &amp; --since omitted')).toBe(2); // reason escaped
    const changesIdx = html.indexOf('<section id="changes"');
    const auditIdx = html.indexOf('<section id="audit"');
    expect(html.indexOf(OMITTED_NOTICE)).toBeGreaterThan(changesIdx);
    expect(html.lastIndexOf(OMITTED_NOTICE)).toBeGreaterThan(auditIdx);
    // Never all-or-nothing: matrix, catalog, and overview still carry substance.
    expect(count(html, '<span class="badge')).toBe(3);
    expect(html).toContain('<h3>Payments</h3>');
    expect(html).toContain('Matrix rows: 3 features.');
    // And the range content is genuinely absent.
    expect(html).not.toContain('charge flow shipped');
    expect(html).not.toContain('tests/a.test.ts#one');
  });

  test('AC-15bb0b99 · present changes render the changelog + audit markdown with no notice', () => {
    const html = buildBundleHtml(mkInputs());
    expect(count(html, OMITTED_NOTICE)).toBe(0);
    expect(html).toContain('<h2>Shipped changes</h2>'); // changelog # → h2
    expect(html).toContain('charge flow shipped');
  });

  test('AC-0116e8d0 · two builds from identical inputs are byte-identical', () => {
    const a = buildBundleHtml(mkInputs());
    const b = buildBundleHtml(mkInputs());
    expect(b).toBe(a);
  });

  test('AC-0116e8d0 · the generation date is the ONLY divergence between two nows', () => {
    const nowA = '2026-07-01T12:00:00.000Z';
    const nowB = '2027-01-01T00:00:00.000Z';
    const a = buildBundleHtml(mkInputs({provenance: {gitHead: 'deadbeefcafe00000000000000000000deadbeef', version: '9.9.9-test', generatedAt: nowA}}));
    const b = buildBundleHtml(mkInputs({provenance: {gitHead: 'deadbeefcafe00000000000000000000deadbeef', version: '9.9.9-test', generatedAt: nowB}}));
    expect(a).not.toBe(b);
    expect(a.split(nowA).join(nowB)).toBe(b);
  });
});

// ─── md subset converter pins (internal to the bundle; driven via inputs) ────

describe('report/bundle — markdown subset converter pins', () => {
  test('headings downshift one level (# → h2, ## → h3, ### → h4)', () => {
    const html = buildBundleHtml(mkInputs());
    expect(html).toContain('<h2>Catalog</h2>');
    expect(html).toContain('<h3>Payments</h3>');
    expect(html).toContain('<h4>Deep heading</h4>');
  });

  test('lists nest by 2-space depth classes inside one <ul>', () => {
    const html = buildBundleHtml(mkInputs());
    expect(html).toContain('<li class="d0">top item</li>');
    expect(html).toContain('<li class="d1">nested item</li>');
    expect(html).toMatch(/<ul>\n<li class="d0">top item<\/li>\n<li class="d1">nested item<\/li>\n<\/ul>/);
  });

  test('pipe tables render as thead/tbody with cell-level inline formatting', () => {
    const html = buildBundleHtml(mkInputs());
    expect(html).toContain('<table class="md"><thead><tr><th>name</th><th>count</th></tr></thead>');
    expect(html).toContain('<tr><td>payments</td><td>2</td></tr>');
  });

  test('inline bold / code / italic convert; the audit-table <br> survives escaping', () => {
    const html = buildBundleHtml(mkInputs());
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<em>ital</em>');
    // <br> protected FIRST, segments around it escaped ('&' → '&amp;').
    expect(html).toContain('<td>tests/a.test.ts#one<br>tests/b.test.ts#two &amp; more</td>');
  });

  test('raw HTML inside markdown renders escaped, never live', () => {
    const html = buildBundleHtml(
      mkInputs({catalogMarkdown: 'literal <b>html</b> & ampersand'}),
    );
    expect(html).toContain('<p>literal &lt;b&gt;html&lt;/b&gt; &amp; ampersand</p>');
    expect(html).not.toContain('<b>html</b>');
  });

  test('XSS pin · a <script> in a feature title / project name renders escaped on every surface', () => {
    const evil = 'Evil <script>alert(1)</script> feature';
    const spec: Spec = {
      ...mkSpec(),
      project: {name: 'A & B <x>', language: 'typescript'},
    };
    // att '!' puts the evil title on BOTH surfaces: matrix row + attestation list.
    const panel: PanelModel = {columns: COLUMNS, rows: [mkRow('F-aaaa1111', evil, 'done', '!')]};
    const html = buildBundleHtml(mkInputs({spec, panel}));
    expect(html).not.toMatch(/<script/i);
    expect(count(html, '&lt;script&gt;alert(1)&lt;/script&gt;')).toBe(2);
    expect(html).toContain('<title>A &amp; B &lt;x&gt; — audit bundle</title>');
  });
});

// ─── CLI integration: temp git project (report-cli.test.ts pattern) ──────────

function shard(status: string): string {
  return [
    'id: F-aaaa1111',
    'slug: owned-feature',
    'title: "Owned feature"',
    `status: ${status}`,
    'modules:',
    '  - src/owned.ts',
    'acceptance_criteria:',
    '  - id: AC-000001',
    '    ears: ubiquitous',
    '    text: "The system shall own the file."',
    '    test_refs:',
    '      - tests/owned.test.ts#owns it',
    '',
  ].join('\n');
}

const SPEC_YAML = [
  'schema: "0.1"',
  'project:',
  '  name: probe',
  '  language: typescript',
  'inventory:',
  '  features: 1',
  '  scenarios: 0',
  '  capabilities: 0',
  '  test_files: 1',
  '',
].join('\n');

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', [...args], {cwd: dir, encoding: 'utf8'});
}

describe('clad bundle + clad status --json — integration (temp git project)', () => {
  let dir: string;
  let outDir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-bundle-'));
    outDir = mkdtempSync(join(tmpdir(), 'clad-bundle-out-'));
    git(dir, ['init', '-q']);
    git(dir, ['config', 'user.email', 'test@example.com']);
    git(dir, ['config', 'user.name', 'test']);
    git(dir, ['config', 'commit.gpgsign', 'false']);
    mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
    mkdirSync(join(dir, 'src'), {recursive: true});
    writeFileSync(join(dir, 'spec.yaml'), SPEC_YAML);
    writeFileSync(join(dir, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('in_progress'));
    writeFileSync(join(dir, 'src', 'owned.ts'), 'export const owned = 1;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'baseline']);
    git(dir, ['tag', 'v0']);
    writeFileSync(join(dir, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('done'));
    writeFileSync(join(dir, 'src', 'owned.ts'), 'export const owned = 2;\n');
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', 'spec: ship owned feature']);
  });

  afterAll(() => {
    rmSync(dir, {recursive: true, force: true});
    rmSync(outDir, {recursive: true, force: true});
  });

  test('AC-e5f48ce5 · status --json emits exactly the buildPanelModel row model', () => {
    const run = runClad(dir, ['status', '--json']);
    expect(run.status, run.stderr).toBe(0);
    const parsed = JSON.parse(run.stdout) as PanelModel;
    const expected = JSON.parse(JSON.stringify(buildPanelModel(loadSpec(dir), dir))) as PanelModel;
    expect(parsed).toEqual(expected);
    // Shape sanity from the AC: stage columns then att; cells align per row.
    expect(parsed.columns[parsed.columns.length - 1]).toBe('att');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].featureId).toBe('F-aaaa1111');
    expect(parsed.rows[0].title).toBe('Owned feature');
    expect(parsed.rows[0].status).toBe('done');
    expect(parsed.rows[0].cells).toHaveLength(parsed.columns.length);
  }, 30_000);

  test('AC-0116e8d0 · the CLI gather path with an injected now is byte-identical across two runs', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const now = '2026-07-01T12:00:00.000Z';
      const out1 = join(outDir, 'b1.html');
      const out2 = join(outDir, 'b2.html');
      runBundleCommand({out: out1, cwd: dir, now});
      runBundleCommand({out: out2, cwd: dir, now});
      expect(exitSpy).toHaveBeenCalledWith(0);
      const a = readFileSync(out1, 'utf8');
      const b = readFileSync(out2, 'utf8');
      expect(b).toBe(a);
      expect(a).toContain(now); // the injected stamp landed in the banner
      expect(a).toContain('Owned feature'); // real spec content flowed through
    } finally {
      exitSpy.mockRestore();
      stdoutSpy.mockRestore();
    }
  }, 30_000);

  test('AC-15bb0b99 · a project with NO git repo still writes a bundle: exit 0, two omitted notices, matrix intact', () => {
    const bare = mkdtempSync(join(tmpdir(), 'clad-bundle-bare-'));
    try {
      mkdirSync(join(bare, 'spec', 'features'), {recursive: true});
      writeFileSync(join(bare, 'spec.yaml'), SPEC_YAML);
      writeFileSync(join(bare, 'spec', 'features', 'owned-feature-aaaa1111.yaml'), shard('done'));
      const out = join(bare, 'bundle.html');
      const run = runClad(bare, ['bundle', '--out', out]);
      expect(run.status, run.stderr).toBe(0);
      const html = readFileSync(out, 'utf8');
      expect(count(html, OMITTED_NOTICE)).toBe(2);
      expect(html).toContain('not a git repository');
      expect(count(html, '<span class="badge')).toBe(1); // the matrix still renders
    } finally {
      rmSync(bare, {recursive: true, force: true});
    }
  }, 30_000);
});

// ─── cladding-self smoke (AC-0116e8d0 size budget, AC-9f191790 real artifact) ─

describe('clad bundle — cladding-self smoke (F-e940fffe)', () => {
  test('AC-0116e8d0 · cladding-self bundle is <5MB, structurally sound, one matrix row per feature shard', () => {
    const outDir = mkdtempSync(join(tmpdir(), 'clad-bundle-self-'));
    const out = join(outDir, 'self.html');
    try {
      const run = runClad(REPO, ['bundle', '--out', out]);
      expect(run.status, run.stderr).toBe(0);
      const html = readFileSync(out, 'utf8');
      // Size budget.
      expect(Buffer.byteLength(html, 'utf8')).toBeLessThan(5 * 1024 * 1024);
      // Structural HTML: DOCTYPE prefix, exactly one balanced <html>…</html>.
      expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
      expect(count(html, '<html')).toBe(1);
      expect(count(html, '</html>')).toBe(1);
      expect(html.trimEnd().endsWith('</html>')).toBe(true);
      // One matrix row per feature shard — dynamic, not a hardcoded number.
      const shardCount = readdirSync(join(REPO, 'spec', 'features')).filter((f) => f.endsWith('.yaml')).length;
      const rows = count(html, '<span class="badge');
      expect(rows).toBeGreaterThanOrEqual(200);
      expect(rows).toBe(shardCount);
      // Zero network surface on the REAL artifact too.
      const css = executableCssContexts(html).join('\n');
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<link/i);
      expect(html).not.toMatch(/\ssrc=["']/i);
      expect(css).not.toMatch(/@import/);
      expect(css).not.toMatch(/url\s*\(/i);
      const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
      for (const h of hrefs) {
        expect(h.startsWith('#'), `external href leaked: ${h}`).toBe(true);
      }
      // Provenance banner is live: this repo's HEAD sha appears near the top.
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: REPO, encoding: 'utf8'}).trim();
      expect(html.indexOf(head)).toBeGreaterThanOrEqual(0);
      expect(html.indexOf(head)).toBeLessThan(html.indexOf('<section id="overview"'));
    } finally {
      rmSync(outDir, {recursive: true, force: true});
    }
  }, 120_000);
});
