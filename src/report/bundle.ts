// Cladding · report · self-contained HTML audit bundle (F-e940fffe)
//
// Every audit surface cladding renders — the capability catalog, the shipped
// changes, the audit table, the feature × stage matrix, the attestation state —
// is CLI-locked today. The proven audience for those surfaces (non-coders,
// auditors, buyers doing due diligence) cannot run a CLI. `buildBundleHtml`
// assembles ONE self-contained HTML file they double-click: no CDN, no
// `<script src>`, no network of any kind — the offline-single-file contract the
// graph viewer shell already proved (src/graph/viewer-shell.ts). Unlike the
// viewer it needs no JS at all: static HTML + inline CSS, so nothing executes.
//
// PURE: every I/O (spec load, git HEAD, attestation read, changelog collect,
// the impure renderers that touch the filesystem) happens in the CLI wrapper
// (src/cli/clad.ts) and is passed in as data. This module only shapes bytes,
// so a fixed input yields byte-identical output — the property that makes the
// bundle diffable evidence (AC-0116e8d0). The generation date is the single
// nondeterministic input, threaded in via `provenance.generatedAt`.
//
// SOFT SHELL: the catalog + changelog renderers emit no id LABELS of their
// own — but ids an author wrote verbatim into spec prose (AC sentences,
// titles) pass through untouched: quoted content is never rewritten. The
// audit table KEEPS ids — it is the forensic surface, where an F-id is the
// point.
//
// Layer: `report` is foundation-tier (spec/architecture.yaml) — it may read the
// spec/ui models but must not reach into stages/cli/serve. It imports
// gateLabel + the PanelModel shape from the peer `ui` layer only.

import type {CellGlyph, PanelModel} from '../ui/panel.js';
import {gateLabel} from '../ui/softShell.js';
import type {Spec} from '../spec/types.js';

/** Provenance banner data (AC-f511c519) — the staleness mitigation. */
export interface BundleProvenance {
  /** `git rev-parse HEAD`, or null outside a git repo. */
  readonly gitHead: string | null;
  /** The cladding binary's package.json version, or null when unreadable. */
  readonly version: string | null;
  /** ISO-8601 generation timestamp — the ONE nondeterministic input. */
  readonly generatedAt: string;
}

/**
 * The changelog + audit sections. `present` carries the rendered markdown for
 * the resolved range; `omitted` (AC-15bb0b99) carries the reason no anchor ref
 * resolved so those two sections degrade to an explicit notice while the rest
 * of the bundle still renders — partial degrade, never all-or-nothing.
 */
export type BundleChanges =
  | {
      readonly kind: 'present';
      readonly sinceRef: string;
      /** renderChangelogMarkdown(manifest) output. */
      readonly changelogMarkdown: string;
      /** renderAuditTable(manifest, spec, cwd) output. */
      readonly auditMarkdown: string;
    }
  | {readonly kind: 'omitted'; readonly reason: string};

/** Everything buildBundleHtml needs — all pre-gathered by the CLI wrapper. */
export interface BundleInputs {
  readonly spec: Spec;
  /** The feature × stage row model (buildPanelModel), rendered as a matrix. */
  readonly panel: PanelModel;
  readonly provenance: BundleProvenance;
  /** renderCatalog(spec) output — the capability comprehension artifact. */
  readonly catalogMarkdown: string;
  readonly changes: BundleChanges;
}

/** Human meaning of each matrix glyph, shown in the legend. */
const GLYPH_MEANING: Readonly<Record<CellGlyph, string>> = {
  '✓': 'passed / verification stamp current',
  '·': 'not applicable / not run',
  '!': 'needs attention (drift, or stamp stale)',
  '✗': 'failed',
  '-': 'no signal yet',
};

/** Feature-status → readable badge label (Soft Shell; no raw enum leak). */
const STATUS_LABEL: Readonly<Record<string, string>> = {
  planned: 'planned',
  in_progress: 'in progress',
  done: 'done',
  blocked: 'blocked',
  archived: 'retired',
};

/**
 * Builds the complete single-file, offline, self-contained HTML audit bundle.
 *
 * Deterministic modulo `provenance.generatedAt`: two calls with identical
 * inputs serialize byte-identically. Emits zero external references — no CDN,
 * no `<script src>`, no `<link href>`, no remote images — so it renders with
 * the network unplugged (AC-9f191790).
 */
