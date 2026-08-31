// Cladding · unit tests for stages/detectors/absence-of-governance.ts (F-99c6e5)
//
// ABSENCE_OF_GOVERNANCE is a new detector that exposes the "absence of
// signal" trap surfaced by the A/B evaluation framework (F-ba2e05):
// when cladding's SSoT artifacts are missing, the other 25 detectors
// silently pass because they have nothing to evaluate. This detector
// emits a graduated set of findings instead.

import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';

import {absenceOfGovernance} from '../../src/stages/detectors/absence-of-governance.js';
import {runDrift} from '../../src/stages/drift.js';

function touch(dir: string, relPath: string, body = ''): void {
  const abs = join(dir, relPath);
  mkdirSync(join(abs, '..'), {recursive: true});
  writeFileSync(abs, body);
}

// A minimal spec.yaml whose master parses into a usable mapping — "scaffold
// present" means a READABLE SSoT root, not just an empty placeholder file.
const VALID_MASTER = 'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures: []\n';

describe('ABSENCE_OF_GOVERNANCE (F-99c6e5, v0.3.49)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clad-absence-'));
  });
  afterEach(() => {
    rmSync(dir, {recursive: true, force: true});
  });

  test('[covers:F-99c6e5/AC-002] completely empty tree — every artifact absent, all severities present', () => {
    const findings = absenceOfGovernance.run({cwd: dir});
    expect(findings.length).toBe(6);
    const severities = findings.map((f) => f.severity);
    expect(severities.filter((s) => s === 'error')).toHaveLength(1); // spec.yaml
    expect(severities.filter((s) => s === 'warn')).toHaveLength(3); // architecture + capabilities + project-context
    expect(severities.filter((s) => s === 'info')).toHaveLength(2); // conventions + scenarios/
  });

  test('only spec.yaml absent → error finding for spec.yaml', () => {
    touch(dir, 'spec/architecture.yaml');
    touch(dir, 'spec/capabilities.yaml');
    touch(dir, 'docs/project-context.md');
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/payment-flow-abc123.yaml');

    const findings = absenceOfGovernance.run({cwd: dir});
    const errors = findings.filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec.yaml');
    expect(errors[0].message).toContain('SSoT root');
  });

  test('spec.yaml PRESENT but malformed YAML → blocking error (not silently green)', () => {
    // The P1 cure: a broken SSoT root must never pass the gate green. Every
    // other Tier B/C artifact is present so the ONLY error is the broken master.
    touch(dir, 'spec.yaml', 'project: {name: x'); // unterminated flow mapping → YAML throws
    touch(dir, 'spec/architecture.yaml', VALID_MASTER);
    touch(dir, 'spec/capabilities.yaml');
    touch(dir, 'docs/project-context.md');
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/x-abc123.yaml');

    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec.yaml');
    expect(errors[0].message).toContain('unreadable');
    expect(errors[0].message).toContain('governing nothing');
  });

  test('spec.yaml PRESENT but empty → blocking error (empty SSoT root cannot govern)', () => {
    touch(dir, 'spec.yaml', '   \n');
    touch(dir, 'spec/architecture.yaml', VALID_MASTER);
    touch(dir, 'spec/capabilities.yaml');
    touch(dir, 'docs/project-context.md');
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/x-abc123.yaml');

    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec.yaml');
    expect(errors[0].message).toContain('empty or not a YAML mapping');
  });

  test('spec.yaml PRESENT and a valid mapping → no spec.yaml error', () => {
    touch(dir, 'spec.yaml', VALID_MASTER);
    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.path === 'spec.yaml');
    expect(errors).toHaveLength(0);
  });

  test('master parses but a SHARD is malformed → blocking error (closes the shard Vacuous-Green hole)', () => {
    // loadSpec throws on a malformed shard, which the spec-gated detectors swallow
    // as non-blocking info — a malformed shard used to pass the gate GREEN.
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/features/bad-aaa111.yaml', 'id: F-bad\ndup: 1\ndup: 2\n'); // duplicate key → YAML throws
    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec/features/bad-aaa111.yaml');
    expect(errors[0].message).toContain('unparseable');
  });

  test('master + a VALID shard → no shard error (no false-fire on healthy shards)', () => {
    touch(dir, 'spec.yaml', VALID_MASTER);
    // A loadSpec-valid feature (schema-valid id/title/status) — not just YAML-parseable.
    touch(dir, 'spec/features/ok-abc123.yaml', 'id: F-abc123\nslug: ok\ntitle: ok\nstatus: planned\n');
    expect(absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  test('run census never skips a malformed shard the loader did not consume', () => {
    // An inline catalogue leaves feature shard files outside loadSpec's input.
    // They remain independently parse-checked by ABSENCE_OF_GOVERNANCE even
    // when the enclosing drift run has a successful immutable load census.
    touch(
      dir,
      'spec.yaml',
      'schema: "0.1"\nproject: {name: x, language: typescript}\nfeatures:\n  - {id: F-abc123, slug: inline, title: inline, status: planned}\n',
    );
    touch(dir, 'spec/features/ignored-bad.yaml', 'id: F-bad\ndup: 1\ndup: 2\n');

    const finding = runDrift({cwd: dir}).findings.find(
      (candidate) =>
        candidate.detector === 'ABSENCE_OF_GOVERNANCE' &&
        candidate.path === 'spec/features/ignored-bad.yaml',
    );
    expect(finding?.severity).toBe('error');
    expect(finding?.message).toContain('unparseable');
  });

  test('master + shards parse but the assembled spec is SCHEMA-invalid (architecture.layers: null) → blocking error', () => {
    // The Bank-Ledger audit hole: a YAML-valid but schema-invalid spec makes
    // loadSpec THROW, which every withSpec detector swallows as non-blocking info
    // (with-spec.ts) → the whole drift layer passes GREEN on a spec cladding itself
    // rejects. ABSENCE must catch it where withSpec structurally cannot.
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/architecture.yaml', 'layers:\n'); // null, not an array → schema-invalid (the cur-proj case)
    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec.yaml');
    expect(errors[0].message).toContain('does not load');
  });

  test('master + VALID architecture (layers: []) loads → no schema-load error (the neu-proj case is valid)', () => {
    // The discriminator's other half: an empty-but-WELL-TYPED architecture loads
    // cleanly, so it must NOT fire — only an unloadable spec is blocking.
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/architecture.yaml', 'layers: []\n');
    expect(absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  test('malformed-TYPE capabilities.yaml (YAML-valid, schema-invalid) → blocking error too', () => {
    // The parse-only shard check covers spec/features|scenarios; a wrong-typed
    // spec/capabilities.yaml or architecture.yaml only surfaces via loadSpec throwing.
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/capabilities.yaml', 'schema: "0.1"\ncapabilities:\n  - id: 123\n'); // id must be string; missing required fields
    const errors = absenceOfGovernance.run({cwd: dir}).filter((f) => f.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('spec.yaml');
    expect(errors[0].message).toContain('does not load');
  });

  test('full cladding scaffold present → no findings', () => {
    // Artifacts present AND loadSpec-valid (the new schema-load backstop fires on a
    // present-but-unloadable spec, so an empty placeholder is no longer "present enough").
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/architecture.yaml', 'layers: []\n');
    touch(dir, 'spec/capabilities.yaml');
    touch(dir, 'docs/project-context.md');
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/payment-flow-abc123.yaml', 'id: S-001\ntitle: payment flow\n');

    expect(absenceOfGovernance.run({cwd: dir})).toEqual([]);
  });

  test('spec/scenarios/ exists but contains only README (no .yaml shards) → info finding', () => {
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'spec/architecture.yaml', 'layers: []\n');
    touch(dir, 'spec/capabilities.yaml');
    touch(dir, 'docs/project-context.md');
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/README.md', '# Scenarios index');

    const findings = absenceOfGovernance.run({cwd: dir});
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('info');
    expect(findings[0].path).toBe('spec/scenarios');
  });

  test('only Tier B artifacts missing → 3 warn findings, no error', () => {
    touch(dir, 'spec.yaml', VALID_MASTER);
    touch(dir, 'docs/conventions.md');
    touch(dir, 'spec/scenarios/x-abc123.yaml', 'id: S-001\ntitle: t\n');

    const findings = absenceOfGovernance.run({cwd: dir});
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(0);
    const warns = findings.filter((f) => f.severity === 'warn');
    expect(warns).toHaveLength(3);
    const warnPaths = warns.map((f) => f.path).sort();
    expect(warnPaths).toEqual(['docs/project-context.md', 'spec/architecture.yaml', 'spec/capabilities.yaml']);
  });

  test('every finding includes a hint to run clad init', () => {
    const findings = absenceOfGovernance.run({cwd: dir});
    for (const f of findings) {
      expect(f.message).toContain('clad init --intent');
    }
  });

  test('detector is idempotent — re-running on same state returns the same findings', () => {
    touch(dir, 'spec.yaml');
    const first = absenceOfGovernance.run({cwd: dir});
    const second = absenceOfGovernance.run({cwd: dir});
    expect(first.length).toBe(second.length);
    for (let i = 0; i < first.length; i++) {
      expect(first[i].path).toBe(second[i].path);
      expect(first[i].severity).toBe(second[i].severity);
    }
  });
});
