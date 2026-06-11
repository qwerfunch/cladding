// Cladding · unit tests for cli/doctor (v0.3.40, F-bb15e6)
//
// Smoke + contract tests for `clad doctor`. Each case pre-seeds a
// `.cladding/events.log.jsonl` under a tmpdir, calls runDoctorCommand,
// and asserts the captured stdout / exit code. We use a real fs
// because the verb's whole purpose is reading the on-disk log; mocking
// readEvents would test less than the file-based path.

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
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

  test('greenfield (no events.log): friendly note + exit 0', () => {
    runDoctorCommand({cwd: dir});
    expect(exitCalls).toEqual([0]);
    const out = stdoutChunks.join('');
    expect(out).toContain('doctor');
    expect(out).toContain('no events recorded');
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

  test('--json: emits the raw DoctorReport and skips the formatted surface', () => {
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
        {id: '3', timestamp: 't3', type: 'gate_run', payload: {tier: 'pre-push', strict: true, worst: 0, anyFailed: false}},
        {id: '4', timestamp: 't4', type: 'done_attempted', payload: {feature: 'F-aaa111', worst: 0, anyFailed: false, kept: true}},
        {id: '5', timestamp: 't5', type: 'stop_blocked', payload: {count: 2, fingerprint: 'abc'}},
      ]);
    }

    test('text mode renders gate runs, rejected dones, stop blocks, attestation', () => {
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
      expect(out).toContain('gate runs: 2  (last: pre-push strict=true → GREEN)');
      expect(out).toContain('done attempts: 2  rejected by the gate: 1');
      expect(out).toContain('stop blocks: 1');
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

    test('--json carries the same summary machine-readably', () => {
      seedGovernance();
      runDoctorCommand({cwd: dir, json: true});
      const parsed = JSON.parse(stdoutChunks.join(''));
      expect(parsed.governance).toEqual({
        gateRuns: 2,
        lastGate: {tier: 'pre-push', strict: true, worst: 0},
        doneAttempts: 2,
        doneRejected: 1,
        stopBlocked: 1,
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
    });
  });
});
