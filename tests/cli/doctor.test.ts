// Cladding · unit tests for cli/doctor (v0.3.40, F-bb15e6)
//
// Smoke + contract tests for `clad doctor`. Each case pre-seeds a
// `.cladding/events.log.jsonl` under a tmpdir, calls runDoctorCommand,
// and asserts the captured stdout / exit code. We use a real fs
// because the verb's whole purpose is reading the on-disk log; mocking
// readEvents would test less than the file-based path.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {runDoctorCommand} from '../../src/cli/doctor.js';

interface EventLine {
  readonly id: string;
  readonly timestamp: string;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

function seedEvents(cwd: string, events: readonly EventLine[]): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  for (const e of events) {
    appendFileSync(join(cwd, '.cladding', 'events.log.jsonl'), `${JSON.stringify(e)}\n`, 'utf8');
  }
}

function seedHookHealth(cwd: string): void {
  mkdirSync(join(cwd, '.cladding'), {recursive: true});
  writeFileSync(
    join(cwd, '.cladding', 'hook-health.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      engineVersion: '0.0.1',
      lastFiredAt: {
        SessionStart: '2026-08-10T00:00:00.000Z',
        PostToolUse: '2026-08-10T00:05:00.000Z',
      },
    })}\n`,
    'utf8',
  );
}

function seedGitignore(cwd: string, body: string): void {
  writeFileSync(join(cwd, '.gitignore'), body, 'utf8');
}

function seedWorkflow(cwd: string, name: string, body: string): void {
  mkdirSync(join(cwd, '.github', 'workflows'), {recursive: true});
  writeFileSync(join(cwd, '.github', 'workflows', name), body, 'utf8');
}

describe('clad doctor handler', () => {
  let dir: string;
  let exitCalls: number[];
  let stdoutChunks: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-doctor-'));
    exitCalls = [];
    stdoutChunks = [];
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCalls.push(code ?? 0);
      return undefined as never;
    }) as never);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-bb15e6/AC-004] greenfield (no events.log): friendly note + exit 0', () => {
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    expect(out).toContain('doctor');
    expect(out).toContain('no events recorded');
    expect(out).toContain('Claude Code hooks');
    expect(out).toContain('runtime: not observed');
    expect(out.match(/never observed/g)).toHaveLength(5);
  });

  test('healthy: events but zero sentinel_miss → pass pulse + event-type line + exit 0', () => {
    seedEvents(dir, [
      {id: '1', timestamp: 't', type: 'feature_checkpoint', payload: {featureId: 'F-001'}},
      {id: '2', timestamp: 't', type: 'feature_checkpoint', payload: {featureId: 'F-002'}},
      {id: '3', timestamp: 't', type: 'drift_detected', payload: {}},
    ]);
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    expect(out).toMatch(/3 events · 0 sentinel-miss/);
    expect(out).toContain('host is healthy');
    expect(out).toContain('feature_checkpoint=2');
    expect(out).toContain('drift_detected=1');
    // No breakdown section when sentinel-miss is zero.
    expect(out).not.toContain('Sentinel-miss breakdown');
  });

  test('unhealthy: sentinel_miss events render the breakdown + top-missed + recent errors', () => {
    seedEvents(dir, [
      {id: '1', timestamp: '2026-05-20T20:00:00.000Z', type: 'sentinel_miss', payload: {
        phase: 'scan_artifacts', cause: 'dispatcher_error', fallback: 'total', error: 'transport down',
      }},
      {id: '2', timestamp: '2026-05-20T21:00:00.000Z', type: 'sentinel_miss', payload: {
        phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['CAPABILITIES_YAML'],
      }},
      {id: '3', timestamp: '2026-05-20T22:00:00.000Z', type: 'sentinel_miss', payload: {
        phase: 'project_context', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['WHY', 'PURPOSE'],
      }},
    ]);
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    expect(out).toContain('Sentinel-miss breakdown');
    expect(out).toContain('by phase');
    expect(out).toContain('scan_artifacts=2');
    expect(out).toContain('project_context=1');
    expect(out).toContain('by cause');
    expect(out).toContain('dispatcher_error=1');
    expect(out).toContain('blank_section=2');
    expect(out).toContain('Top missed sentinels');
    expect(out).toContain('CAPABILITIES_YAML');
    expect(out).toContain('Recent dispatcher errors');
    expect(out).toContain('transport down');
    expect(out).toContain('Tune your host');
  });

  test('[covers:F-bb15e6/AC-003] [covers:F-96fa5622/AC-8b386416] --json: emits the raw DoctorReport with every hook observation and skips the formatted surface', () => {
    seedHookHealth(dir);
    seedEvents(dir, [
      {id: '1', timestamp: 't', type: 'sentinel_miss', payload: {
        phase: 'scan_artifacts', cause: 'blank_section', fallback: 'per_artifact', missed_sections: ['CAPABILITIES_YAML'],
      }},
    ]);
    runDoctorCommand({cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    const parsed = JSON.parse(out);
    expect(parsed.cwd).toBe(dir);
    expect(parsed.sentinelMiss.total).toBe(1);
    expect(parsed.sentinelMiss.byPhase).toEqual({scan_artifacts: 1});
    expect(parsed.sentinelMiss.topMissedSections[0]).toEqual({name: 'CAPABILITIES_YAML', count: 1});
    expect(parsed.events.total).toBe(1);
    expect(parsed.events.byType.sentinel_miss).toBe(1);
    expect(parsed.hooks.installation).toBe('observed');
    expect(parsed.hooks.recordedVersion).toBe('0.0.1');
    expect(parsed.hooks.versionCurrent).toBe(false);
    expect(parsed.hooks.lastFiredAt).toEqual({
      SessionStart: '2026-08-10T00:00:00.000Z',
      UserPromptSubmit: null,
      PreToolUse: null,
      PostToolUse: '2026-08-10T00:05:00.000Z',
      Stop: null,
    });
    expect(parsed.ciVersion).toEqual({unpinnedWorkflows: []});
    // The formatted-text surface (pulse line, "Sentinel-miss breakdown")
    // is suppressed under --json so callers parse the JSON cleanly.
    expect(out).not.toContain('Sentinel-miss breakdown');
  });

  test('--json on a greenfield workspace still emits a valid DoctorReport', () => {
    runDoctorCommand({cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    const parsed = JSON.parse(stdoutChunks.join(''));
    expect(parsed.events.total).toBe(0);
    expect(parsed.sentinelMiss.total).toBe(0);
    expect(parsed.sentinelMiss.byPhase).toEqual({});
    expect(parsed.hooks.installation).toBe('not-observed');
    expect(Object.values(parsed.hooks.lastFiredAt)).toEqual([null, null, null, null, null]);
    expect(parsed.ciVersion).toEqual({unpinnedWorkflows: []});
  });

  test('reports unpinned CI in text and JSON without failing', () => {
    seedWorkflow(dir, 'release.yml', 'steps:\n  - run: npx --yes cladding check --strict\n');
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    expect(stdoutChunks.join('')).toContain('CI version pinning');
    expect(stdoutChunks.join('')).toContain('.github/workflows/release.yml');
    expect(stdoutChunks.join('')).toContain('unpinned or floating');

    exitCalls = [];
    stdoutChunks = [];
    runDoctorCommand({cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    expect(JSON.parse(stdoutChunks.join('')).ciVersion).toEqual({
      unpinnedWorkflows: ['.github/workflows/release.yml'],
    });
  });

  // F-b0c2e724 — the legacy directory exclusion makes .cladding/config.yaml
  // uncommittable, so the gate an author tuned never reaches CI or a fresh
  // clone. Doctor diagnoses it read-only; it never rewrites the ignore file.
  test('[covers:F-b0c2e724/AC-d47b93c5] reports a blocked gate config in text and JSON without failing', () => {
    seedGitignore(dir, 'node_modules/\n.cladding/\n');
    seedEvents(dir, [
      {id: '1', timestamp: 't', type: 'feature_checkpoint', payload: {featureId: 'F-a0000001'}},
    ]);
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    expect(out).toContain('gate config');
    expect(out).toContain('blocks .cladding/config.yaml');
    expect(out).toContain('.cladding/*');
    expect(out).toContain('!.cladding/config.yaml');
    // Read-only diagnosis: the adopter's file is untouched.
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules/\n.cladding/\n');

    exitCalls = [];
    stdoutChunks = [];
    runDoctorCommand({cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    expect(JSON.parse(stdoutChunks.join('')).gateConfigIgnore).toBe('blocked');
  });

  test('keeps a committable gate config quiet while still reporting it in JSON', () => {
    seedGitignore(dir, '# Cladding runtime state\n.cladding/*\n!.cladding/config.yaml\n');
    seedEvents(dir, [
      {id: '1', timestamp: 't', type: 'feature_checkpoint', payload: {featureId: 'F-a0000001'}},
    ]);
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    expect(stdoutChunks.join('')).not.toContain('gate config');

    exitCalls = [];
    stdoutChunks = [];
    runDoctorCommand({cwd: dir, json: true});
    expect(JSON.parse(stdoutChunks.join('')).gateConfigIgnore).toBe('commitable');
  });

  test('a project with no .gitignore reports an absent status and stays quiet', () => {
    runDoctorCommand({cwd: dir, json: true});
    expect(exitCalls).toEqual([0]);
    expect(JSON.parse(stdoutChunks.join('')).gateConfigIgnore).toBe('absent');
  });

  test('keeps pinned CI quiet', () => {
    seedWorkflow(dir, 'cladding.yaml', 'steps:\n  - run: npx --yes cladding@0.9 check --strict\n');
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    expect(stdoutChunks.join('')).not.toContain('CI version pinning');
  });

  test('[covers:F-96fa5622/AC-8b386416] text mode names observed hook times and stale runtime version without guessing missing events', () => {
    seedHookHealth(dir);
    seedEvents(dir, [
      {id: '1', timestamp: 't', type: 'feature_checkpoint', payload: {featureId: 'F-001'}},
    ]);
    runDoctorCommand({cwd: dir});
    const out = stdoutChunks.join('');
    expect(out).toContain('runtime: observed (engine v0.0.1; current engine is v');
    expect(out).toContain('refresh the plugin');
    expect(out).toContain('session start: 2026-08-10T00:00:00.000Z');
    expect(out).toContain('after edit: 2026-08-10T00:05:00.000Z');
    expect(out).toContain('before edit: never observed');
    expect(exitCalls).toEqual([0]);
  });

  test('corrupt events.log: fail pulse + exit 1 (json flag does NOT swallow the parse error)', () => {
    mkdirSync(join(dir, '.cladding'), {recursive: true});
    appendFileSync(join(dir, '.cladding', 'events.log.jsonl'), '{not-json\n', 'utf8');
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([1]);
  });

  // F-95a096 — the governance summary: gate runs, gated done attempts,
  // stop blocks, attestation. Doctor is where an operator reads the
  // lifecycle ledger without parsing JSONL by hand.
  describe('governance summary', () => {
    function seedGovernance(): void {
      seedEvents(dir, [
        {id: '1', timestamp: 't1', type: 'gate_run', payload: {tier: 'pre-commit', strict: false, worst: 1, anyFailed: true}},
        {id: '2', timestamp: 't2', type: 'done_attempted', payload: {feature: 'F-aaa111', worst: 1, anyFailed: true, kept: false}},
        // Legacy stop_blocked shape deliberately lacks every additive P3 field.
        {id: '3', timestamp: 't3', type: 'stop_blocked', payload: {count: 2, fingerprint: 'abc'}},
        {id: '4', timestamp: 't4', type: 'stop_exit_recorded', payload: {fingerprint: 'abc'}},
        {id: '5', timestamp: 't5', type: 'gate_run', payload: {tier: 'pre-push', strict: true, worst: 1, anyFailed: true, stopFingerprint: 'abc'}},
        {id: '6', timestamp: 't6', type: 'gate_run', payload: {tier: 'pre-push', strict: true, worst: 0, anyFailed: false, stopFingerprint: ''}},
        {id: '7', timestamp: 't7', type: 'done_attempted', payload: {feature: 'F-aaa111', worst: 0, anyFailed: false, kept: true}},
      ]);
    }

    test('[covers:F-95a096/AC-846ce0] text mode renders gate runs, rejected dones, stop blocks, attestation', () => {
      seedGovernance();
      mkdirSync(join(dir, 'spec'), {recursive: true});
      writeFileSync(
        join(dir, 'spec', 'attestation.yaml'),
        'attested:\n  F-aaa111: 0123456789abcdef\n  F-bbb222: fedcba9876543210\n',
        'utf8',
      );
      runDoctorCommand({cwd: dir});
      expect(exitCalls).toEqual([0]);
      const out = stdoutChunks.join('');
      expect(out).toContain('Governance (lifecycle ledger)');
      expect(out).toContain('gate runs: 3  (last: pre-push strict=true → GREEN)');
      expect(out).toContain('done attempts: 2  rejected by the gate: 1');
      expect(out).toContain('stop blocks: 1');
      expect(out).toContain('stop exits recorded: 1  blocked fingerprints later seen by a gate: 1/1');
      expect(out).not.toContain('UNRESOLVED'); // no stop-block.json on disk
      expect(out).toContain('attestation: 2 feature(s) stamped');
    });

    test('unresolved stop-block.json on disk is flagged', () => {
      seedGovernance();
      writeFileSync(join(dir, '.cladding', 'stop-block.json'), '{"fingerprint":"abc"}', 'utf8');
      runDoctorCommand({cwd: dir});
      expect(stdoutChunks.join('')).toContain('UNRESOLVED stop-block pending');
    });

    test('no attestation file → points at the strict pre-push gate, never an error', () => {
      seedGovernance();
      runDoctorCommand({cwd: dir});
      const out = stdoutChunks.join('');
      expect(out).toContain('attestation: none — run `clad check --tier=pre-push --strict`');
      expect(exitCalls).toEqual([0]);
    });

    test('[covers:F-95a096/AC-846ce0] governance summary exposes stop outcomes and tolerates legacy events in JSON', () => {
      seedGovernance();
      runDoctorCommand({cwd: dir, json: true});
      const parsed = JSON.parse(stdoutChunks.join(''));
      expect(parsed.governance).toEqual({
        gateRuns: 3,
        lastGate: {tier: 'pre-push', strict: true, worst: 0},
        doneAttempts: 2,
        doneRejected: 1,
        stopBlocked: 1,
        stopOutcomes: {blocked: 1, exitsRecorded: 1, observedByLaterGate: 1, notObservedByLaterGate: 0},
        unresolvedStopBlock: false,
        attestation: {present: false, entries: 0},
      });
    });

    test('governance-free log → zero counts and lastGate null (negative control)', () => {
      seedEvents(dir, [{id: '1', timestamp: 't', type: 'drift_detected', payload: {}}]);
      runDoctorCommand({cwd: dir, json: true});
      const parsed = JSON.parse(stdoutChunks.join(''));
      expect(parsed.governance.gateRuns).toBe(0);
      expect(parsed.governance.lastGate).toBeNull();
      expect(parsed.governance.doneAttempts).toBe(0);
      expect(parsed.governance.stopBlocked).toBe(0);
      expect(parsed.governance.stopOutcomes).toEqual({
        blocked: 0,
        exitsRecorded: 0,
        observedByLaterGate: 0,
        notObservedByLaterGate: 0,
      });
    });
  });
});
