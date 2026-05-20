// Cladding · scan · forest-level docs extraction
//
// Pulls Why / What / Purpose hints out of the README + sibling docs
// without LLM inference. The orchestrator (`index.ts`) calls into
// {@link extractProjectContext}; init.ts renders the resulting
// {@link ProjectContext} (or null) into `docs/project-context.md`.
//
// Heuristics, no AST:
//   - First paragraph = the first non-heading block in README.
//   - Headings = `^## ` lines, top 10 in document order.
//   - Doc links = ARCHITECTURE / CONTRIBUTING / GOVERNANCE +
//     docs/*.md, with each entry's first non-empty line quoted.
//   - Interface signatures = `^export (interface|class) <Name>`
//     matches across the two largest layers, three per layer.
//
// Single-bundle friendly. Every regex is anchored at line start
// so a stray export inside a string literal does not leak in.

import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';

import type {ProjectContext, SourceFile} from './types.js';

const README_CANDIDATES = ['README.md', 'README.MD', 'Readme.md', 'readme.md'];
const SIBLING_DOC_NAMES = [
  'ARCHITECTURE.md', 'CONTRIBUTING.md', 'GOVERNANCE.md',
  'SECURITY.md', 'CODE_OF_CONDUCT.md',
];
const DOCS_DIR_CANDIDATES = ['docs', 'doc'];
const TOP_DOC_LINKS = 5;
const TOP_HEADINGS = 10;
const TOP_LAYERS_FOR_SIGNATURES = 2;
const TOP_SIGNATURES_PER_LAYER = 3;

/**
 * Locates the README in `cwd` (case variants tried in order). Returns
 * the absolute path or null when none exists.
 */
