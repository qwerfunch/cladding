// Cladding · unit tests for stages/detectors/stale-evidence.ts
//
// Detector under test scans the audit log and flags entries whose
// `identity.timestamp` is more than 90 days old. Timestamp parse
// failure → entry skipped (graceful). Audit log absent → info finding
// (opt-in semantics).
//
// Tests stamp timestamps explicitly rather than rely on wall clock,
// keeping the suite deterministic.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {staleEvidence} from '../../src/stages/detectors/stale-evidence.js';

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function writeAuditLine(dir: string, entry: Record<string, unknown>): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(
    join(dir, '.cladding', 'audit.log.jsonl'),
    `${JSON.stringify(entry)}\n`,
    {flag: 'a'},
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

describe('STALE_EVIDENCE detector', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-stale-ev-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('audit log absent → info finding', () => {
    const findings = staleEvidence.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].message).toContain('no audit log');
  });

  test('entry younger than 90 days → silent', () => {
    writeAuditLine(dir, {
      id: 'e-1',
      featureId: 'F-001',
      stage: 'stage_4.1',
      kind: 'pass',
      content: 'fresh',
      identity: {author: 'human', name: 'qa', timestamp: isoDaysAgo(30)},
    });
    expect(staleEvidence.run({cwd: dir})).toEqual([]);
  });

  test('entry older than 90 days → warn finding with age', () => {
    writeAuditLine(dir, {
      id: 'e-old',
      featureId: 'F-001',
      stage: 'stage_4.1',
      kind: 'pass',
      content: 'old',
      identity: {author: 'human', name: 'qa', timestamp: isoDaysAgo(120)},
    });
    const findings = staleEvidence.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('e-old');
    expect(findings[0].message).toContain('120 days');
    expect(findings[0].message).toContain('floor 90');
  });

  test('mixed-age entries → only stale ones reported', () => {
    writeAuditLine(dir, {
      id: 'e-fresh',
      featureId: 'F-001',
      stage: 'stage_4.1',
      kind: 'pass',
      content: 'fresh',
      identity: {author: 'human', name: 'qa', timestamp: isoDaysAgo(10)},
    });
    writeAuditLine(dir, {
      id: 'e-old',
      featureId: 'F-001',
      stage: 'stage_4.1',
      kind: 'pass',
      content: 'old',
      identity: {author: 'human', name: 'qa', timestamp: isoDaysAgo(200)},
    });
    const findings = staleEvidence.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('e-old');
  });

  test('entry with unparseable timestamp → skipped (no finding)', () => {
    writeAuditLine(dir, {
      id: 'e-bad',
      featureId: 'F-001',
      stage: 'stage_4.1',
      kind: 'pass',
      content: 'bad timestamp',
      identity: {author: 'human', name: 'qa', timestamp: 'definitely not iso'},
    });
    expect(staleEvidence.run({cwd: dir})).toEqual([]);
  });
});
