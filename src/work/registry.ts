// Cladding · work · registry (0.4.3, F-ca18ea)
//
// Tracks every currently-open work transaction so:
//   - cladding can detect concurrent enter_work on the same feature
//     and return idempotently instead of double-charging the spec.
//   - the implicit-close timeout sweep (wall-clock or via host Stop
//     hook) has a place to look up `enteredAt` per transaction.
//   - a cladding-server restart can pick up mid-flight transactions
//     instead of silently losing them.
//
// Storage: `.cladding/work-registry.json` (tier D, append-only spirit
// but rewritten atomically on every mutation — temp-file + rename so
// readers never see a torn file, same pattern as src/spec/update.ts).

import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

const REGISTRY_PATH_SEGMENTS = ['.cladding', 'work-registry.json'];

/** Snapshot of one open work transaction. */
export interface ActiveWork {
  readonly featureId: string;
  /** ISO timestamp at which enter_work was called. */
  readonly enteredAt: string;
  /** Free-form intent string the caller supplied (optional). */
  readonly intent?: string;
  /** Cached scope at enter time so implicit-close paths don't need to re-parse the yaml. */
  readonly scope: {readonly slug: string; readonly modules: readonly string[]};
  /** Persona id this transaction adopted (always 'specialists' in 0.4.3; routing.yaml in 0.4.10). */
  readonly personaId: string;
  /**
   * Git commit sha at enter_work time (0.4.7) — used by the Layer-D
   * auditor's file-diff cross-reference to classify changed files as
   * in-scope (under feature.modules) vs unmapped. Undefined when the
   * cwd is not a git working tree or git is not available.
   */
  readonly baseRef?: string;
}

interface RegistryFile {
  active: Record<string, ActiveWork>;
}

function registryPath(cwd: string): string {
  return join(cwd, ...REGISTRY_PATH_SEGMENTS);
}

/** Reads the registry from disk, returning an empty one when the file is absent or corrupt. */
export function loadRegistry(cwd: string): RegistryFile {
  const path = registryPath(cwd);
  if (!existsSync(path)) return {active: {}};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as RegistryFile;
    if (!parsed || typeof parsed.active !== 'object') return {active: {}};
    return parsed;
  } catch {
    return {active: {}};
  }
}

/** Atomic write — temp-file + rename, same pattern as src/spec/update.ts. */
function saveRegistry(cwd: string, registry: RegistryFile): void {
  const path = registryPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf8');
  renameSync(tmp, path);
}

/**
 * Adds (or replaces) an active-work entry. Idempotent on `featureId` —
 * a second enter_work on the same id keeps the original `enteredAt`
 * so the implicit-close timer is not reset by accident.
 */
export function registerActiveWork(cwd: string, work: ActiveWork): ActiveWork {
  const reg = loadRegistry(cwd);
  const existing = reg.active[work.featureId];
  if (existing) return existing; // idempotent reuse
  reg.active[work.featureId] = work;
  saveRegistry(cwd, reg);
  return work;
}

/** Removes the entry for a featureId. No-op when the id isn't tracked. */
export function removeActiveWork(cwd: string, featureId: string): void {
  const reg = loadRegistry(cwd);
  if (!(featureId in reg.active)) return;
  delete reg.active[featureId];
  saveRegistry(cwd, reg);
}

/** Returns the entry for a featureId, or undefined when not tracked. */
export function getActiveWork(cwd: string, featureId: string): ActiveWork | undefined {
  return loadRegistry(cwd).active[featureId];
}

/** Returns every currently-open transaction. */
export function listActiveWork(cwd: string): readonly ActiveWork[] {
  return Object.values(loadRegistry(cwd).active);
}

/**
 * Implicit-close sweep — returns active work whose `enteredAt` is
 * older than `timeoutMs` (default 10 minutes). Caller decides what to
 * do (typically: emit `work_timed_out` event + removeActiveWork).
 */
export function findExpiredWork(cwd: string, timeoutMs: number): readonly ActiveWork[] {
  const now = Date.now();
  return listActiveWork(cwd).filter((w) => {
    const enteredMs = new Date(w.enteredAt).getTime();
    return Number.isFinite(enteredMs) && now - enteredMs > timeoutMs;
  });
}
