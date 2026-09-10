// Cladding · unit tests for stages/detectors/spec-conformance.ts (SPEC_CONFORMANCE, #34)
//
// The presence/integrity guard backing stage_2.3. Two halves, done-only:
//   INTEGRITY (always): declared oracle_refs must resolve on disk.
//   MANDATORY (opt-in): require_oracles ⇒ a done AC must declare oracle_refs.
// Critically INERT by default (no flag + no refs ⇒ zero findings), so adding
// it cannot retroactively red legacy specs / cladding-self.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {specConformance} from '../../../src/stages/detectors/spec-conformance.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'clad-spec-conf-detector-'));
});
afterEach(() => {
  rmSync(dir, {recursive: true, force: true});
});

/** Write a minimal, schema-valid spec.yaml into the temp dir. */
function writeSpec(body: string): void {
  writeFileSync(join(dir, 'spec.yaml'), body);
}
function run(): readonly {detector: string; severity: string; message: string; path?: string}[] {
  return specConformance.run({cwd: dir}).filter((f) => f.detector === 'SPEC_CONFORMANCE');
}
function oracleFile(rel = 'tests/oracle/foo.test.ts'): void {
  mkdirSync(join(dir, 'tests/oracle'), {recursive: true});
  writeFileSync(join(dir, rel), "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));\n");
}
/** Write synthesized audit-log evidence (.cladding/audit.log.jsonl). */
function writeEvidence(entries: object[]): void {
  mkdirSync(join(dir, '.cladding'), {recursive: true});
  writeFileSync(join(dir, '.cladding/audit.log.jsonl'), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
}
const oracleEv = (name: string, opts: {manifest?: string[]; blind?: boolean} = {}) => ({
  id: 'ev-o', featureId: 'F-001', acId: 'AC-001', stage: 'stage_2.3',
  identity: {author: 'llm', name, timestamp: '2026-06-02T00:00:00Z'},
  kind: 'oracle', content: 'oracle authored', artifact: 'tests/oracle/foo.test.ts',
  readManifest: opts.manifest ?? [], blind: opts.blind ?? true,
});
// `stage` defaults to the pre-0.6.0 'agent:specialists' spelling on purpose:
// old audit logs carry it, and the detector must keep matching both it and
// the renamed 'agent:developer'.
const implEv = (name: string, stage = 'agent:specialists') => ({
  id: 'ev-i', featureId: 'F-001', acId: 'AC-001', stage,
  identity: {author: 'llm', name, timestamp: '2026-06-02T00:00:00Z'},
  kind: 'note', content: 'implemented',
});

const SPEC = (project: string, acYaml: string): string =>
  `schema: "0.1"\nproject: {${project}}\nfeatures:\n  - id: F-001\n    title: f\n    status: done\n    acceptance_criteria:\n      - id: AC-001\n        ears: ubiquitous\n        text: t\n${acYaml}`;

describe('SPEC_CONFORMANCE detector', () => {
  test('INERT: require_oracles unset + no oracle_refs ⇒ zero findings (dogfood-safety)', () => {
    writeSpec(SPEC('name: f, language: typescript', '        evidence_refs: [fixture:x]'));
    expect(run()).toHaveLength(0);
  });

  test('[covers:F-c4c5ae/AC-004] MANDATORY: require_oracles ON + done AC with no oracle_refs ⇒ error', () => {
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        evidence_refs: [fixture:x]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain('lacks a spec-conformance oracle');
  });

  test('PROVENANCE: require_oracles ON + oracle resolves but NO provenance record ⇒ error', () => {
    oracleFile();
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain('no authoring-provenance record');
  });

  test('FULLY SATISFIED: oracle resolves + clean provenance (author≠impl, manifest∩modules=∅) ⇒ no findings', () => {
    oracleFile();
    writeEvidence([implEv('impl-model'), oracleEv('oracle-model', {manifest: ['REQ.md'], blind: true})]);
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    expect(run()).toHaveLength(0);
  });

  test('[covers:F-c4c5ae/AC-005] PROVENANCE: oracle author == implementer ⇒ error (not impl-blind)', () => {
    oracleFile();
    writeEvidence([implEv('same-model'), oracleEv('same-model', {manifest: []})]);
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    const f = run();
    expect(f.some((x) => x.severity === 'error' && /NOT impl-blind: authored by the implementer/.test(x.message))).toBe(true);
  });

  test("PROVENANCE: implementer recorded under the 0.6.0 'agent:developer' stage is matched too", () => {
    oracleFile();
    writeEvidence([implEv('same-model', 'agent:developer'), oracleEv('same-model', {manifest: []})]);
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    const f = run();
    expect(f.some((x) => x.severity === 'error' && /NOT impl-blind: authored by the implementer/.test(x.message))).toBe(true);
  });

  test('[covers:F-c4c5ae/AC-005] PROVENANCE: read-manifest ∩ modules ≠ ∅ ⇒ error (author read the impl)', () => {
    oracleFile();
    writeEvidence([implEv('impl-model'), oracleEv('oracle-model', {manifest: ['src/sheet.ts']})]);
    writeSpec(
      'schema: "0.1"\nproject: {name: f, language: typescript, require_oracles: true}\nfeatures:\n' +
        '  - id: F-001\n    title: f\n    status: done\n    modules: [src/sheet.ts]\n    acceptance_criteria:\n' +
        '      - id: AC-001\n        ears: ubiquitous\n        text: t\n        oracle_refs: [tests/oracle/foo.test.ts]\n',
    );
    const f = run();
    expect(f.some((x) => x.severity === 'error' && /author read implementation file/.test(x.message))).toBe(true);
  });

  test('PROVENANCE: blind=false (host self-reported) ⇒ info marker, manifest still checked (no error when clean)', () => {
    oracleFile();
    writeEvidence([implEv('impl-model'), oracleEv('oracle-model', {manifest: ['REQ.md'], blind: false})]);
    writeSpec(SPEC('name: f, language: typescript, require_oracles: true', '        oracle_refs: [tests/oracle/foo.test.ts]'));
    const f = run();
    expect(f.every((x) => x.severity !== 'error')).toBe(true);
    expect(f.some((x) => x.severity === 'info' && /self-reported/.test(x.message))).toBe(true);
  });

  test('[covers:F-c4c5ae/AC-004] INTEGRITY (always-on): declared oracle_ref to a missing file ⇒ error, even with require_oracles OFF', () => {
    writeSpec(SPEC('name: f, language: typescript', '        oracle_refs: [tests/oracle/missing.test.ts]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain('resolves to nothing');
  });

  test('INTEGRITY: resolving oracle_ref OUTSIDE tests/oracle/ ⇒ warn (stage_2.3 would not run it)', () => {
    mkdirSync(join(dir, 'tests'), {recursive: true});
    writeFileSync(join(dir, 'tests/elsewhere.test.ts'), "import {test, expect} from 'vitest';\ntest('x', () => expect(1).toBe(1));\n");
    writeSpec(SPEC('name: f, language: typescript', '        oracle_refs: [tests/elsewhere.test.ts]'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('warn');
    expect(f[0]?.message).toContain('outside');
  });

  test('STATUS-AWARE: a planned (non-done) feature is not inspected even with a dangling oracle_ref', () => {
    writeFileSync(
      join(dir, 'spec.yaml'),
      'schema: "0.1"\nproject: {name: f, language: typescript, require_oracles: true}\nfeatures:\n' +
        '  - id: F-001\n    title: f\n    status: planned\n    acceptance_criteria:\n' +
        '      - id: AC-001\n        ears: ubiquitous\n        text: t\n        oracle_refs: [tests/oracle/missing.test.ts]\n',
    );
    expect(run()).toHaveLength(0);
  });

  // Lever 1 — risk-weighted oracle_policy (replaces the all-or-nothing boolean).
  /** A spec whose single done AC carries the given `ears`. */
  const SPEC_EARS = (project: string, ears: string): string =>
    `schema: "0.1"\nproject: {${project}}\nfeatures:\n  - id: F-001\n    title: f\n    status: done\n    acceptance_criteria:\n      - id: AC-001\n        ears: ${ears}\n        text: t\n        evidence_refs: [fixture:x]`;

  test('POLICY always_ears: a done unwanted AC with no oracle ⇒ error (reason names always_ears)', () => {
    writeSpec(SPEC_EARS("name: f, language: typescript, oracle_policy: {always_ears: ['unwanted']}", 'unwanted'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.severity).toBe('error');
    expect(f[0]?.message).toContain("always_ears includes 'unwanted'");
  });

  test('POLICY sample 0: a done NON-always (ubiquitous) AC is NOT required ⇒ zero findings', () => {
    writeSpec(SPEC_EARS("name: f, language: typescript, oracle_policy: {always_ears: ['unwanted'], sample: 0}", 'ubiquitous'));
    expect(run()).toHaveLength(0);
  });

  test('POLICY sample 1.0: even a ubiquitous done AC is required ⇒ error', () => {
    writeSpec(SPEC_EARS('name: f, language: typescript, oracle_policy: {sample: 1}', 'ubiquitous'));
    const f = run();
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain('selected by oracle_policy.sample');
  });

  test('PRECEDENCE: oracle_policy {sample:0} OVERRIDES require_oracles:true ⇒ ubiquitous AC not forced', () => {
    writeSpec(SPEC_EARS('name: f, language: typescript, require_oracles: true, oracle_policy: {sample: 0}', 'ubiquitous'));
    expect(run()).toHaveLength(0);
  });
});

// ─── F-551a1c — graduated mandate reports, never blocks; the denominator is named ───

describe('graduated report-only mandate (F-551a1c)', () => {
  test('[covers:F-551a1c/AC-7bb981] a grown undeclared-policy project: missing unwanted-AC oracle is INFO (report), and the untagged denominator is named', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-sc-grad-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n');
      for (let i = 0; i < 8; i++) {
        const tagged = i === 0
          ? '  - {id: AC-001, ears: unwanted, text: rejects bad input, test_refs: [spec.yaml]}\n'
          : '  - {id: AC-001, text: t, test_refs: [spec.yaml]}\n'; // untagged
        writeFileSync(
          join(dir, 'spec', 'features', `f${i}-aaaa000${i}.yaml`),
          `id: F-aaaa000${i}\nslug: f${i}\ntitle: t\nstatus: done\nmodules: []\nacceptance_criteria:\n${tagged}`,
        );
      }
      const findings = specConformance.run({cwd: dir});
      const mandate = findings.filter((f) => f.message.includes('lacks a spec-conformance oracle'));
      expect(mandate.length).toBe(1); // only the unwanted-tagged AC is required
      expect(mandate[0].severity).toBe('info'); // report-only — never blocks
      expect(mandate[0].message).toContain('report-only');
      const denom = findings.find((f) => f.message.includes('no EARS tag'));
      expect(denom?.severity).toBe('info');
      expect(denom?.message).toContain('7 done AC(s)');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });

  test('an EXPLICIT oracle_policy keeps blocking severity (no report-only dilution)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clad-sc-explicit-'));
    try {
      mkdirSync(join(dir, 'spec', 'features'), {recursive: true});
      writeFileSync(join(dir, 'spec.yaml'), 'schema: "0.1"\nproject:\n  name: x\n  language: typescript\n  oracle_policy: {}\nfeatures: []\n');
      writeFileSync(
        join(dir, 'spec', 'features', 'f-bbbb0001.yaml'),
        'id: F-bbbb0001\nslug: f\ntitle: t\nstatus: done\nmodules: []\nacceptance_criteria:\n  - {id: AC-001, ears: unwanted, text: rejects, test_refs: [spec.yaml]}\n',
      );
      const findings = specConformance.run({cwd: dir});
      const mandate = findings.find((f) => f.message.includes('lacks a spec-conformance oracle'));
      expect(mandate?.severity).toBe('error');
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  });
});
