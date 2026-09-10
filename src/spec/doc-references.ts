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
//   • EXCLUDE fixture/benchmark dirs from the ORGANIC scan (their prose ids +
//     relative links live in a separate namespace) — but an EXPLICIT
//     declaration still binds there, so an evidence doc parked under
//     docs/ab-evaluation can opt precise features into the graph (B9: the five
//     A/B case studies report findings without ever naming an F-id);
//   • SKIP code spans (fenced ``` and inline `…`) — that is where format
//     examples like `F-abc123` live;
//   • per-file opt-out: a doc carrying the `clad-doc-links: ignore` marker is
//     exempt from F-id resolution (teaching docs full of illustrative ids),
//     while its dead-link check still applies;
//   • explicit declaration: a machine-directed comment
//     `<!-- clad-doc-links: F-16138071, F-06dfdad6 -->` binds the doc to the
//     named features even when its prose never mentions an F-id (and even in an
//     excluded dir). One line may name many ids; many lines union. A value that
//     starts with `ignore` is the opt-out sentinel above, never a declaration —
//     so an ignore comment may safely spell out illustrative example ids.

import {lstatSync, readlinkSync, readdirSync, readFileSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';

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
const MD_LINK_RE = /\]\(\s*([^)\s]+?\.md)(#[^)]*)?\s*\)/g;

/**
 * Explicit, machine-directed binding — a `clad-doc-links:` comment naming one or
 * more feature ids, e.g. `<!-- clad-doc-links: F-16138071, F-06dfdad6 -->`.
 * Captures the value up to end-of-line or the comment close `>`.
 */
const DOC_LINKS_DECL_RE = /clad-doc-links:[ \t]*([^\n>]*)/g;

/**
 * F-ids named in explicit `clad-doc-links:` declarations (sorted, deduped). A
 * declaration whose value starts with `ignore` is the per-doc opt-out sentinel
 * (DOC_LINKS_IGNORE_MARKER), never a binding — so an ignore comment may spell
 * out illustrative ids without them being extracted. Runs on the code-span-
 * stripped prose, so a declaration shown inside a fence (teaching example) is
 * inert, matching how organic F-ids are scoped.
 */
function declarationFacts(prose: string): {readonly facts: readonly DocumentFeatureFact[]; readonly ignoresOrganic: boolean} {
  const facts: DocumentFeatureFact[] = [];
  let ignoresOrganic = false;
  const occurrences = new Map<string, number>();
  for (const declaration of prose.matchAll(DOC_LINKS_DECL_RE)) {
    const value = declaration[1];
    if (value.trim().startsWith('ignore')) {
      ignoresOrganic = true;
      continue;
    }
    for (const id of value.matchAll(featureIdRe('g')) ?? []) {
      const occurrence = nextOccurrence(occurrences, id[0]);
      facts.push(Object.freeze({
        featureId: id[0],
        raw: id[0],
        selector: stableSelector('declaration', {featureId: id[0]}, occurrence),
      }));
    }
  }
  return Object.freeze({facts: Object.freeze(facts), ignoresOrganic});
}

/** Per-doc extracted edges. Paths are cwd-relative posix. */
export interface DocLinks {
  readonly doc: string;
  /**
   * F-ids bound to this doc (sorted, deduped): those referenced in prose plus
   * any named in an explicit `clad-doc-links:` declaration. Empty when the doc
   * opted out and declared nothing. For an excluded dir, ONLY declared ids.
   */
  readonly features: readonly string[];
  /** Relative .md link targets, resolved to cwd-relative posix paths (sorted, deduped). */
  readonly doc_links: readonly string[];
}

export interface DocRefScan {
  readonly docs: readonly DocLinks[];
}

/** One provenance-distinct feature identifier found in a Markdown document. */
export interface DocumentFeatureFact {
  /** The feature identifier normalized by the shared feature-id lexer. */
  readonly featureId: string;
  /** Exact identifier spelling retained for diagnosis and graph export. */
  readonly raw: string;
  /** Stable source selector for this one occurrence. */
  readonly selector: string;
}

/** One tracked repository-local Markdown link found in a document. */
export interface DocumentLinkFact {
  /** Exact Markdown destination spelling, including a fragment when present. */
  readonly raw: string;
  /** Optional exact destination fragment spelling without its leading `#`. */
  readonly targetSelector?: string;
  /** Normalized repository-relative target when the link stays in the workspace. */
  readonly target: string;
  /** Stable source selector for this one occurrence. */
  readonly selector: string;
  /** Structural link resolution, never an assertion of document correctness. */
  readonly state: 'resolved' | 'unresolved';
}

/** One rejected local Markdown target that must not enter a graph address. */
export interface DocumentLinkIssue {
  /** Stable issue classification for a path that cannot safely remain local. */
  readonly kind: 'unsafe_local_markdown_path';
  /** Exact Markdown destination spelling, including a fragment when present. */
  readonly raw: string;
  /** Stable source selector for this one unsafe occurrence. */
  readonly selector: string;
  /** Why the authored spelling cannot become a repository-local target. */
  readonly reason: 'absolute_path' | 'path_escapes_workspace' | 'symlink_escape';
}

/** One Markdown artifact candidate with facts deliberately separated by provenance. */
export interface DocumentFactDocument {
  /** Canonical repository-relative Markdown path. */
  readonly doc: string;
  /** Fixture and benchmark documents retain artifacts but not organic/link facts. */
  readonly excluded: boolean;
  /** Whether the document bytes were available to the rich scanner. */
  readonly readable: boolean;
  /** Machine-directed declarations that may authoritatively explain features. */
  readonly explicit: readonly DocumentFeatureFact[];
  /** Prose feature-id mentions, which never contribute artifact ownership. */
  readonly organic: readonly DocumentFeatureFact[];
  /** Repository-local Markdown links with their structural resolution state. */
  readonly links: readonly DocumentLinkFact[];
  /** Unsafe local Markdown spellings retained for diagnosis but never projected. */
  readonly issues: readonly DocumentLinkIssue[];
  /** Historical projection targets, retained byte-for-byte for the legacy writer. */
  readonly projectionLinks: readonly string[];
}

/** Complete-or-unknown document scan consumed by the document GraphIR adapter. */
export interface DocumentFactScan {
  /** Every safely enumerated Markdown document under docs/, even without edges. */
  readonly docs: readonly DocumentFactDocument[];
  /** An unsafe or incomplete filesystem inspection is never represented as empty success. */
  readonly completeness: 'complete' | 'unknown';
  /** Stable reasons for an incomplete filesystem inspection. */
  readonly unknownReasons: readonly string[];
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

/**
 * Makes an exact fact selector from canonical fact content, never its moving
 * source location. The ordinal differentiates only identical fact keys.
 */
function stableSelector(kind: string, fact: Readonly<Record<string, string>>, occurrence: number): string {
  return `${kind}:${JSON.stringify({fact, occurrence})}`;
}

/** Returns the ordinal within one identical fact key without coupling other facts. */
function nextOccurrence(occurrences: Map<string, number>, key: string): number {
  const occurrence = occurrences.get(key) ?? 0;
  occurrences.set(key, occurrence + 1);
  return occurrence;
}

/** Safely walks docs/ without treating traversal failures as an empty document set. */
function listDocumentPaths(cwd: string): {readonly docs: readonly string[]; readonly unknownReasons: readonly string[]} {
  const rootRelative = 'docs';
  const root = join(cwd, rootRelative);
  const docs: string[] = [];
  const unknownReasons: string[] = [];
  try {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink()) {
      unknownReasons.push('document scan refuses symlink traversal: docs');
      return freezePathScan(docs, unknownReasons);
    }
    if (!rootStat.isDirectory()) {
      unknownReasons.push('document scan root is not a directory: docs');
      return freezePathScan(docs, unknownReasons);
    }
  } catch (error) {
    if ((error as {code?: unknown}).code !== 'ENOENT') unknownReasons.push('document scan cannot inspect docs');
    return freezePathScan(docs, unknownReasons);
  }
  const queue: string[] = [root];
  while (queue.length > 0) {
    const directory = queue.pop()!;
    const directoryRelative = toPosix(relative(cwd, directory));
    let entries: string[];
    try {
      entries = readdirSync(directory).sort();
    } catch {
      unknownReasons.push(`document scan cannot read directory: ${directoryRelative}`);
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue;
      const absolute = join(directory, name);
      const repoPath = toPosix(relative(cwd, absolute));
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        unknownReasons.push(`document scan cannot inspect path: ${repoPath}`);
        continue;
      }
      if (stat.isSymbolicLink()) {
        unknownReasons.push(`document scan refuses symlink traversal: ${repoPath}`);
      } else if (stat.isDirectory()) {
        queue.push(absolute);
      } else if (stat.isFile() && name.endsWith('.md')) {
        docs.push(repoPath);
      }
    }
  }
  return freezePathScan(docs, unknownReasons);
}