export function buildBundleHtml(inputs: BundleInputs): string {
  const {spec, panel, provenance, catalogMarkdown, changes} = inputs;
  const projectName = spec.project?.name ?? 'project';
  const sections = [
    provenanceBanner(provenance, projectName),
    overviewSection(spec, panel),
    matrixSection(panel),
    section('catalog', 'Capabilities', mdToHtml(catalogMarkdown)),
    changesSection(changes),
    auditSection(changes),
    attestationSection(panel),
  ];
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(projectName)} — audit bundle</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    navBar(),
    '<main>',
    ...sections,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ─── sections ───────────────────────────────────────────────────────────────

/** The top navigation strip linking to every section (in-page anchors only). */
function navBar(): string {
  const links: ReadonlyArray<readonly [string, string]> = [
    ['provenance', 'Provenance'],
    ['overview', 'Overview'],
    ['matrix', 'Status matrix'],
    ['catalog', 'Capabilities'],
    ['changes', 'Changes'],
    ['audit', 'Audit'],
    ['attestation', 'Attestation'],
  ];
  const items = links.map(([id, label]) => `<a href="#${id}">${escapeHtml(label)}</a>`).join('');
  return `<nav>${items}</nav>`;
}

/** AC-f511c519 — provenance banner: git HEAD, generation date, version. */
function provenanceBanner(p: BundleProvenance, projectName: string): string {
  const head = p.gitHead ? escapeHtml(p.gitHead) : 'not a git repository';
  const rows = [
    row('git HEAD', head),
    row('generated', escapeHtml(p.generatedAt)),
    row('cladding version', escapeHtml(p.version ?? 'unknown')),
  ].join('');
  return [
    '<section id="provenance" class="banner">',
    `<h1>${escapeHtml(projectName)} — audit bundle</h1>`,
    '<p class="stale-note">This is a point-in-time snapshot. Verify against live status before relying on it — a bundle cannot know what changed after it was generated.</p>',
    `<table class="kv">${rows}</table>`,
    '</section>',
  ].join('\n');

  function row(k: string, v: string): string {
    return `<tr><th>${escapeHtml(k)}</th><td class="mono">${v}</td></tr>`;
  }
}

/** AC-9f191790 — project header + inventory counts, plus a status breakdown. */
function overviewSection(spec: Spec, panel: PanelModel): string {
  const inv = spec.inventory ?? {};
  const featureCount = typeof inv.features === 'number' ? inv.features : spec.features.length;
  const counts: ReadonlyArray<readonly [string, number]> = [
    ['features', featureCount],
    ['scenarios', num(inv.scenarios)],
    ['capabilities', num(inv.capabilities ?? spec.capabilities?.length)],
    ['test files', num(inv.test_files)],
  ];
  const statusOrder = ['done', 'in_progress', 'blocked', 'planned', 'archived'];
  const byStatus = new Map<string, number>();
  for (const f of spec.features) byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
  const statusCells = statusOrder
    .filter((s) => (byStatus.get(s) ?? 0) > 0)
    .map((s) => stat(STATUS_LABEL[s] ?? s, byStatus.get(s) ?? 0))
    .join('');

  const desc = spec.project?.description ?? spec.project?.intent_summary;
  const meta: string[] = [];
  if (spec.project?.language) meta.push(row('language', escapeHtml(spec.project.language)));
  if (spec.project?.version) meta.push(row('project version', escapeHtml(spec.project.version)));
  if (spec.project?.repository) meta.push(row('repository', escapeHtml(spec.project.repository)));

  return [
    '<section id="overview">',
    '<h2>Overview</h2>',
    desc ? `<p class="lede">${escapeHtml(desc)}</p>` : '',
    `<div class="stats">${counts.map(([k, v]) => stat(k, v)).join('')}</div>`,
    statusCells ? `<h3>Feature status</h3><div class="stats">${statusCells}</div>` : '',
    meta.length > 0 ? `<table class="kv">${meta.join('')}</table>` : '',
    // panel.rows is the authoritative feature count the matrix renders.
    `<p class="muted">Matrix rows: ${panel.rows.length} features.</p>`,
    '</section>',
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  function stat(label: string, value: number): string {
    return `<div class="stat"><span class="num">${value}</span><span class="lbl">${escapeHtml(label)}</span></div>`;
  }
  function row(k: string, v: string): string {
    return `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`;
  }
  function num(v: unknown): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : 0;
  }
}

