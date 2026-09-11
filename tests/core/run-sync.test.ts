// Cladding · conformance tests for F-203a3114 (runs on Node 16)
//
// Authored from the spec entry ONLY (anti-self-cert: the author of these tests
// did not read src/core/run-sync.ts or scripts/check-node-surface.mjs). What
// the ACs pin:
//
//   - AC-545c8c83 — the synchronous runner keeps the result shape its callers
//     read while spawning through node:child_process: exit status, ONE final
//     newline stripped per captured stream, a timed-out flag, a spawn error
//     code for a missing binary, and a 100 MB capture limit (the platform
//     default is 1 MB, so a payload above it must survive whole). It also
//     resolves the executable portably, the way the replaced library did: on
//     Windows a bare `npm` is really `npm.cmd`, which the raw platform spawn
//     cannot find and which throws outright when spawned without a shell.
//   - AC-3c885475 — the declared floor is Node 16, and it lives in two places
//     that must agree: engines.node and the esbuild target.
//   - AC-ff87f215 — the surface check enumerates the bundle's platform imports
//     and resolves them; on a release that provides them all it exits zero, and
//     the removed spawning dependency's newest-release surfaces are gone from
//     the bundle.
//   - AC-dfc9fd7b — a missing platform capability is scoped to the one feature
//     that needs it, naming the capability and the release that provides it.
//
// Shape of the proof: real child processes (process.execPath with -e) — no mock
// of node:child_process, because real spawn behavior IS the contract here. The
// floor and capability criteria cannot switch Node versions inside one test
// run, so they are asserted against the manifest and the built bundle; the
// behavioral proof for those is the container matrix recorded in the spec.
//
// Every test is registered UNCONDITIONALLY — no skipIf anywhere. A conditional
// registration is not collected at all, which would make the repo's published
// test total depend on whether the machine happens to have build output or npm
// on PATH. The bundle is resolved from the gitignored build output when present
// and from the committed plugin copy otherwise, and its existence is asserted
// inside the test, so a missing bundle fails loudly instead of disappearing
// from the count.

import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {describe, expect, test} from 'vitest';

import {runSync} from '../../src/core/run-sync.js';

const repoRoot = resolve(__dirname, '..', '..');
const surfaceScript = resolve(repoRoot, 'scripts', 'check-node-surface.mjs');

const builtBundle = resolve(repoRoot, 'dist', 'clad.js');
const committedBundle = resolve(repoRoot, 'plugins', 'claude-code', 'dist', 'clad.js');
const bundlePath = existsSync(builtBundle) ? builtBundle : committedBundle;

function readBundle(): string {
  expect(existsSync(bundlePath), `no engine bundle at ${bundlePath}`).toBe(true);
  return readFileSync(bundlePath, 'utf8');
}

// PATH probe used only to sharpen the failure message: `which`/`where` tells us
// whether npm exists independently of the subject under test, so an ENOENT from
// the runner can be named as a resolution regression rather than a bare absence.
const npmOnPath = (() => {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const probe = spawnSync(lookup, ['npm'], {encoding: 'utf8'});
  return probe.status === 0 && (probe.stdout ?? '').trim().length > 0;
})();

