// Cladding · stage helpers — shared utilities

import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';

/**
 * Returns true when `cwd/package.json` declares a `scripts.<name>` entry.
 * Used by stages that delegate to `npm run <name>` so they can report
 * `exitCode 2` (skipped) instead of `exitCode 1` (fail) when the
 * project simply hasn't wired up the script.
 */
export function isNpmScriptDefined(cwd: string, scriptName: string): boolean {
  const pkgPath = join(cwd, 'package.json');
  if (!existsSync(pkgPath)) return false;
  try {
    const parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as {scripts?: Record<string, string>};
    return Boolean(parsed.scripts?.[scriptName]);
  } catch {
    return false;
  }
}