function freezePathScan(docs: readonly string[], unknownReasons: readonly string[]): {readonly docs: readonly string[]; readonly unknownReasons: readonly string[]} {
  return Object.freeze({
    docs: Object.freeze([...new Set(docs)].sort()),
    unknownReasons: Object.freeze([...new Set(unknownReasons)].sort()),
  });
}

/** Resolves a repository-local Markdown target without ever inspecting outside cwd. */
function trackedLinkTarget(cwd: string, docRel: string, raw: string): {
  readonly target: string;
  readonly state: 'resolved' | 'unresolved';
  readonly unknownReason?: string;
} | {readonly unsafe: DocumentLinkIssue['reason']} | undefined {
  const root = resolve(cwd);
  // A protocol-relative URL has the same leading slashes as a POSIX path, but
  // its Markdown meaning is external and it must never become a repository
  // safety finding or GraphIR target.
  if (raw.startsWith('//')) return undefined;
  if (isAbsoluteMarkdownPath(raw)) return Object.freeze({unsafe: 'absolute_path'});
  if (isExternalMarkdownTarget(raw)) return undefined;
  const absolute = resolve(root, dirname(docRel), raw.replaceAll('\\', '/'));
  const target = toPosix(relative(root, absolute));
  if (!isWorkspaceRelative(target)) return Object.freeze({unsafe: 'path_escapes_workspace'});
  let current = root;
  const parts = target.split('/');
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return Object.freeze({target, state: 'unresolved'});
    }
    if (stat.isSymbolicLink()) {
      if (symlinkPathEscapesWorkspace(root, target)) return Object.freeze({unsafe: 'symlink_escape'});
      return Object.freeze({
        target,
        state: 'unresolved',
        unknownReason: `document scan refuses symlink traversal: ${target}`,
      });
    }
    if (index < parts.length - 1 && !stat.isDirectory()) return Object.freeze({target, state: 'unresolved'});
    if (index === parts.length - 1) return Object.freeze({target, state: stat.isFile() ? 'resolved' : 'unresolved'});
  }
  return Object.freeze({target, state: 'unresolved'});
}