describe('core/run-sync — the child-process runner contract', () => {
  test('[covers:F-203a3114/AC-545c8c83] a successful run reports exit status zero and captures output', () => {
    const result = runSync(process.execPath, ['-e', 'process.stdout.write("hello")']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
    expect(result.failed).toBe(false);
    expect(result.timedOut).toBe(false);
  });

  test('[covers:F-203a3114/AC-545c8c83] exactly one trailing newline is stripped from stdout', () => {
    const result = runSync(process.execPath, ['-e', 'console.log("a")']);
    expect(result.stdout).toBe('a');
  });

  test('[covers:F-203a3114/AC-545c8c83] a stream ending in two newlines keeps the first', () => {
    const result = runSync(process.execPath, ['-e', 'process.stdout.write("a\\n\\n")']);
    expect(result.stdout).toBe('a\n');
  });

  test('[covers:F-203a3114/AC-545c8c83] output with no trailing newline comes back unchanged', () => {
    const result = runSync(process.execPath, ['-e', 'process.stdout.write("abc")']);
    expect(result.stdout).toBe('abc');
  });

  test('[covers:F-203a3114/AC-545c8c83] the same single-newline rule applies to stderr', () => {
    const both = runSync(process.execPath, [
      '-e',
      'process.stderr.write("err\\n"); process.stdout.write("out\\n")',
    ]);
    expect(both.stderr).toBe('err');
    expect(both.stdout).toBe('out');

    const doubled = runSync(process.execPath, ['-e', 'process.stderr.write("err\\n\\n")']);
    expect(doubled.stderr).toBe('err\n');

    const bare = runSync(process.execPath, ['-e', 'process.stderr.write("err")']);
    expect(bare.stderr).toBe('err');
  });

  test('[covers:F-203a3114/AC-545c8c83] a non-zero exit is reported as the status, not thrown', () => {
    const result = runSync(process.execPath, ['-e', 'process.exitCode = 3']);
    expect(result.exitCode).toBe(3);
    expect(result.failed).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  test('[covers:F-203a3114/AC-545c8c83] a missing binary comes back as a result carrying the spawn error code', () => {
    let result: ReturnType<typeof runSync> | undefined;
    expect(() => {
      result = runSync('clad-definitely-no-such-binary-203a3114');
    }).not.toThrow();
    expect(result?.code).toBe('ENOENT');
    expect(result?.failed).toBe(true);
    expect(result?.exitCode).toBeUndefined();
  });

  test('[covers:F-203a3114/AC-545c8c83] a hanging command reports the timed-out flag', () => {
    const result = runSync(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeout: 300,
    });
    expect(result.timedOut).toBe(true);
    expect(result.failed).toBe(true);
  });

  test('[covers:F-203a3114/AC-545c8c83] output above the platform default 1 MB is captured whole', () => {
    const size = 2 * 1024 * 1024;
    const result = runSync(process.execPath, [
      '-e',
      `process.stdout.write("x".repeat(${size}))`,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBe(size);
  });

  test('[covers:F-203a3114/AC-545c8c83] the runner honours the working directory it is given', () => {
    const result = runSync(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], {
      cwd: repoRoot,
    });
    expect(result.exitCode).toBe(0);
    expect(resolve(result.stdout)).toBe(repoRoot);
  });

  // Portable resolution. Trivially true on POSIX; on Windows it is the only
  // proof that a bare `npm` still resolves to npm.cmd through the resolver
  // rather than the raw platform spawn. Registered unconditionally, and an
  // ENOENT fails loudly — that IS the Windows regression this case exists for.
  test(
    '[covers:F-203a3114/AC-545c8c83] a bare npm resolves portably and reports exit status zero',
    () => {
      const result = runSync('npm', ['--version']);
      if (result.code === 'ENOENT') {
        expect.fail(
          'the runner could not resolve npm (ENOENT) — portable command resolution ' +
            `regressed to the raw platform spawn (independent PATH probe found npm: ${npmOnPath})`,
        );
      }
      expect(result.exitCode, `${result.stderr}`).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+/);
    },
    30_000,
  );
});

describe('the declared Node floor', () => {
  test('[covers:F-203a3114/AC-3c885475] engines.node and the esbuild target name the same major version', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
    ) as {engines?: {node?: string}};
    const declared = manifest.engines?.node ?? '';
    const declaredMajor = /(\d+)/.exec(declared)?.[1];
    expect(declaredMajor).toBe('16');

    const buildScript = readFileSync(resolve(repoRoot, 'scripts', 'build.mjs'), 'utf8');
    const targetMajor = /target:\s*['"]node(\d+)['"]/.exec(buildScript)?.[1];
    expect(targetMajor).toBe(declaredMajor);
  });

  test('[covers:F-203a3114/AC-ff87f215] the surface check exists', () => {
    expect(existsSync(surfaceScript)).toBe(true);
  });

  test('[covers:F-203a3114/AC-ff87f215] the surface check passes against the engine bundle on this release', () => {
    expect(existsSync(bundlePath), `no engine bundle at ${bundlePath}`).toBe(true);
    const run = spawnSync(process.execPath, [surfaceScript, bundlePath], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
    expect(output.trim().length).toBeGreaterThan(0);
    expect(run.status, output).toBe(0);
  });

  test("[covers:F-203a3114/AC-ff87f215] the bundle imports none of the removed dependency's newest-release surfaces", () => {
    const bundle = readBundle();

    // `aborted` on its own is an everyday identifier (signal.aborted), so the
    // assertion looks only at what the bundle imports FROM node:util.
    const utilImports = [...bundle.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']node:util["']/g)];
    expect(utilImports.length, 'no node:util named import found to inspect').toBeGreaterThan(0);
    for (const match of utilImports) {
      expect(match[1]).not.toMatch(/\baborted\b/);
    }

    expect(bundle).not.toContain('getDefaultHighWaterMark');
    expect(bundle).not.toContain('addAbortListener');
  });
});

describe('a missing platform capability stays scoped to its feature', () => {
  // Message-contract guard, plain `test(...)` on purpose: the coverage
  // harvester only reads titles off a bare test call, and a conditional
  // registration would also destabilise the repo's test total. A test run
  // cannot downgrade the running release, so this asserts the scoped wording —
  // the capability plus the release that provides it, plus the reassurance that
  // the rest of the tool keeps working. The behavioral proof is the container
  // matrix recorded in the spec.
  test('[covers:F-203a3114/AC-dfc9fd7b] the bundle names the missing capability and leaves every other command working', () => {
    const bundle = readBundle();
    expect(bundle).toContain('needs built-in network fetch');
    expect(bundle).toContain('Every other command works on this release');
  });
});
