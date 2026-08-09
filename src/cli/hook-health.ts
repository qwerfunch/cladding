// Cladding · bounded host-hook liveness snapshot.
//
// Hook invocations are much more frequent than lifecycle transitions. Recording
// every call in events.log.jsonl would undo the log-growth protection added for
// impact-card skips, so this observer keeps one replace-in-place timestamp per
// shipped Claude Code event instead.

import {existsSync, mkdirSync, readFileSync, renameSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import process from 'node:process';

import {getCurrentCladdingVersion} from '../init/host-setup.js';

/** The lifecycle events shipped in the Claude Code plugin hook manifest. */
export const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Stop',
] as const;

/** One event name accepted by the host hook protocol. */
export type HookEventName = (typeof HOOK_EVENTS)[number];

/** Evidence-backed hook state exposed by `clad doctor --json`. */
export interface HookHealthReport {
  /** `observed` means this engine actually handled at least one hook call. */
  readonly installation: 'observed' | 'not-observed';
  /** Engine version written by the most recent hook invocation. */
  readonly recordedVersion: string | null;
  /** Version of the engine running `clad doctor`. */
  readonly currentVersion: string | null;
  /** Null until both recorded and current versions are known. */
  readonly versionCurrent: boolean | null;
  /** Fixed-key map; null means that event has never been observed. */
  readonly lastFiredAt: Readonly<Record<HookEventName, string | null>>;
}

interface HookHealthSnapshot {
  readonly schemaVersion: 1;
  readonly engineVersion: string | null;
  readonly lastFiredAt: Partial<Record<HookEventName, string>>;
}

interface RecordHookFiringOptions {
  readonly now?: Date;
  readonly engineVersion?: string | null;
}

const HEALTH_FILE = join('.cladding', 'hook-health.json');

function healthPath(cwd: string): string {
  return join(cwd, HEALTH_FILE);
}

function isHookEventName(event: string): event is HookEventName {
  return (HOOK_EVENTS as readonly string[]).includes(event);
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function readSnapshot(cwd: string): HookHealthSnapshot | null {
  try {
    const parsed = JSON.parse(readFileSync(healthPath(cwd), 'utf8')) as {
      schemaVersion?: unknown;
      engineVersion?: unknown;
      lastFiredAt?: unknown;
    };
    if (parsed.schemaVersion !== 1 || typeof parsed.lastFiredAt !== 'object' || parsed.lastFiredAt === null) {
      return null;
    }
    const candidate = parsed.lastFiredAt as Record<string, unknown>;
    const lastFiredAt: Partial<Record<HookEventName, string>> = {};
    for (const event of HOOK_EVENTS) {
      if (validTimestamp(candidate[event])) lastFiredAt[event] = candidate[event];
    }
    return {
      schemaVersion: 1,
      engineVersion: typeof parsed.engineVersion === 'string' ? parsed.engineVersion : null,
      lastFiredAt,
    };
  } catch {
    return null;
  }
}

/**
 * Records a recognized hook invocation without changing its protocol outcome.
 *
 * The project must already contain `spec.yaml`; this observer never activates
 * Cladding in an unrelated working directory. Writes are atomic and
 * best-effort, and the fixed five-key snapshot cannot grow with call volume.
 *
 * @param cwd - Project directory in which the host invoked the hook.
 * @param event - Host event name; unknown future events are ignored.
 * @param options - Injectable clock/version used by deterministic tests.
 * @returns True only when a new snapshot was successfully installed.
 * @throws Never; filesystem and parsing failures degrade to false.
 * @example
 * ```ts
 * recordHookFiring('.', 'SessionStart');
 * ```
 * @see spec/features/hook-health-observability-96fa5622.yaml AC-4c90cd04
 * @since 0.9.4
 */
export function recordHookFiring(
  cwd: string,
  event: string,
  options: RecordHookFiringOptions = {},
): boolean {
  if (!isHookEventName(event) || !existsSync(join(cwd, 'spec.yaml'))) return false;
  try {
    const path = healthPath(cwd);
    const previous = readSnapshot(cwd);
    const snapshot: HookHealthSnapshot = {
      schemaVersion: 1,
      engineVersion: options.engineVersion === undefined
        ? getCurrentCladdingVersion()
        : options.engineVersion,
      lastFiredAt: {
        ...(previous?.lastFiredAt ?? {}),
        [event]: (options.now ?? new Date()).toISOString(),
      },
    };
    mkdirSync(dirname(path), {recursive: true});
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the bounded hook snapshot into the stable doctor report shape.
 *
 * Missing or malformed data is not evidence of installation. The returned map
 * still contains all five events so machine consumers never infer absence from
 * an omitted key.
 *
 * @param cwd - Project directory containing the optional health snapshot.
 * @param currentVersion - Engine version running doctor; injectable for tests.
 * @returns Evidence-backed installation, version, and per-event timestamps.
 * @throws Never; unreadable evidence returns the not-observed zero state.
 * @example
 * ```ts
 * const health = readHookHealth('.');
 * ```
 * @see spec/features/hook-health-observability-96fa5622.yaml AC-8b37ba53
 * @see spec/features/hook-health-observability-96fa5622.yaml AC-8b386416
 * @since 0.9.4
 */
export function readHookHealth(
  cwd: string,
  currentVersion: string | null = getCurrentCladdingVersion(),
): HookHealthReport {
  const snapshot = readSnapshot(cwd);
  const lastFiredAt = Object.fromEntries(
    HOOK_EVENTS.map((event) => [event, snapshot?.lastFiredAt[event] ?? null]),
  ) as Record<HookEventName, string | null>;
  const installation = Object.values(lastFiredAt).some((timestamp) => timestamp !== null)
    ? 'observed'
    : 'not-observed';
  const recordedVersion = installation === 'observed' ? snapshot?.engineVersion ?? null : null;
  const versionCurrent = recordedVersion !== null && currentVersion !== null
    ? recordedVersion === currentVersion
    : null;
  return {installation, recordedVersion, currentVersion, versionCurrent, lastFiredAt};
}
