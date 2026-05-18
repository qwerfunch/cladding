// Cladding · HITL · audit trail (append-only JSONL)
//
// Evidence is recorded to `.cladding/audit.log.jsonl` — one JSON object
// per line, append-only. The format is intentionally lightweight so
// users can `tail -f` the log or `jq` over it without extra tooling.
// The directory is created lazily on first append.

import {appendFileSync, existsSync, mkdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import type {Evidence} from './identity.js';

const AUDIT_DIR = '.cladding';
const AUDIT_FILE = 'audit.log.jsonl';

function auditPath(cwd: string): string {
  return join(cwd, AUDIT_DIR, AUDIT_FILE);
}

/** Append one evidence entry to the audit log. Creates the directory if needed. */
export function appendEvidence(cwd: string, evidence: Evidence): void {
  const path = auditPath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  appendFileSync(path, `${JSON.stringify(evidence)}\n`, 'utf8');
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
