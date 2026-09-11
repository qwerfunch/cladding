// Cladding · one synchronous external-command runner (F-203a3114).
//
// Every stage that delegates to a project's own toolchain used to spawn through
// `execa`. That dependency reaches for platform surfaces only newer releases
// carry — `util.aborted`, `stream.getDefaultHighWaterMark`,
// `events.addAbortListener` — and because it is bundled into the published
// single-file engine, ITS floor became the whole tool's floor. A user on Node 16
// could not run `clad --version`, let alone a gate. Measured in containers:
// those three surfaces were the only thing above Node 16 the bundle needed,
// apart from one promise-flavoured readline import in our own code.
//
// So the runner is built on `node:child_process`. Three behaviours of the
// replaced library are deliberately reproduced, because a stage verdict changes
// if they are not:
//
//  1. **Windows command resolution.** `execa` never called `spawnSync`
//     directly — it ran arguments through `cross-spawn._parse` first. On Windows
//     a bare `npm`/`npx`/`tsc` is really `npm.cmd`, which `CreateProcess` cannot
//     find, and since the CVE-2024-27980 patch spawning a `.cmd` without a shell
//     throws outright. `cross-spawn` resolves the real executable and escapes
//     arguments safely; `shell: true` would "work" while letting cmd.exe mangle
//     an unquoted regex like the architecture stage's `--exclude` pattern. So
//     this runner delegates to `cross-spawn` for exactly that step, which also
//     keeps it usable on every release it claims (its own floor is Node 8).
//  2. **Final-newline stripping.** `execaSync` strips one trailing newline from
//     each captured stream. `spawnSync` does not. Call sites compare captured
//     output against expected tokens, so an extra "\n" is a false negative.
//  3. **The capture limit.** `execaSync` defaults to 100 MB; `spawnSync`
//     defaults to 1 MB and silently truncates past it. A verbose linter or test
//     reporter exceeds 1 MB easily, and a truncated JSON report parses as
//     garbage — a passing suite read as a failure.
//
// One behaviour is deliberately NOT reproduced: `execa` defaults `preferLocal`
// to false, so it never put `node_modules/.bin` on PATH. Call sites already pass
// `npx` explicitly where they need a local binary.
//
// The result keeps the shape the call sites already read (`ProcLike` in
// stages/deliverable-smoke.ts, `SharedProc` in stages/test-run-cache.ts):
// `exitCode` absent rather than null when the process never reported one, so the
// existing `exitCode !== 0` failure checks behave exactly as before.

import crossSpawn from 'cross-spawn';

/** The replaced library's default capture limit; see note 2 in the header. */
const MAX_BUFFER = 1000 * 1000 * 100;

/** Options the call sites actually pass. */
export interface RunSyncOptions {
  /** Working directory for the spawned process. */
  readonly cwd?: string;
  /** Milliseconds before the child is killed; absent means no limit. */
  readonly timeout?: number;
}

/** A finished synchronous run, shaped like the result the stages already read. */
export interface RunSyncResult {
  /** The process exit status, absent when it never reported one (spawn failure or signal). */
  readonly exitCode?: number;
  /** Captured standard output, one trailing newline removed. */
  readonly stdout: string;
  /** Captured standard error, one trailing newline removed. */
  readonly stderr: string;
  /** True when the run ended because its timeout elapsed. */
  readonly timedOut: boolean;
  /** True when the command did not finish successfully, for any reason. */
  readonly failed: boolean;
  /** The spawn error code when there is one — `ENOENT` for a missing binary. */
  readonly code?: string;
  /** The signal that terminated the child, when one did. */
  readonly signal?: string;
}

/**
 * Removes exactly one trailing line break, matching the replaced library.
 *
 * @param value - Captured stream contents, possibly undefined on a spawn failure.
 * @returns The contents with at most one trailing "\n" or "\r\n" removed.
 */
function stripFinalNewline(value: string | undefined): string {
  if (!value) return '';
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n')) return value.slice(0, -1);
  return value;
}

/**
 * Runs one external command to completion and reports the outcome as data.
 *
 * Never throws for a command-level problem: a missing binary, a non-zero exit
 * and a timeout all come back as a result, so callers keep deciding what a
 * failure means. That is the contract the stages were already written against.
 *
 * @param command - Executable name or path to spawn.
 * @param args - Arguments passed to the executable.
 * @param options - Working directory and optional timeout.
 * @returns The finished run, with output captured and failure reported as data.
 */
export function runSync(
  command: string,
  args: readonly string[] = [],
  options: RunSyncOptions = {},
): RunSyncResult {
  const proc = crossSpawn.sync(command, [...args], {
    ...(options.cwd === undefined ? {} : {cwd: options.cwd}),
    ...(options.timeout === undefined ? {} : {timeout: options.timeout}),
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  // `cross-spawn` assigns `result.error = result.error || verifyENOENTSync(...)`,
  // and that helper returns NULL on every healthy run — so a successful spawn
  // carries `error: null`, not an absent field. Normalising to undefined here is
  // what keeps `failed` honest; a bare `!== undefined` check reports every
  // success as a failure. Caught by the conformance tests, not by inspection.
  const error = (proc.error ?? undefined) as {code?: string} | undefined;
  const code = error?.code;
  // A spawn that never started reports no exit status, on every platform. POSIX
  // already gives `status: null` for that, but Windows does not: `cross-spawn`
  // wraps an unresolvable command in the command processor, which exits 1, and
  // then synthesizes the ENOENT itself — so the raw result carries BOTH a status
  // of 1 and an ENOENT code. Keying on the error rather than the status keeps the
  // shape identical across platforms and matches the replaced library's contract,
  // where the exit status is absent whenever the subprocess could not be spawned.
  const exitCode = proc.status === null || error !== undefined ? undefined : proc.status;
  return {
    ...(exitCode === undefined ? {} : {exitCode}),
    stdout: stripFinalNewline(proc.stdout ?? undefined),
    stderr: stripFinalNewline(proc.stderr ?? undefined),
    timedOut: code === 'ETIMEDOUT',
    failed: exitCode !== 0 || error !== undefined,
    ...(code === undefined ? {} : {code}),
    ...(proc.signal === null || proc.signal === undefined ? {} : {signal: proc.signal}),
  };
}
