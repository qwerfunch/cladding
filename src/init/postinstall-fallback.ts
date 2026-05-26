// F-90d054 — `clad init` fallback retry for users who ran
// `npm install --ignore-scripts` (or whose CI disabled postinstall).
//
// Reads `~/.cladding/postinstall-status.json` written by
// `scripts/postinstall.mjs`. If the file is missing, or if any wiring step
// failed, attempts to re-run the same host wiring operations.
//
// Pure best-effort. Never blocks `clad init`.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const HOME = homedir();
const STATUS_FILE = join(HOME, '.cladding', 'postinstall-status.json');

interface PostinstallStatus {
  cladding_root?: string;
  last_run?: string;
  wiring?: Record<string, unknown>;
  errors?: { step: string; message: string }[];
}

function readStatus(): PostinstallStatus | null {
  if (!existsSync(STATUS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8')) as PostinstallStatus;
  } catch {
    return null;
  }
}

function locateCladdingRoot(): string | null {
  // 1. Status file value (most authoritative).
  const status = readStatus();
  if (status?.cladding_root && existsSync(status.cladding_root)) {
    return status.cladding_root;
  }
  // 2. Resolve from this module's own path (dev / local install).
  try {
    const here = new URL('.', import.meta.url).pathname;
    const guess = resolve(here, '..', '..');
    if (existsSync(join(guess, 'scripts', 'postinstall.mjs'))) {
      return guess;
    }
  } catch {
    // ignore
  }
  return null;
}

export interface FallbackResult {
  readonly attempted: boolean;
  readonly reason?: 'no-status' | 'errors-present' | 'complete';
  readonly exitCode?: number;
  readonly stderr?: string;
}

/**
 * Attempts the postinstall hook again if needed. Returns a result describing
 * what happened — the caller (clad init) typically forwards the message to
 * stdout but does not fail on a non-zero exitCode here.
 */
export function retryPostinstallIfNeeded(): FallbackResult {
  const status = readStatus();
  if (status && (!status.errors || status.errors.length === 0)) {
    return { attempted: false, reason: 'complete' };
  }
  const root = locateCladdingRoot();
  if (!root) {
    return { attempted: false, reason: 'no-status' };
  }
  const script = join(root, 'scripts', 'postinstall.mjs');
  if (!existsSync(script)) {
    return { attempted: false, reason: 'no-status' };
  }
  const r = spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return {
    attempted: true,
    reason: status?.errors?.length ? 'errors-present' : 'no-status',
    exitCode: r.status ?? undefined,
    stderr: r.stderr || undefined,
  };
}
