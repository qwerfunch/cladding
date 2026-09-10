// Cladding · oracle · record a host-authored oracle + its impl-blind provenance
//
// The recorder half of Phase 2 (host-protocol, LLM-free). After the host's
// blind sub-agent writes an oracle from `clad oracle`'s brief, this:
//   1. writes the oracle file under tests/oracle/ (the dir stage_2.3 runs),
//   2. appends a `kind:'oracle'` provenance Evidence (author + read-manifest +
//      blind marker) the SPEC_CONFORMANCE gate audits (author≠impl, manifest∩modules),
//   3. stamps `oracle_refs` onto the AC in its shard so INTEGRITY + MANDATORY bind.
// The shard edit goes through the `yaml` Document API so comments + layout survive.

import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, relative} from 'node:path';

import {isMap, isSeq, parseDocument} from 'yaml';

import {appendEvidence} from '../hitl/audit.js';
import {newEvidence} from '../hitl/identity.js';
import type {Evidence} from '../hitl/identity.js';
import {commitSchema01CompatibilityMutation, editSpec, readSpecEditRevisions} from '../spec/edit.js';

const ORACLE_DIR = 'tests/oracle';

/** Deterministic oracle path for a feature/AC — unique across features. */
export function oraclePathFor(featureId: string, acId: string): string {
  return `${ORACLE_DIR}/${featureId}.${acId}.test.ts`;
}

/** The shard file (spec/features/*.yaml) that declares `featureId`, or null. */
function findShardPath(cwd: string, featureId: string): string | null {
  const dir = join(cwd, 'spec/features');
  if (!existsSync(dir)) return null;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.yaml') || n.endsWith('.yml'))) {
    const p = join(dir, name);
    try {
      if (parseDocument(readFileSync(p, 'utf8')).get('id') === featureId) return p;
    } catch {
      /* skip an unparseable shard — ABSENCE_OF_GOVERNANCE flags it */
    }
  }
  return null;
}

/**
 * Appends `refPath` to a feature AC's `oracle_refs` in its shard, preserving
 * comments/layout (yaml Document API). Idempotent. Returns false when the
 * feature/AC shard can't be located (caller surfaces a manual-stamp hint).
 */
export function addOracleRef(cwd: string, featureId: string, acId: string, refPath: string): boolean {
  const shardPath = findShardPath(cwd, featureId);
  if (!shardPath) return false;
  const sourceBytes = readFileSync(shardPath, 'utf8');
  const doc = parseDocument(sourceBytes);
  const acs = doc.get('acceptance_criteria');
  if (!isSeq(acs)) return false;
  const ac = acs.items.find((m) => isMap(m) && m.get('id') === acId);
  if (!ac || !isMap(ac)) return false;
  const refs = ac.get('oracle_refs', true);
  if (isSeq(refs)) {
    if (refs.items.some((n) => (isMap(n) ? undefined : (n as {value?: unknown}).value) === refPath)) return true;
    refs.add(refPath);
  } else {
    ac.set('oracle_refs', [refPath]);
  }
  const rootPath = join(cwd, 'spec.yaml');
  const schema02 = existsSync(rootPath) && /^schema:\s*["']?0\.2["']?\s*$/m.test(readFileSync(rootPath, 'utf8'));
  if (schema02) {
    const existing = isSeq(refs)
      ? refs.items.flatMap((node) => typeof (node as {value?: unknown}).value === 'string' ? [(node as {value: string}).value] : [])
      : [];
    // The sequence has already received refPath above, so normalize the
    // operation from its pre-write values rather than serializing the YAML
    // document. This gives schema 0.2 one typed proof-reference authority.
    const original = existing.filter((entry) => entry !== refPath);
    const operation = {
      kind: 'criterion.set_proof_refs' as const,
      featureId,
      criterionId: acId,
      oracleRefs: [...new Set([...original, refPath])],
    };
    const revisions = readSpecEditRevisions(cwd, [operation]);
    if (revisions[`feature:${featureId}`] !== createHash('sha256').update(sourceBytes).digest('hex')) return false;
    editSpec({cwd, operations: [operation], inputRevisions: revisions});
    return true;
  }
  commitSchema01CompatibilityMutation(cwd, [{path: relative(cwd, shardPath), before: sourceBytes, after: String(doc)}]);
  return true;
}

export interface RecordOracleInput {
  readonly featureId: string;
  readonly acId: string;
  /** The host-authored oracle test source. */
  readonly body: string;
  /** Files/inputs the author saw (for the gate's manifest∩modules check). */
  readonly readManifest: readonly string[];
  /** True only when the host attests a clean (spec-only) sub-agent context. */
  readonly blind?: boolean;
  /** The oracle author's identity handle (sub-agent / model id). */
  readonly authorName?: string;
  readonly cwd?: string;
}

export interface RecordOracleResult {
  readonly ok: boolean;
  readonly oraclePath: string;
  readonly evidenceId?: string;
  readonly reason?: string;
}

/** Writes the oracle, records provenance, and stamps the oracle_ref. */
export function recordOracle(input: RecordOracleInput): RecordOracleResult {
  const cwd = input.cwd ?? '.';
  const oraclePath = oraclePathFor(input.featureId, input.acId);
  const abs = join(cwd, oraclePath);
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, input.body.endsWith('\n') ? input.body : `${input.body}\n`, 'utf8');

  const ev: Evidence = newEvidence({
    featureId: input.featureId,
    acId: input.acId,
    stage: 'stage_2.3',
    identity: {author: 'llm', name: input.authorName ?? 'oracle-author'},
    kind: 'oracle',
    content: `impl-blind oracle authored for ${input.featureId}.${input.acId} (blind=${input.blind === true})`,
    artifact: oraclePath,
    readManifest: input.readManifest,
    blind: input.blind === true,
  });
  appendEvidence(cwd, ev);

  if (!addOracleRef(cwd, input.featureId, input.acId, oraclePath)) {
    return {
      ok: false,
      oraclePath,
      evidenceId: ev.id,
      reason: `oracle + provenance written, but could not stamp oracle_refs (no shard for ${input.featureId}.${input.acId}) — add 'oracle_refs: [${oraclePath}]' to the AC manually`,
    };
  }
  return {ok: true, oraclePath, evidenceId: ev.id};
}
