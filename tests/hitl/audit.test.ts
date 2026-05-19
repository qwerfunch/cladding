// Cladding · unit tests for src/hitl/audit.ts
//
// Covers the v0.2.25 (F-074) observer hook: subscribeAudit registers
// listeners, observers fire after the file write, exceptions in an
// observer are swallowed without breaking the audit chain, dispose
// callbacks remove the listener.

import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
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
});
