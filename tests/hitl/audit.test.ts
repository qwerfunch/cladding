// Cladding · unit tests for src/hitl/audit.ts
//
// Covers the v0.2.25 (F-074) observer hook: subscribeAudit registers
// listeners, observers fire after the file write, exceptions in an
// observer are swallowed without breaking the audit chain, dispose
// callbacks remove the listener.

import {spawn} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {
  appendEvidence,
  clearAuditObserversForTesting,
  readEvidence,
  subscribeAudit,
} from '../../src/hitl/audit.js';
import {newEvidence} from '../../src/hitl/identity.js';

interface AuditChild {
  readonly ready: Promise<void>;
  readonly done: Promise<void>;
  release(): void;
}

/** Starts a signoff-equivalent audit append that waits at a parent-controlled barrier. */
function startAuditChild(cwd: string, evidence: unknown): AuditChild {
  const childSource = [
    'const {appendEvidence} = await import(process.env.CLADDING_AUDIT_MODULE);',
    'const evidence = JSON.parse(process.env.CLADDING_AUDIT_EVIDENCE);',
    'process.stdout.write(\'READY\\n\');',
    'process.stdin.once(\'data\', () => { appendEvidence(process.env.CLADDING_AUDIT_CWD, evidence); process.exit(0); });',
  ].join('\n');
  const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', childSource], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CLADDING_AUDIT_MODULE: new URL('../../src/hitl/audit.ts', import.meta.url).href,
      CLADDING_AUDIT_CWD: cwd,
      CLADDING_AUDIT_EVIDENCE: JSON.stringify(evidence),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let ready = false;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((error: Error) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    if (!ready && chunk.includes('READY')) {
      ready = true;
      readyResolve?.();
    }
  });
  child.stderr.on('data', (chunk: string) => { stderr += chunk; });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!ready) readyReject?.(new Error(`audit child exited before the barrier: ${stderr}`));
      if (code === 0) resolve();
      else reject(new Error(`audit child exited ${code}: ${stderr}`));
    });
  });
  return {ready: readyPromise, done, release: () => { child.stdin.write('go\n'); }};
}

describe('subscribeAudit (F-074, v0.2.25)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-audit-'));
    clearAuditObserversForTesting();
  });
  afterEach(() => {
    clearAuditObserversForTesting();
    rmSync(dir, {recursive: true, force: true});
  });

  function makeEvidence(featureId: string) {
    return newEvidence({
      featureId,
      stage: 'test',
      identity: {author: 'tool', name: 'unit-test', timestamp: '2026-05-19T00:00:00Z'},
      kind: 'note',
      content: `evidence for ${featureId}`,
    });
  }

  test('observer fires after appendEvidence with the same cwd + evidence', () => {
    const calls: Array<{cwd: string; featureId: string}> = [];
    subscribeAudit((cwd, ev) => calls.push({cwd, featureId: ev.featureId}));
    const ev = makeEvidence('F-001');
    appendEvidence(dir, ev);
    expect(calls).toEqual([{cwd: dir, featureId: 'F-001'}]);
  });

  test('multiple observers all receive the event', () => {
    let countA = 0;
    let countB = 0;
    subscribeAudit(() => countA++);
    subscribeAudit(() => countB++);
    appendEvidence(dir, makeEvidence('F-001'));
    appendEvidence(dir, makeEvidence('F-002'));
    expect(countA).toBe(2);
    expect(countB).toBe(2);
  });

  test('dispose callback removes the observer', () => {
    let count = 0;
    const dispose = subscribeAudit(() => count++);
    appendEvidence(dir, makeEvidence('F-001'));
    expect(count).toBe(1);
    dispose();
    appendEvidence(dir, makeEvidence('F-002'));
    expect(count).toBe(1); // unchanged
  });

  test('observer throwing does NOT break the audit append', () => {
    subscribeAudit(() => {
      throw new Error('observer is broken');
    });
    let secondaryFired = false;
    subscribeAudit(() => {
      secondaryFired = true;
    });
    // The throwing observer must not prevent the file write OR
    // subsequent observers from firing — both invariants the
    // production hook relies on.
    expect(() => appendEvidence(dir, makeEvidence('F-001'))).not.toThrow();
    const persisted = readEvidence(dir);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].featureId).toBe('F-001');
    expect(secondaryFired).toBe(true);
  });

  test('observer fires AFTER the file write — the audit log is readable from inside the observer', () => {
    let observedCount = -1;
    subscribeAudit((cwd) => {
      observedCount = readEvidence(cwd).length;
    });
    appendEvidence(dir, makeEvidence('F-001'));
    expect(observedCount).toBe(1);
  });

  test('[covers:F-074/AC-213] subscribes after a successful append, disposes, and isolates throwing observers', () => {
    const observed: string[] = [];
    subscribeAudit(() => {
      throw new Error('observer failure must be isolated');
    });
    const dispose = subscribeAudit((cwd, evidence) => {
      expect(readEvidence(cwd).map((stored) => stored.featureId)).toContain(evidence.featureId);
      observed.push(evidence.featureId);
    });

    expect(() => appendEvidence(dir, makeEvidence('F-001'))).not.toThrow();
    expect(observed).toEqual(['F-001']);
    dispose();
    appendEvidence(dir, makeEvidence('F-002'));
    expect(observed).toEqual(['F-001']);
    expect(readEvidence(dir).map((evidence) => evidence.featureId)).toEqual(['F-001', 'F-002']);
  });

  test('clearAuditObserversForTesting empties the observer set', () => {
    let count = 0;
    subscribeAudit(() => count++);
    subscribeAudit(() => count++);
    clearAuditObserversForTesting();
    appendEvidence(dir, makeEvidence('F-001'));
    expect(count).toBe(0);
  });
});

