// Cladding · HITL · audit trail (append-only JSONL)
//
// Evidence is recorded to `.cladding/audit.log.jsonl` — one JSON object
// per line, append-only. The format is intentionally lightweight so
// users can `tail -f` the log or `jq` over it without extra tooling.
// The directory is created lazily on first append.
//
// v0.2.25 (F-074) adds an observer hook so `clad serve` (the MCP
// server) can broadcast a resource-updated notification to connected
// clients each time evidence lands. The hook is **synchronous** —
// observers must be cheap or fire-and-forget; if one throws, the
// throw is swallowed so a misbehaving observer can't corrupt the
// audit chain. The file write happens before observer dispatch, so
// even a throwing observer leaves the audit log intact.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import type {Evidence} from './identity.js';

const AUDIT_DIR = '.cladding';
const AUDIT_FILE = 'audit.log.jsonl';

function auditPath(cwd: string): string {
  return join(cwd, AUDIT_DIR, AUDIT_FILE);
}

/**
 * Observer notified after every successful `appendEvidence` write.
 * Receives the project root and the freshly appended evidence. Used
 * by `clad serve` to emit MCP `notifications/resources/updated` for
 * the `cladding://audit` resource (v0.2.25, F-074).
 */
export type AuditObserver = (cwd: string, evidence: Evidence) => void;

const observers: Set<AuditObserver> = new Set();

/**
 * Registers an audit observer and returns a disposer that removes it.
 *
 * Observers fire AFTER the file write, so an observer's failure
 * cannot corrupt the audit chain. Exceptions thrown from an observer
 * are caught and dropped — a misbehaving observer must not break the
 * `appendEvidence` contract for the rest of the system.
 */
export function subscribeAudit(observer: AuditObserver): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

/**
 * Test-only — clears every registered observer. Production code never
 * needs this; test suites that register and forget would otherwise
 * cross-pollute through the module-level Set.
 */
export function clearAuditObserversForTesting(): void {
  observers.clear();
}

/** Append one evidence entry to the audit log. Creates the directory if needed. */
export function appendEvidence(cwd: string, evidence: Evidence): void {
  const path = auditPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  appendFileSync(path, `${JSON.stringify(evidence)}\n`, 'utf8');
  for (const observer of observers) {
    try {
      observer(cwd, evidence);
    } catch {
      // Observers must not break the audit contract — swallow.
    }
  }
}

/** Read every recorded evidence entry, in append order. */
export function readEvidence(cwd: string): readonly Evidence[] {
  const path = auditPath(cwd);
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8').trim();
  if (raw.length === 0) return [];
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Evidence);
}
