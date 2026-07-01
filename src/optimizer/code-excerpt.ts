// Cladding · optimizer · path-safe source excerpt for the working set — F-06dfdad6
//
// The working-set assembler must show an LLM the ACTUAL code of a focus feature's
// modules — but reading arbitrary paths from spec is a path-traversal + binary-dump +
// budget-blowout hazard. This reader NEVER throws: it returns an `omitted` reason for
// unsafe / unsupported / missing / binary / oversize paths, and clips long files to a
// char budget with a truncation marker. Pure given (path, cwd, budget) — readFileSync is
// the only impurity, kept out of the frozen pure context-slice (sim: backward-compat).

import {readFileSync, statSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';

/** Source-ish extensions we are willing to inline. Anything else -> omitted:'unsupported'. */
const CODE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.rs', '.go', '.java', '.kt', '.kts',
  '.cs', '.rb', '.php', '.swift', '.c', '.h', '.cpp', '.hpp', '.css', '.scss', '.sql', '.sh',
  '.yaml', '.yml', '.json', '.md', '.toml',
]);

/** Hard ceiling so a giant file is never slurped into memory before clipping. */
const MAX_READ_BYTES = 2_000_000;

/** A NUL byte marks the content as binary (skip inlining). */
const NUL = String.fromCharCode(0);

export interface CodeExcerpt {
  readonly path: string;
  /** The (possibly clipped) source — present only when readable + safe. */
  readonly text?: string;
  /** True when `text` was clipped to the char budget. */
  readonly truncated?: boolean;
  /** Why no text: 'unsafe-path' | 'unsupported' | 'missing' | 'binary' | 'too-large'. */
  readonly omitted?: string;
  readonly bytes?: number;
}

/** Project-consistent token estimate (chars / 4). */
export function estTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** True iff `rel` resolves inside `cwd` (rejects `..` escapes + absolute paths outside). */
export function withinCwd(rel: string, cwd: string): boolean {
  const root = resolve(cwd);
  const abs = resolve(root, rel);
  return abs === root || abs.startsWith(root + sep);
}

/**
 * Reads `rel` (relative to `cwd`) as a bounded, path-safe excerpt. Never throws.
 * `maxChars` caps the included text; longer files are clipped with a marker.
 */
export function codeExcerpt(rel: string, cwd: string, maxChars: number): CodeExcerpt {
  if (!withinCwd(rel, cwd)) return {path: rel, omitted: 'unsafe-path'};
  if (!CODE_EXTS.has(extname(rel).toLowerCase())) return {path: rel, omitted: 'unsupported'};
  const abs = resolve(cwd, rel);
  let bytes: number;
  try {
    bytes = statSync(abs).size;
  } catch {
    return {path: rel, omitted: 'missing'};
  }
  if (bytes > MAX_READ_BYTES) return {path: rel, omitted: 'too-large', bytes};
  let raw: string;
  try {
    raw = readFileSync(abs, 'utf8');
  } catch {
    return {path: rel, omitted: 'missing', bytes};
  }
  if (raw.includes(NUL)) return {path: rel, omitted: 'binary', bytes};
  const budget = Math.max(0, Math.floor(maxChars));
  if (raw.length <= budget) return {path: rel, text: raw, bytes};
  const marker = `\n/* ... clipped (${bytes} bytes total) ... */\n`;
  const room = Math.max(0, budget - marker.length);
  return {path: rel, text: raw.slice(0, room) + marker, truncated: true, bytes};
}