/** Identifies non-file RFC-style Markdown destinations. */
function isExternalMarkdownTarget(raw: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw) && !/^file:/i.test(raw);
}

/** Rejects POSIX, Windows-drive, and backslash-rooted local Markdown targets. */
function isAbsoluteMarkdownPath(raw: string): boolean {
  return raw.startsWith('/') || raw.startsWith('\\') || /^file:/i.test(raw) || /^[A-Za-z]:[\\/]/.test(raw);
}

/** Checks a relative result without accepting the root itself or an upward escape. */
function isWorkspaceRelative(target: string): boolean {
  return target.length > 0 && target !== '..' && !target.startsWith('../') && !target.startsWith('..\\');
}

/** Follows only in-workspace symlink metadata to reject an escaping target chain. */
function symlinkPathEscapesWorkspace(root: string, target: string): boolean {
  const pending = target.split('/');
  const visited = new Set<string>();
  let current = root;
  while (pending.length > 0) {
    current = join(current, pending.shift()!);
    let stat;
    try {
      stat = lstatSync(current);
    } catch {
      return false;
    }
    if (!stat.isSymbolicLink()) continue;
    if (visited.has(current)) return false;
    visited.add(current);
    let rawTarget: string;
    try {
      rawTarget = readlinkSync(current);
    } catch {
      return false;
    }
    const resolvedTarget = resolve(dirname(current), rawTarget);
    const relativeTarget = relative(root, resolvedTarget);
    if (!isWithinWorkspace(relativeTarget)) return true;
    const remainder = pending.splice(0);
    if (relativeTarget.length > 0) pending.push(...toPosix(relativeTarget).split('/'));
    pending.push(...remainder);
    current = root;
  }
  return false;
}

/** Checks a relative result against cwd while allowing cwd itself for symlink expansion. */
function isWithinWorkspace(target: string): boolean {
  return target === '' || isWorkspaceRelative(target);
}

/** Formats one stable reason without exposing an unsafe path as a graph target. */
function unsafeLinkReason(doc: string, issue: DocumentLinkIssue): string {
  return `unsafe local Markdown path (${issue.reason}) at ${doc}#${issue.selector}: ${JSON.stringify(issue.raw)}`;
}

/**
 * Performs the provenance-preserving document scan used by GraphIR. Unlike the
 * historical projection, this keeps every safe docs/*.md artifact candidate and
 * returns explicit incompleteness reasons instead of silently skipping failures.
 */