/** The feature × stage matrix (AC-9f191790), with a column + glyph legend. */
function matrixSection(panel: PanelModel): string {
  const cols = panel.columns;
  const headCells = cols.map((c) => `<th class="stage" title="${escapeHtml(fullColumnLabel(c))}">${escapeHtml(shortColumnLabel(c))}</th>`).join('');
  const bodyRows = panel.rows
    .map((r) => {
      const cells = r.cells
        .map((g) => `<td class="g g${glyphClass(g)}">${escapeHtml(g)}</td>`)
        .join('');
      return `<tr><th class="feat"><span class="badge b-${escapeHtml(r.status)}">${escapeHtml(STATUS_LABEL[r.status] ?? r.status)}</span>${escapeHtml(r.title)}</th>${cells}</tr>`;
    })
    .join('\n');
  const colLegend = cols
    .map((c) => `<span><code>${escapeHtml(shortColumnLabel(c))}</code> ${escapeHtml(fullColumnLabel(c))}</span>`)
    .join('');
  const glyphLegend = (Object.keys(GLYPH_MEANING) as CellGlyph[])
    .map((g) => `<span><b class="g g${glyphClass(g)}">${escapeHtml(g)}</b> ${escapeHtml(GLYPH_MEANING[g])}</span>`)
    .join('');
  return [
    '<section id="matrix">',
    '<h2>Status matrix</h2>',
    '<p class="muted">One row per feature; one column per verification stage, then attestation freshness.</p>',
    '<div class="scroll">',
    `<table class="matrix"><thead><tr><th class="feat">feature</th>${headCells}</tr></thead><tbody>`,
    bodyRows,
    '</tbody></table>',
    '</div>',
    `<div class="legend"><h3>Columns</h3>${colLegend}</div>`,
    `<div class="legend"><h3>Legend</h3>${glyphLegend}</div>`,
    '</section>',
  ].join('\n');
}

/** AC-9f191790 (changes) / AC-15bb0b99 (omitted notice). */
function changesSection(changes: BundleChanges): string {
  if (changes.kind === 'omitted') {
    return section('changes', 'Changes', omittedNotice('shipped changes', changes.reason));
  }
  return section('changes', 'Changes', mdToHtml(changes.changelogMarkdown));
}

/** AC-9f191790 (audit table) / AC-15bb0b99 (omitted notice). Ids KEPT. */
function auditSection(changes: BundleChanges): string {
  if (changes.kind === 'omitted') {
    return section('audit', 'Audit', omittedNotice('the audit table', changes.reason));
  }
  return section('audit', 'Audit', mdToHtml(changes.auditMarkdown));
}

/** Attestation summary (AC-9f191790), derived from the panel's `att` column. */
function attestationSection(panel: PanelModel): string {
  const attIdx = panel.columns.indexOf('att');
  const glyphOf = (r: PanelModel['rows'][number]): CellGlyph => (attIdx >= 0 ? r.cells[attIdx] ?? '-' : '-');
  let fresh = 0;
  let attention = 0;
  let na = 0;
  let unknown = 0;
  const needsAttention: string[] = [];
  for (const r of panel.rows) {
    const g = glyphOf(r);
    if (g === '✓') fresh++;
    else if (g === '!') {
      attention++;
      needsAttention.push(r.title);
    } else if (g === '·') na++;
    else unknown++;
  }
  const fileAbsent = fresh === 0 && attention === 0 && na === 0 && unknown === panel.rows.length;
  const stats = [
    `<div class="stat"><span class="num">${fresh}</span><span class="lbl">current</span></div>`,
    `<div class="stat"><span class="num">${attention}</span><span class="lbl">need attention</span></div>`,
    `<div class="stat"><span class="num">${na}</span><span class="lbl">n/a</span></div>`,
  ].join('');
  const body: string[] = [];
  if (fileAbsent) {
    body.push('<p class="notice">No attestation file present yet — verification state is unknown (this is not a failure; run a strict verification to stamp it).</p>');
  } else {
    body.push(`<div class="stats">${stats}</div>`);
    if (needsAttention.length > 0) {
      body.push('<h3>Features whose verification stamp needs attention</h3>');
      body.push('<ul>' + needsAttention.map((t) => `<li>${escapeHtml(t)}</li>`).join('') + '</ul>');
    }
  }
  return section('attestation', 'Attestation', body.join('\n'));
}

