// Cladding · unit tests for oracle/record.ts (Phase 2 — clad_author_oracle recorder)
//
// The risky bit is the shard edit (oracle_refs stamp). These prove it stays
// SAFE: the shard still parses after editing, comments survive, and the stamp
// is idempotent — no malformed-shard regression (the bug just fixed elsewhere).

import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parseDocument} from 'yaml';

import {readEvidence} from '../src/hitl/audit.js';
import {addOracleRef, oraclePathFor, recordOracle} from '../src/oracle/record.js';

let dir: string;
const SHARD = '# Cladding · Tier A · SSoT — header comment that MUST survive\nid: F-x\nslug: widget\ntitle: Widget\nstatus: done\nmodules:\n  - src/widget.ts\nacceptance_criteria:\n  - id: AC-001\n    ears: event\n    text: does the thing\n';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-oracle-record-'));
  mkdirSync(join(dir, 'spec/features'), {recursive: true});
  writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: oracle\n  language: typescript\n');
  writeFileSync(join(dir, 'spec/features/widget-abc123.yaml'), SHARD);
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

const shardText = (): string => readFileSync(join(dir, 'spec/features/widget-abc123.yaml'), 'utf8');

describe('oracle/record — addOracleRef (the comment-preserving shard editor)', () => {
  test('stamps oracle_refs, the shard STILL PARSES, and the header comment survives', () => {
    const ref = oraclePathFor('F-x', 'AC-001');
    expect(addOracleRef(dir, 'F-x', 'AC-001', ref)).toBe(true);
    const txt = shardText();
    expect(txt).toContain('# Cladding · Tier A · SSoT — header comment that MUST survive'); // comment preserved
    const doc = parseDocument(txt); // must not throw — no malformed-shard regression
    expect(doc.errors).toHaveLength(0);
    const ac = (doc.get('acceptance_criteria') as {items: {get: (k: string) => unknown}[]}).items[0];
    expect(JSON.stringify(ac.get('oracle_refs'))).toContain(ref);
  });

  test('is idempotent — stamping the same ref twice does not duplicate it', () => {
    const ref = oraclePathFor('F-x', 'AC-001');
    addOracleRef(dir, 'F-x', 'AC-001', ref);
    addOracleRef(dir, 'F-x', 'AC-001', ref);
    const occurrences = shardText().split(ref).length - 1;
    expect(occurrences).toBe(1);
  });

  test('unknown feature or AC → false (no write, caller surfaces a manual hint)', () => {
    expect(addOracleRef(dir, 'F-nope', 'AC-001', 'x')).toBe(false);
    expect(addOracleRef(dir, 'F-x', 'AC-nope', 'x')).toBe(false);
  });

  test('routes a schema 0.2 oracle stamp through the typed proof-reference transaction', () => {
    writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.2"\nproject:\n  name: oracle\n  language: typescript\n  purpose: Keep proof bindings explicit.\n  assurance_level: L2\n  scenario_policy: advisory\n');
    writeFileSync(join(dir, 'spec', 'capabilities.yaml'), 'capabilities: []\n');
    writeFileSync(join(dir, 'spec', 'architecture.yaml'), 'layers:\n  - [core]\nrules: []\n');
    rmSync(join(dir, 'spec', 'features', 'widget-abc123.yaml'));
    writeFileSync(join(dir, 'spec', 'features', 'widget-aaaaaaaa.yaml'), [
      'id: F-aaaaaaaa', 'title: Widget', 'status: planned', 'purpose: Keep oracle ownership explicit.', 'modules: []', 'depends_on: []', 'capability_refs: []', 'acceptance_criteria:', '  - id: AC-bbbbbbbb', '    kind: behavior', '    statement: The system shall retain oracle references.', '',
    ].join('\n'));
    const ref = oraclePathFor('F-aaaaaaaa', 'AC-bbbbbbbb');
    expect(addOracleRef(dir, 'F-aaaaaaaa', 'AC-bbbbbbbb', ref)).toBe(true);
    expect(readFileSync(join(dir, 'spec', 'features', 'widget-aaaaaaaa.yaml'), 'utf8')).toContain(ref);
    expect(existsSync(join(dir, '.cladding', 'spec-transaction.json'))).toBe(false);
  });
});

describe('oracle/record — recordOracle (end to end)', () => {
  test('[covers:F-c4c5ae/AC-007] writes the oracle file, records kind:oracle provenance (manifest+blind), stamps the ref', () => {
    const r = recordOracle({
      featureId: 'F-x',
      acId: 'AC-001',
      body: "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));",
      readManifest: ['signatures-of:src/widget.ts', 'spec:acceptance_criteria'],
      blind: true,
      authorName: 'blind-subagent',
      cwd: dir,
    });
    expect(r.ok).toBe(true);
    expect(existsSync(join(dir, r.oraclePath))).toBe(true);

    const prov = readEvidence(dir).find((e) => e.kind === 'oracle');
    expect(prov?.acId).toBe('AC-001');
    expect(prov?.identity.name).toBe('blind-subagent');
    expect(prov?.blind).toBe(true);
    expect(prov?.readManifest).toContain('spec:acceptance_criteria');
    expect(prov?.artifact).toBe(r.oraclePath);

    expect(shardText()).toContain(r.oraclePath); // oracle_ref stamped
  });

  test('no shard for the feature → ok:false with a manual-stamp hint (file + provenance still written)', () => {
    const r = recordOracle({featureId: 'F-orphan', acId: 'AC-001', body: 'x', readManifest: [], cwd: dir});
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('manually');
    expect(existsSync(join(dir, r.oraclePath))).toBe(true); // file still written
  });
});