function findReadmePath(cwd: string): string | null {
  for (const name of README_CANDIDATES) {
    const abs = join(cwd, name);
    try {
      if (statSync(abs).isFile()) return abs;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Returns true when a line is "decorative" — HTML wrappers, badge
 * links, image-only markdown, or the centring `<p align="center">`
 * idiom many OSS READMEs lead with. Those lines are skipped so the
 * extracted first paragraph holds actual prose.
 */
function isDecorativeLine(line: string): boolean {
  if (line === '') return true;
  if (line.startsWith('#')) return true;
  if (line.startsWith('>')) return true;
  if (line.startsWith('<!--')) return true;
  // HTML wrappers (div / p / a / br / img / span) on their own line.
  if (/^<\/?(div|p|a|br|img|span|center|h[1-6])\b/i.test(line)) return true;
  // Closing-only lines from multi-line HTML blocks.
  if (/^<\/(div|p|a|span|center|h[1-6])>$/i.test(line)) return true;
  // Badge / image-only markdown.
  if (/^\[!\[/.test(line)) return true;
  if (/^!\[/.test(line)) return true;
  return false;
}

/**
 * Strips inline HTML/markdown image+link decoration so the prose
 * paragraph reads as plain text. Conservative — only removes the
 * common decorations OSS READMEs lead with.
 */
function stripDecorationInline(line: string): string {
  // Drop image markdown `![alt](url)` and `<img ... />` entirely.
  let out = line.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<img\b[^>]*>/gi, '');
  // Drop `<a ...>` open / close tags, keep inner text.
  out = out.replace(/<\/?a\b[^>]*>/gi, '');
  // Drop the centring `<p align="center">` / `<div ...>` / `<center>`.
  out = out.replace(/<\/?(p|div|center|span)\b[^>]*>/gi, '');
  // Drop standalone badge link markdown `[![alt](badge)](href)` if
  // any survived the wrapper strip.
  out = out.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, '');
  return out.trim();
}

/**
 * Reads README first paragraph: everything after the leading
 * heading(s) up to the first empty line. Decorative leading lines
 * (HTML wrappers, badges, images) are skipped so the snippet holds
 * actual prose; surviving HTML/badge inline noise is stripped from
 * each kept line.
 */
export function extractReadmeFirstParagraph(cwd: string): string | null {
  const path = findReadmePath(cwd);
  if (!path) return null;
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const block: string[] = [];
  let started = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!started) {
      if (isDecorativeLine(line)) continue;
      started = true;
    }
    if (line === '') {
      if (block.length > 0) break;
      continue;
    }
    const stripped = stripDecorationInline(line);
    if (stripped === '') continue;
    block.push(stripped);
  }
  if (block.length === 0) return null;
  return block.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Pulls the top-N `## ` headings from README in document order.
 */
export function extractReadmeHeadings(cwd: string): readonly string[] {
  const path = findReadmePath(cwd);
  if (!path) return [];
  const text = readFileSync(path, 'utf8');
  const out: string[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (!m) continue;
    out.push(m[1]);
    if (out.length >= TOP_HEADINGS) break;
  }
  return out;
}

/**
 * Discovers sibling design / governance docs and quotes each one's
 * first non-empty content line. Returns up to {@link TOP_DOC_LINKS}.
 */
export function extractDocLinks(cwd: string): readonly {readonly path: string; readonly firstLine: string}[] {
  const out: {path: string; firstLine: string}[] = [];
  // Top-level sibling docs.
  for (const name of SIBLING_DOC_NAMES) {
    const abs = join(cwd, name);
    if (!existsSync(abs)) continue;
    const firstLine = readFirstContentLine(abs);
    if (firstLine !== null) out.push({path: name, firstLine});
  }
  // docs/* — peek first 5 markdown files alphabetically.
  for (const dir of DOCS_DIR_CANDIDATES) {
    const docsAbs = join(cwd, dir);
    if (!existsSync(docsAbs) || !statSync(docsAbs).isDirectory()) continue;
    const entries = readdirSync(docsAbs).filter((e) => e.toLowerCase().endsWith('.md')).sort();
    for (const e of entries) {
      const abs = join(docsAbs, e);
      const firstLine = readFirstContentLine(abs);
      if (firstLine === null) continue;
      out.push({path: `${dir}/${e}`, firstLine});
      if (out.length >= TOP_DOC_LINKS) break;
    }
    if (out.length >= TOP_DOC_LINKS) break;
  }
  return out.slice(0, TOP_DOC_LINKS);
}

function readFirstContentLine(absPath: string): string | null {
  try {
    const text = readFileSync(absPath, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('<!--')) continue;
      // Strip leading markdown heading punctuation so the snippet
      // reads as prose ("# Title" → "Title").
      const cleaned = line.replace(/^#+\s*/, '').trim();
      if (cleaned.length === 0) continue;
      return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * For each of the two largest layers (by module count), returns up
 * to three `export interface` / `export class` signatures so the
 * project-context document can quote a representative shape.
 */
export function extractInterfaceSignatures(
  filesByLayer: ReadonlyMap<string, readonly SourceFile[]>,
): readonly {readonly layer: string; readonly signatures: readonly string[]}[] {
  const layersByCount = [...filesByLayer.entries()]
    .filter(([name]) => name !== '_root')
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, TOP_LAYERS_FOR_SIGNATURES);
  const out: {layer: string; signatures: string[]}[] = [];
  for (const [layer, files] of layersByCount) {
    const sigs: string[] = [];
    for (const f of files) {
      if (!/\.(ts|tsx)$/.test(f.relPath)) continue;
      for (const line of f.content.split('\n')) {
        const m = line.match(/^export\s+(?:abstract\s+)?(interface|class)\s+(\w+)/);
        if (m) {
          // Quote the full signature up to the opening brace so the
          // snippet stays informative without dragging in the body.
          const trimmed = line.replace(/\s*\{[\s\S]*$/, '').trim();
          sigs.push(`// ${f.relPath}\n${trimmed}`);
        }
        if (sigs.length >= TOP_SIGNATURES_PER_LAYER) break;
      }
      if (sigs.length >= TOP_SIGNATURES_PER_LAYER) break;
    }
    if (sigs.length > 0) out.push({layer, signatures: sigs});
  }
  return out;
}

/**
 * Composes the {@link ProjectContext} record. Returns null when the
 * project has neither a README nor any sibling docs *and* the
 * file-by-layer map is empty — there is nothing observable to surface.
 */
export function extractProjectContext(
  cwd: string,
  filesByLayer: ReadonlyMap<string, readonly SourceFile[]>,
): ProjectContext | null {
  const readmeFirstParagraph = extractReadmeFirstParagraph(cwd);
  const readmeHeadings = extractReadmeHeadings(cwd);
  const docLinks = extractDocLinks(cwd);
  const interfaceSignatures = extractInterfaceSignatures(filesByLayer);
  if (
    readmeFirstParagraph === null &&
    readmeHeadings.length === 0 &&
    docLinks.length === 0 &&
    interfaceSignatures.length === 0
  ) {
    return null;
  }
  return {readmeFirstParagraph, readmeHeadings, docLinks, interfaceSignatures};
}