// ─── section + column helpers ────────────────────────────────────────────────

function section(id: string, heading: string, innerHtmlBody: string): string {
  return `<section id="${id}">\n<h2>${escapeHtml(heading)}</h2>\n${innerHtmlBody}\n</section>`;
}

function omittedNotice(what: string, reason: string): string {
  return `<p class="notice">Omitted — no anchor ref resolved, so ${escapeHtml(what)} could not be computed for a range (${escapeHtml(reason)}). The rest of this bundle still renders. Pass a valid <code>--since &lt;ref&gt;</code> or tag a release to include this section.</p>`;
}

function shortColumnLabel(col: string): string {
  if (col === 'att') return 'Att';
  return gateLabel(col).slice(0, 3);
}

function fullColumnLabel(col: string): string {
  if (col === 'att') return 'Attestation freshness';
  return gateLabel(col);
}

function glyphClass(g: CellGlyph): string {
  switch (g) {
    case '✓':
      return 'ok';
    case '✗':
      return 'bad';
    case '!':
      return 'warn';
    case '·':
      return 'na';
    default:
      return 'none';
  }
}

// ─── minimal deterministic markdown → HTML ───────────────────────────────────
//
// A purpose-built converter for the SUBSET the changelog/catalog/audit
// renderers emit — headings (#, ##, ###), `-` lists (2-space nesting), tables
// (| … | with a |---| separator), **bold**, _italic_, `code`, and the literal
// `<br>` the audit table embeds inside cells. Not a general markdown engine:
// scoped exactly to what those three renderers produce, so it stays small,
// deterministic, and dependency-free (no new npm deps). Anything unmatched
// renders as an escaped paragraph — absence renders as text, never as a crash.

function mdToHtml(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let listOpen = false;
  let i = 0;

  const closeList = (): void => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // Blank line — closes any open list, otherwise nothing.
    if (line.trim().length === 0) {
      closeList();
      i++;
      continue;
    }

    // Table: a pipe row immediately followed by a |---| separator row.
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      closeList();
      const header = splitTableCells(line);
      const bodyRows: string[][] = [];
      i += 2; // consume header + separator
      while (i < lines.length && isTableRow(lines[i])) {
        bodyRows.push(splitTableCells(lines[i]));
        i++;
      }
      out.push(renderTable(header, bodyRows));
      continue;
    }

    // Heading — downshifted by one level so a rendered `# Title` becomes the
    // section's own <h2> under the bundle's structure (max h6).
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = Math.min(heading[1].length + 1, 6);
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    // List item — depth by leading-space pairs (renderers use 0 and 2 spaces).
    const li = /^(\s*)-\s+(.*)$/.exec(line);
    if (li) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      const depth = Math.floor(li[1].length / 2);
      out.push(`<li class="d${depth}">${inlineMd(li[2])}</li>`);
      i++;
      continue;
    }

    // Anything else — a paragraph line.
    closeList();
    out.push(`<p>${inlineMd(line.trim())}</p>`);
    i++;
  }
  closeList();
  return out.join('\n');
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|[\s:|-]+\|\s*$/.test(line);
}

/** Splits `| a | b |` into ['a','b'] — drops the leading/trailing empties. */
function splitTableCells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}

function renderTable(header: readonly string[], body: readonly string[][]): string {
  const head = header.map((c) => `<th>${inlineMd(c)}</th>`).join('');
  const rows = body
    .map((cells) => `<tr>${cells.map((c) => `<td>${inlineMd(c)}</td>`).join('')}</tr>`)
    .join('\n');
  return `<table class="md"><thead><tr>${head}</tr></thead><tbody>\n${rows}\n</tbody></table>`;
}

/**
 * Inline formatting. The audit table embeds the literal `<br>` between refs, so
 * we split on it FIRST (protecting it from escaping), format + escape each
 * segment, then rejoin with a real `<br>`.
 */
function inlineMd(text: string): string {
  return text
    .split('<br>')
    .map(formatSegment)
    .join('<br>');
}

function formatSegment(seg: string): string {
  let s = escapeHtml(seg);
  // Bold, then inline code, then whole-token italic. `**`/`` ` ``/`_` survive
  // escaping (they are not HTML-special), so the regexes match on escaped text.
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|[\s(])_([^_]+)_(?=$|[\s.,;:)])/g, '$1<em>$2</em>');
  return s;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── inline stylesheet (no external refs; print-friendly) ────────────────────