describe('appendEvidence + readEvidence (pre-existing behaviour)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-audit-'));
    clearAuditObserversForTesting();
  });
  afterEach(() => {
    clearAuditObserversForTesting();
    rmSync(dir, {recursive: true, force: true});
  });

  test('creates .cladding/ on first append', () => {
    const ev = newEvidence({
      featureId: 'F-001',
      stage: 't',
      identity: {author: 'tool', name: 't', timestamp: '2026-05-19T00:00:00Z'},
      kind: 'note',
      content: '',
    });
    appendEvidence(dir, ev);
    const persisted = readFileSync(join(dir, '.cladding', 'audit.log.jsonl'), 'utf8');
    expect(persisted).toContain('F-001');
  });

  test('readEvidence returns empty when no log exists', () => {
    expect(readEvidence(dir)).toEqual([]);
  });

  test('multiple appends preserve order', () => {
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-001',
        stage: 't',
        identity: {author: 'tool', name: 't', timestamp: '2026-05-19T00:00:00Z'},
        kind: 'note',
        content: '',
      }),
    );
    appendEvidence(
      dir,
      newEvidence({
        featureId: 'F-002',
        stage: 't',
        identity: {author: 'tool', name: 't', timestamp: '2026-05-19T00:00:00Z'},
        kind: 'note',
        content: '',
      }),
    );
    const persisted = readEvidence(dir);
    expect(persisted.map((e) => e.featureId)).toEqual(['F-001', 'F-002']);
  });

  test('recovers a journaled interrupted append before accepting the next serialized append', () => {
    const first = newEvidence({featureId: 'F-001', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'first'});
    expect(() => appendEvidence(dir, first, 1)).toThrow(/InjectedTransactionFault/);
    const second = newEvidence({featureId: 'F-002', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'second'});
    appendEvidence(dir, second);
    expect(readEvidence(dir).map((entry) => entry.featureId)).toEqual(['F-002']);
  });

  test('rejects a symlinked audit target without touching an outside sentinel', () => {
    const outside = mkdtempSync(join(tmpdir(), 'clad-audit-outside-'));
    try {
      const sentinel = join(outside, 'sentinel.jsonl');
      writeFileSync(sentinel, 'outside\n');
      mkdirSync(join(dir, '.cladding'));
      symlinkSync(sentinel, join(dir, '.cladding', 'audit.log.jsonl'));
      expect(() => appendEvidence(dir, newEvidence({featureId: 'F-001', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'unsafe'}))).toThrow(/symbolic-link/i);
      expect(readFileSync(sentinel, 'utf8')).toBe('outside\n');
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  test('rejects a symlinked .cladding ancestry without touching an outside sentinel', () => {
    const outside = mkdtempSync(join(tmpdir(), 'clad-audit-outside-'));
    try {
      const sentinel = join(outside, 'audit.log.jsonl');
      writeFileSync(sentinel, 'outside\n');
      symlinkSync(outside, join(dir, '.cladding'), 'dir');
      expect(() => appendEvidence(dir, newEvidence({featureId: 'F-001', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'unsafe'}))).toThrow(/symbolic-link/i);
      expect(readFileSync(sentinel, 'utf8')).toBe('outside\n');
    } finally {
      rmSync(outside, {recursive: true, force: true});
    }
  });

  test('two barrier-released audit children preserve distinct entries under the F4 lock', async () => {
    const first = newEvidence({featureId: 'F-001', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'first'});
    const second = newEvidence({featureId: 'F-002', stage: 't', identity: {author: 'tool'}, kind: 'note', content: 'second'});
    const left = startAuditChild(dir, first);
    const right = startAuditChild(dir, second);

    await Promise.all([left.ready, right.ready]);
    left.release();
    right.release();
    await Promise.all([left.done, right.done]);

    expect(readEvidence(dir).map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
  });
});