export function scanDocumentFacts(cwd: string = '.'): DocumentFactScan {
  const paths = listDocumentPaths(cwd);
  const docs: DocumentFactDocument[] = [];
  const unknownReasons = [...paths.unknownReasons];
  for (const doc of paths.docs) {
    const excluded = isExcluded(doc);
    let raw: string;
    try {
      raw = readFileSync(join(cwd, doc), 'utf8');
    } catch {
      unknownReasons.push(`document scan cannot read document: ${doc}`);
      docs.push(Object.freeze({
        doc, excluded, readable: false, explicit: Object.freeze([]), organic: Object.freeze([]), links: Object.freeze([]), issues: Object.freeze([]), projectionLinks: Object.freeze([]),
      }));
      continue;
    }
    const prose = stripCodeSpans(raw);
    const declarations = declarationFacts(prose);
    const organic: DocumentFeatureFact[] = [];
    if (!excluded && !declarations.ignoresOrganic) {
      const proseWithoutDeclarations = prose.replace(DOC_LINKS_DECL_RE, ' ');
      const occurrences = new Map<string, number>();
      for (const id of proseWithoutDeclarations.matchAll(featureIdRe('g')) ?? []) {
        const occurrence = nextOccurrence(occurrences, id[0]);
        organic.push(Object.freeze({
          featureId: id[0], raw: id[0], selector: stableSelector('mention', {featureId: id[0]}, occurrence),
        }));
      }
    }
    const links: DocumentLinkFact[] = [];
    const issues: DocumentLinkIssue[] = [];
    const projectionLinks = new Set<string>();
    if (!excluded) {
      const occurrences = new Map<string, number>();
      for (const link of prose.matchAll(MD_LINK_RE)) {
        const rawLink = `${link[1]}${link[2] ?? ''}`;
        const tracked = trackedLinkTarget(cwd, doc, link[1]);
        if (!tracked) continue;
        const occurrence = nextOccurrence(occurrences, rawLink);
        if ('unsafe' in tracked) {
          const issue = Object.freeze({
            kind: 'unsafe_local_markdown_path' as const,
            raw: rawLink,
            selector: stableSelector('link', {raw: rawLink}, occurrence),
            reason: tracked.unsafe,
          });
          issues.push(issue);
          unknownReasons.push(unsafeLinkReason(doc, issue));
          continue;
        }
        if (tracked.unknownReason !== undefined) unknownReasons.push(tracked.unknownReason);
        links.push(Object.freeze({
          raw: rawLink,
          ...(link[2] === undefined ? {} : {targetSelector: link[2].slice(1)}),
          target: tracked.target,
          selector: stableSelector('link', {raw: rawLink, target: tracked.target}, occurrence),
          state: tracked.state,
        }));
        projectionLinks.add(tracked.target);
      }
    }
    docs.push(Object.freeze({
      doc,
      excluded,
      readable: true,
      explicit: declarations.facts,
      organic: Object.freeze(organic),
      links: Object.freeze(links),
      issues: Object.freeze(issues),
      projectionLinks: Object.freeze([...projectionLinks].sort()),
    }));
  }
  return Object.freeze({
    docs: Object.freeze(docs),
    completeness: unknownReasons.length === 0 ? 'complete' : 'unknown',
    unknownReasons: Object.freeze([...new Set(unknownReasons)].sort()),
  });
}

/**
 * Extracts doc→spec (F-id) and doc→doc (.md link) edges from every markdown
 * file under docs/, applying the scoping rules. Pure read of the filesystem.
 */
export function extractDocReferences(cwd: string = '.'): DocRefScan {
  const docs: DocLinks[] = [];
  for (const document of scanDocumentFacts(cwd).docs) {
    if (!document.readable) continue;
    const declared = document.explicit.map((fact) => fact.featureId);
    if (document.excluded) {
      // Fixture/benchmark dirs contribute ONLY explicit declarations — their
      // organic ids and relative links belong to a separate namespace. With no
      // declaration the doc stays absent from the index, byte-identical to the
      // pre-declaration behaviour (so adopter repos see no churn).
      if (declared.length === 0) continue;
      docs.push({doc: document.doc, features: [...new Set(declared)].sort(), doc_links: []});
      continue;
    }
    docs.push({
      doc: document.doc,
      features: [...new Set([...document.organic.map((fact) => fact.featureId), ...declared])].sort(),
      doc_links: document.projectionLinks,
    });
  }
  return {docs};
}

/** Renders the deterministic doc-link projection without performing a write. */
export function renderDocLinksYaml(cwd: string = '.'): string | null {
  const scan = extractDocReferences(cwd);
  if (scan.docs.length === 0) return null;
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
  return `${lines.join('\n')}\n`;
}