const STYLES = `
:root{--fg:#1a1a1a;--muted:#666;--line:#d8d8d8;--bg:#fff;--accent:#0b5;--card:#f6f7f8;
--ok:#0a7d29;--bad:#c62828;--warn:#b26a00;--na:#9aa0a6;--none:#c4c8cc;}
*{box-sizing:border-box}
body{margin:0;color:var(--fg);background:var(--bg);
font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
nav{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;gap:2px;
padding:8px 12px;background:#111;border-bottom:1px solid #000}
nav a{color:#eee;text-decoration:none;font-size:13px;padding:3px 9px;border-radius:4px}
nav a:hover{background:#333}
main{max-width:1080px;margin:0 auto;padding:0 20px 80px}
section{padding:22px 0;border-bottom:1px solid var(--line)}
h1{font-size:24px;margin:.2em 0}
h2{font-size:19px;margin:.4em 0 .6em;padding-bottom:4px;border-bottom:2px solid var(--fg)}
h3{font-size:15px;margin:1.1em 0 .4em}
h4{font-size:14px;margin:1em 0 .3em;color:#333}
h5,h6{font-size:13px;margin:.8em 0 .3em;color:#444}
p{margin:.5em 0}
.mono,code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{background:var(--card);padding:1px 5px;border-radius:3px;font-size:.92em}
.muted,.lbl{color:var(--muted)}
.lede{font-size:15px}
.stale-note{color:var(--warn);font-size:13px;background:#fff8ec;border:1px solid #f0d9a8;
padding:8px 10px;border-radius:6px}
.banner h1{margin-top:.1em}
table.kv{border-collapse:collapse;margin:.6em 0}
table.kv th{text-align:left;color:var(--muted);font-weight:600;padding:2px 16px 2px 0;vertical-align:top}
table.kv td{padding:2px 0}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:.6em 0}
.stat{background:var(--card);border:1px solid var(--line);border-radius:8px;
padding:8px 14px;min-width:88px;text-align:center}
.stat .num{display:block;font-size:22px;font-weight:700}
.stat .lbl{font-size:12px}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:10px;
margin-right:8px;border:1px solid var(--line);color:#333;background:#fff}
.b-done{background:#e7f6ec;border-color:#a7dcb8;color:#0a5}
.b-in_progress{background:#eef3ff;border-color:#b9ccf6;color:#2c5}
.b-blocked{background:#fdecec;border-color:#f2b8b8;color:#b00}
.b-planned{background:#f4f4f5;color:#666}
.b-archived{background:#f0f0f0;color:#999}
.scroll{overflow-x:auto}
table.matrix{border-collapse:collapse;font-size:12px;width:100%}
table.matrix th,table.matrix td{border:1px solid var(--line);padding:3px 6px}
table.matrix th.feat{text-align:left;white-space:nowrap;max-width:420px;overflow:hidden;
text-overflow:ellipsis;font-weight:500}
table.matrix th.stage{writing-mode:horizontal-tb;text-align:center;font-size:11px;color:#333}
td.g{text-align:center;font-family:ui-monospace,monospace;font-weight:700}
.g.gok{color:var(--ok)}.g.gbad{color:var(--bad)}.g.gwarn{color:var(--warn)}
.g.gna{color:var(--na)}.g.gnone{color:var(--none)}
.legend{margin:.6em 0;font-size:12px;color:#444}
.legend h3{display:inline-block;margin:0 8px 0 0;font-size:12px;color:var(--muted)}
.legend span{display:inline-block;margin:0 12px 4px 0}
table.md{border-collapse:collapse;width:100%;margin:.6em 0;font-size:13px}
table.md th,table.md td{border:1px solid var(--line);padding:5px 8px;text-align:left;
vertical-align:top}
table.md th{background:var(--card)}
ul{margin:.4em 0;padding-left:22px}
li.d1{margin-left:18px;list-style:circle;color:#333}
li.d2{margin-left:36px;list-style:square}
.notice{background:#fff8ec;border:1px solid #f0d9a8;padding:10px 12px;border-radius:6px;
color:#6a4b00}
@media print{
nav{position:static;background:#fff;border-bottom:1px solid var(--line)}
nav a{color:#000}
section{page-break-inside:avoid}
.scroll{overflow:visible}
body{font-size:11px}
}
`;
