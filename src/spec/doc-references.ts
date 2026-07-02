// Cladding · spec · doc → spec / doc → doc reference extraction — F-doc-graph
//
// The "all documents connected, always current" half of the knowledge graph.
// docs/*.md carry F-id references and relative .md links that NOTHING validates
// today — a renamed/archived feature silently rots the prose, and a moved doc
// leaves dead links. This module extracts both edge kinds so DOC_LINK_INTEGRITY
// can enforce them and `clad sync` can materialise spec/_doc-links.yaml (the
// greppable "which docs explain feature X" index + the graph-export source).
//
// Scoping is deliberate (ground-truth: 16/36 doc F-ids legitimately don't
// resolve — fixture-project ids + format examples):
//   • EXCLUDE fixture/benchmark dirs (their ids live in a separate namespace);
//   • SKIP code spans (fenced ``` and inline `…`) — that is where format
//     examples like `F-abc123` live;
//   • per-file opt-out: a doc carrying the `clad-doc-links: ignore` marker is
//     exempt from F-id resolution (teaching docs full of illustrative ids),
//     while its dead-link check still applies.

import {existsSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, normalize, relative} from 'node:path';

import {featureIdRe} from './feature-id.js';

/** Dir prefixes (cwd-relative, posix) whose F-ids belong to a separate namespace. */
export const DOC_SCAN_EXCLUDE: readonly string[] = [
  'docs/ab-evaluation',
  'docs/ab-evaluation-extended',
  'docs/dogfood',
  'docs/benchmarks',
];

/** A doc carrying this HTML-comment marker is exempt from F-id resolution. */
export const DOC_LINKS_IGNORE_MARKER = 'clad-doc-links: ignore';

// Canonical F-id lexer (legacy F-NNN + hash) — see src/spec/feature-id.ts.
/** Markdown inline link to a relative .md target: `](path.md)` or `](path.md#anchor)`. */
const MD_LINK_RE = /\]\(\s*([^)\s]+?\.md)(?:#[^)]*)?\s*\)/g;

/** Per-doc extracted edges. Paths are cwd-relative posix. */
export interface DocLinks {
  readonly doc: string;
  /** F-ids referenced in prose (sorted, deduped). Empty when the doc opted out. */
  readonly features: readonly string[];
  /** Relative .md link targets, resolved to cwd-relative posix paths (sorted, deduped). */
  readonly doc_links: readonly string[];
}

export interface DocRefScan {
  readonly docs: readonly DocLinks[];
}

/** Removes fenced and inline code spans so format examples don't read as refs. */
export function stripCodeSpans(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]*`/g, ' ');
}

function toPosix(p: string): string {
  return p.split('\\').join('/');
}

function isExcluded(relPosix: string): boolean {
  return DOC_SCAN_EXCLUDE.some((prefix) => relPosix === prefix || relPosix.startsWith(`${prefix}/`));
}

/** Walks docs/ for *.md, skipping excluded dirs and dotfiles. cwd-relative posix paths. */
function listDocs(cwd: string): string[] {
  const root = join(cwd, 'docs');
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const abs = join(dir, name);
      let s;
      try {
        s = statSync(abs);
      } catch {
        continue;
      }
      const rel = toPosix(relative(cwd, abs));
      if (isExcluded(rel)) continue;
      if (s.isDirectory()) queue.push(abs);
      else if (name.endsWith('.md')) out.push(rel);
    }
  }
  return out.sort();
}

/** Resolves a relative .md link from a doc to a cwd-relative posix path; null for external. */
function resolveLink(docRel: string, link: string): string | null {
  if (/^[a-z]+:/i.test(link)) return null; // http(s):, mailto:, etc.
  const joined = normalize(join(dirname(docRel), link));
  return toPosix(joined);
}

/**
 * Extracts doc→spec (F-id) and doc→doc (.md link) edges from every markdown
 * file under docs/, applying the scoping rules. Pure read of the filesystem.
 */
export function extractDocReferences(cwd: string = '.'): DocRefScan {
  const docs: DocLinks[] = [];
  for (const docRel of listDocs(cwd)) {
    let raw: string;
    try {
      raw = readFileSync(join(cwd, docRel), 'utf8');
    } catch {
      continue;
    }
    const optedOut = raw.includes(DOC_LINKS_IGNORE_MARKER);
    const prose = stripCodeSpans(raw);

    const features = optedOut ? [] : [...new Set(prose.match(featureIdRe('g')) ?? [])].sort();

    const links = new Set<string>();
    for (const m of prose.matchAll(MD_LINK_RE)) {
      const resolved = resolveLink(docRel, m[1]);
      if (resolved) links.add(resolved);
    }
    docs.push({doc: docRel, features, doc_links: [...links].sort()});
  }
  return {docs};
}

/**
 * Writes spec/_doc-links.yaml — the Tier-C, deterministic, git-merge-friendly
 * doc→spec/doc index `clad sync` maintains. Returns false when there are no docs.
 */
export function writeDocLinksYaml(cwd: string = '.'): boolean {
  const scan = extractDocReferences(cwd);
  if (scan.docs.length === 0) return false;
  const lines: string[] = [
    '# Cladding · Tier C — generated doc→spec / doc→doc link index (`clad sync`). Do not edit by hand.',
    '# Source of truth is the docs themselves; DOC_LINK_INTEGRITY validates resolution.',
    'schema: "0.1"',
    'docs:',
  ];
  for (const d of scan.docs) {
    if (d.features.length === 0 && d.doc_links.length === 0) continue;
    lines.push(`  ${JSON.stringify(d.doc)}:`);
    if (d.features.length > 0) lines.push(`    features: [${d.features.join(', ')}]`);
    if (d.doc_links.length > 0) {
      lines.push(`    doc_links: [${d.doc_links.map((l) => JSON.stringify(l)).join(', ')}]`);
    }
  }
  writeFileSync(join(cwd, 'spec', '_doc-links.yaml'), `${lines.join('\n')}\n`, 'utf8');
  return true;
}
