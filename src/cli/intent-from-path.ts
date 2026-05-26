// Cladding · `clad init` path-aware intent loader (F-5f6b45)
//
// When the user types `clad init docs/plan.md` (or any text-file path,
// absolute or relative), we want the LLM dispatcher to see the *file
// contents* as intent — not the literal string "docs/plan.md".
//
// The LLM has no filesystem access; cladding must load the file before
// composing the onboarding prompt. This module is the pure helper that
// init.ts calls in front of `intent-onboarding.ts`.
//
// Heuristic: recognized text-file extension (.md / .txt / .yaml / .yml /
// .markdown) + existsSync true + isFile true + readable as UTF-8. Anything
// else falls back to free-text intent so existing CLI invocations stay
// regression-free.

import {existsSync, readFileSync, statSync} from 'node:fs';
import {isAbsolute, resolve} from 'node:path';

const TEXT_EXTENSIONS = ['.md', '.txt', '.yaml', '.yml', '.markdown'] as const;

export interface IntentResolution {
  /** Text to forward to the onboarding LLM dispatcher. */
  readonly intent: string;
  /** Absolute path of the file that was loaded, when path-aware loading fired. */
  readonly loadedFrom?: string;
  /** Stderr warning when the argument looked path-like but was unusable. */
  readonly warning?: string;
}

/**
 * Inspect a positional `clad init` argument. When it looks like a text-file
 * path (recognized extension) and the file exists under the given cwd, return
 * its contents as the intent. Otherwise, return the input unchanged.
 *
 * Pure helper — synchronous fs only, no side effects. Callers decide what to
 * do with `warning` (typically `process.stderr.write`).
 */
export function loadIntentFromPathIfApplicable(
  text: string,
  cwd: string,
): IntentResolution {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return {intent: text};
  }

  if (!hasRecognizedExtension(trimmed)) {
    // Free-text intent (e.g. "결제 SaaS 만들거야") — preserve verbatim.
    return {intent: text};
  }

  const absolutePath = isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);

  if (!existsSync(absolutePath)) {
    return {
      intent: text,
      warning: `path-like intent "${trimmed}" did not resolve to an existing file (looked at ${absolutePath}); falling back to free-text intent`,
    };
  }

  let stat;
  try {
    stat = statSync(absolutePath);
  } catch (err) {
    return {
      intent: text,
      warning: `path-like intent "${trimmed}" could not be stat'd (${describeError(err)}); falling back to free-text intent`,
    };
  }

  if (!stat.isFile()) {
    return {
      intent: text,
      warning: `path-like intent "${trimmed}" resolved to a non-regular file (directory or special); falling back to free-text intent`,
    };
  }

  let contents: string;
  try {
    contents = readFileSync(absolutePath, 'utf-8');
  } catch (err) {
    return {
      intent: text,
      warning: `path-like intent "${trimmed}" could not be read as UTF-8 (${describeError(err)}); falling back to free-text intent`,
    };
  }

  return {intent: contents, loadedFrom: absolutePath};
}

function hasRecognizedExtension(candidate: string): boolean {
  const lower = candidate.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
