// Cladding · Spec 0.2 · the 0.10.0 release boundary in the validation ledger.
//
// Two questions are deliberately kept apart here. The reporting question ("what
// is the state of every blocking scenario?") keeps exit 0 and answers `not_run`
// while evidence is missing. The release question (`--release`) refuses: the
// same unmet state becomes a failure and a nonzero exit code.
//
// The evidence cases build a real Ed25519 issuer, a real signed receipt, and a
// real committed registry in a temporary workspace. No signing material is ever
// written into this repository.

import {copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {createIssuerKey, loadIssuerPrivateKey, signPortableReceipt} from '../../../src/proof/issuer.js';
import {serializePortableReceipt, type AuditReceipt} from '../../../src/proof/receipt.js';
import {serializeTrustRegistry} from '../../../src/proof/trust.js';
import {
  checkJourneyLedger,
  checkMcpScenarioLedger,
  checkReleaseBoundary,
  evaluateReferenceHostEvidence,
  loadValidationManifest,
  referenceHostChecks,
  runValidatorCli,
  validateSpec02,
  type ValidationManifest,
} from '../../../scripts/spec-0.2-validate.js';

const temporary: string[] = [];

afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, {recursive: true, force: true});
});

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  temporary.push(root);
  return root;
}

/** One host's recorded cycle: a signed receipt, its registry, its attestation row. */
interface RecordedHost {
  readonly host: string;
  readonly receipt_ref: string;
  readonly trust_ref: string;
  readonly attestation_ref: string;
  readonly recorded_at: string;
}

function auditBody(issuer: string, issuerKeyId: string, observedAt: string): Omit<AuditReceipt, 'issuer_proof'> {
  return {
    receipt_schema: '1', issuer, issuer_key_id: issuerKeyId,
    subject: 'criterion:F-aaaaaaaa/AC-bbbbbbbb', subject_sha256: 'a'.repeat(64),
    observed_at: observedAt, method: 'human_channel', claim: 'audit',
    reviewed_inputs_sha256: 'b'.repeat(64), runtime_dependency_sha256: 'c'.repeat(64),
    implementation_authors_sha256: 'd'.repeat(64),
    checks: {evidence_sufficiency: 'pass', code_test_review: 'pass', independence: 'pass'},
  };
}

/**
 * Records one reference-host cycle under `docs/dogfood/mcp11-0.10.0/<host>/`.
 *
 * `registerIssuer: false` writes an empty registry, so the copied snapshot does
 * not know the key that signed the receipt.
 */
function recordHost(
  root: string,
  host: string,
  options: {readonly registerIssuer?: boolean; readonly forge?: boolean; readonly attestedFeature?: string} = {},
): RecordedHost {
  const keyEnvironment = {CLADDING_KEYS_DIR: join(temporaryRoot('clad-release-keys-'), 'store')};
  const created = createIssuerKey(keyEnvironment);
  const privateKey = loadIssuerPrivateKey(created.issuerKeyId, keyEnvironment);
  const issuer = `${host}-reviewer`;
  const receipt = signPortableReceipt<AuditReceipt>(
    auditBody(issuer, created.issuerKeyId, `2026-09-0${host === 'codex' ? '5' : '6'}T00:00:00.000Z`),
    privateKey,
  );
  const directory = join(root, 'docs', 'dogfood', 'mcp11-0.10.0', host);
  mkdirSync(directory, {recursive: true});
  // One flipped hex digit keeps the receipt parseable and format-valid, so a
  // forged copy can only be rejected by the signature check itself.
  const serialized = serializePortableReceipt(
    options.forge === true ? {...receipt, subject_sha256: `${'a'.repeat(63)}b`} : receipt,
  );
  writeFileSync(join(directory, 'receipt.yaml'), serialized);
  writeFileSync(join(directory, 'issuers.yaml'), serializeTrustRegistry(
    options.registerIssuer === false ? [] : [{
      issuer, issuer_key_id: created.issuerKeyId, spki_der: Buffer.from(created.spkiDer).toString('base64'),
    }],
  ));
  writeFileSync(
    join(directory, 'attestation.yaml'),
    `schema: 3\nfeatures:\n  - id: ${options.attestedFeature ?? 'F-aaaaaaaa'}\n    status: done\n`,
  );
  const base = `docs/dogfood/mcp11-0.10.0/${host}`;
  return {
    host,
    receipt_ref: `${base}/receipt.yaml`,
    trust_ref: `${base}/issuers.yaml`,
    attestation_ref: `${base}/attestation.yaml`,
    recorded_at: '2026-09-07T00:00:00.000Z',
  };
}

/** A ledger whose only blocking rows are the reference host and one local test. */
function fixtureManifest(
  root: string,
  evidence: readonly RecordedHost[],
  overrides: {
    readonly journeyStatus?: 'not_run' | 'validation-active';
    readonly blocking?: readonly string[];
    /** `false` strips J13's test reference, leaving `evidence_from` as its only witness. */
    readonly journeyTestRef?: boolean;
  } = {},
): ValidationManifest {
  const base = loadValidationManifest(process.cwd());
  writeFileSync(join(root, 'local-scenario.test.ts'), "test('MCP01 fixture carrier', () => {});\n");
  const mcpScenarios = base.mcp_scenarios.map((scenario) => {
    if (scenario.id.startsWith('MCP11-')) return {...scenario, evidence};
    if (scenario.id.startsWith('MCP01-')) {
      return {...scenario, implementation: 'validation-active' as const, test_ref: 'local-scenario.test.ts#MCP01 fixture carrier'};
    }
    return scenario;
  });
  // Every promoted journey points at the fixture carrier so the only thing this
  // ledger can fail on is the J13 evidence invariant under test.
  const carrier = 'local-scenario.test.ts#MCP01 fixture carrier';
  const journeys = base.integration_journeys.map((journey) => {
    if (journey.id === 'J13') {
      return {
        ...journey,
        status: overrides.journeyStatus ?? 'not_run' as const,
        test_ref: overrides.journeyTestRef === false ? undefined : carrier,
      };
    }
    return journey.status === 'validation-active' ? {...journey, test_ref: carrier} : journey;
  });
  return {
    ...base,
    integration_journeys: journeys,
    mcp_scenarios: mcpScenarios,
    release_boundary: {
      release: '0.10.0',
      blocking: overrides.blocking ?? ['MCP01-handshake-and-capabilities', 'MCP11-reference-host-spec-02-cycle'],
    },
  };
}

describe('Spec 0.2 release boundary', () => {
  test('[covers:F-c2d7dc78/AC-d7dddf0c] reports every blocking scenario of the declared release boundary with its evidence state', async () => {
    const report = await validateSpec02(process.cwd());
    const boundary = report.checks.find((check) => check.id === 'release-boundary');
    expect(boundary, 'the validator emits a release-boundary check').toBeDefined();
    const manifest = loadValidationManifest(process.cwd());
    expect(manifest.release_boundary.release).toBe('0.10.0');
    // Every blocking row is named in one place, and adoption/token rows are not.
    for (const id of manifest.release_boundary.blocking) expect(boundary!.evidence).toContain(id);
    expect(manifest.release_boundary.blocking).not.toContain('MCP12-adoption-versus-delivery-telemetry');
    expect(manifest.release_boundary.blocking.some((id) => id.startsWith('AB'))).toBe(false);
    // Both reference-host cycles are now recorded, so every blocking row of the
    // declared boundary reports satisfied. The unmet direction of the same check
    // is held by the fixture ledgers below, which is where it can stay reachable
    // once the repository itself carries the evidence.
    expect(boundary!.status).toBe('pass');
    expect(boundary!.evidence).toContain('every one is satisfied');
    expect(boundary!.evidence).toContain('MCP11-reference-host-spec-02-cycle');
    expect(boundary!.evidence).not.toContain('unmet');
    expect(report.checks.some((check) => check.status === 'fail')).toBe(false);
  });

  test('[covers:F-c2d7dc78/AC-dcb6081b] fails with a nonzero exit code naming the unmet scenario when the release flag is set', async () => {
    // The repository now carries both reference-host cycles, so the unmet state
    // this criterion is about is reached through a fixture ledger instead. The
    // exit code is derived from any failing check, so a release-flag failure here
    // is exactly what a nonzero release run reports.
    const root = temporaryRoot('clad-release-flag-');
    const unmet = fixtureManifest(root, [], {journeyStatus: 'not_run'});
    const evidence = evaluateReferenceHostEvidence(root, unmet);
    const refused = checkReleaseBoundary(root, unmet, evidence, {release: true});
    expect(refused.status).toBe('fail');
    expect(refused.evidence).toContain('Release run refused');
    expect(refused.evidence).toContain('MCP11-reference-host-spec-02-cycle');
    // Without the flag the identical unmet state is reported, never failed.
    expect(checkReleaseBoundary(root, unmet, evidence).status).toBe('not_run');

    // Against the real repository the release flag is satisfied, and the CLI maps
    // "no failing check" to exit 0 the same way it would map a failure to 1.
    const released = await runValidatorCli(['--release'], process.cwd());
    expect(released.report.checks.filter((check) => check.status === 'fail')).toEqual([]);
    expect(released.exitCode).toBe(0);
  });

  test('[covers:F-c2d7dc78/AC-36842395] requires a resolving test reference from every test-backed validation-active MCP scenario row', () => {
    const root = temporaryRoot('clad-release-ledger-');
    const manifest = fixtureManifest(root, []);
    const missing = {
      ...manifest,
      mcp_scenarios: manifest.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP01-') ? {...scenario, test_ref: undefined} : scenario),
    };
    expect(checkReleaseBoundary(root, missing, evaluateReferenceHostEvidence(root, missing)).evidence)
      .toContain('MCP01-handshake-and-capabilities (the scenario test reference does not resolve)');

    const unresolvable = {
      ...manifest,
      mcp_scenarios: manifest.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP01-')
          ? {...scenario, test_ref: 'local-scenario.test.ts#a title nothing carries'}
          : scenario),
    };
    expect(checkReleaseBoundary(root, unresolvable, evaluateReferenceHostEvidence(root, unresolvable)).evidence)
      .toContain('MCP01-handshake-and-capabilities (the scenario test reference does not resolve)');

    // The scenario ledger refuses the same promotion against the real repository.
    const repositoryLedger = loadValidationManifest(process.cwd());
    const unreferenced = {
      ...repositoryLedger,
      mcp_scenarios: repositoryLedger.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP01-') ? {...scenario, test_ref: undefined} : scenario),
    };
    const ledgerCheck = checkMcpScenarioLedger(process.cwd(), unreferenced, evaluateReferenceHostEvidence(process.cwd(), unreferenced));
    expect(ledgerCheck.status).toBe('fail');
    expect(ledgerCheck.evidence).toContain('unresolved_test_ref=MCP01-handshake-and-capabilities');
    const repositoryCheck = checkMcpScenarioLedger(process.cwd(), repositoryLedger, evaluateReferenceHostEvidence(process.cwd(), repositoryLedger));
    expect(repositoryCheck.status).toBe('pass');
    // The reference-host row is the one exemption: its recorded evidence, not a
    // local test reference, is what carries it.
    expect(repositoryCheck.evidence).toContain('MCP11 decided by recorded scenario evidence');
    expect(repositoryCheck.evidence).not.toContain('MCP11-reference-host-spec-02-cycle,');

    // The resolving reference is what makes the same row satisfied.
    expect(checkReleaseBoundary(root, manifest, evaluateReferenceHostEvidence(root, manifest)).evidence)
      .toContain('Satisfied: MCP01-handshake-and-capabilities');
  });

  test('[covers:F-c2d7dc78/AC-36842395] refuses a non-reference-host row that carries evidence instead of a resolving test reference', () => {
    // Only the reference-host row is decided by recorded evidence, and only that row
    // is read by `evaluateReferenceHostEvidence`. An evidence array on any other row
    // has no verifier behind it, so it may not buy that row out of its test reference.
    // MCP11 keeps its real evidence here, so the reference-host state stays satisfied
    // and the unresolved test reference is the only failing term.
    const repositoryLedger = loadValidationManifest(process.cwd());
    const shellEvidence = {
      host: 'codex',
      receipt_ref: 'docs/dogfood/mcp11-0.10.0/codex/receipt.yaml',
      trust_ref: 'docs/dogfood/mcp11-0.10.0/codex/issuers.yaml',
      attestation_ref: 'docs/dogfood/mcp11-0.10.0/codex/attestation.yaml',
      recorded_at: '2026-09-07T00:00:00.000Z',
    };
    const shelled = {
      ...repositoryLedger,
      mcp_scenarios: repositoryLedger.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP05-')
          ? {...scenario, evidence: [shellEvidence], test_ref: undefined}
          : scenario),
    };
    const check = checkMcpScenarioLedger(process.cwd(), shelled, evaluateReferenceHostEvidence(process.cwd(), shelled));
    expect(check.status).toBe('fail');
    expect(check.evidence).toContain('unresolved_test_ref=MCP05-prepare-apply-replay-and-rollback');
    expect(check.evidence).toContain('evidence_status_disagreement=none');
  });

  test('holds the reference-host scenario label to the recorded evidence in both directions', () => {
    const repositoryLedger = loadValidationManifest(process.cwd());
    // Each direction is isolated so the evidence invariant is the only failing term:
    // the promoted row keeps a resolving test reference, and the silent row is taken
    // out of the declared boundary, so neither can fail for a second reason.
    const carrier = repositoryLedger.mcp_scenarios
      .find((scenario) => scenario.id.startsWith('MCP01-'))?.test_ref;
    // Promoted label, no evidence behind it: the ledger names the row it refuses.
    const promotedWithoutEvidence = {
      ...repositoryLedger,
      mcp_scenarios: repositoryLedger.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP11-') ? {...scenario, evidence: [], test_ref: carrier} : scenario),
    };
    const promoted = checkMcpScenarioLedger(
      process.cwd(), promotedWithoutEvidence, evaluateReferenceHostEvidence(process.cwd(), promotedWithoutEvidence),
    );
    expect(promoted.status).toBe('fail');
    expect(promoted.evidence).toContain('evidence_status_disagreement=MCP11-reference-host-spec-02-cycle');

    // The other direction: confirmed evidence the label does not report.
    const silentAboutEvidence = {
      ...repositoryLedger,
      mcp_scenarios: repositoryLedger.mcp_scenarios.map((scenario) =>
        scenario.id.startsWith('MCP11-') ? {...scenario, implementation: 'pending' as const} : scenario),
      release_boundary: {
        release: repositoryLedger.release_boundary?.release ?? '0.10.0',
        blocking: (repositoryLedger.release_boundary?.blocking ?? []).filter((entry) => !entry.startsWith('MCP11-')),
      },
    };
    const silent = checkMcpScenarioLedger(
      process.cwd(), silentAboutEvidence, evaluateReferenceHostEvidence(process.cwd(), silentAboutEvidence),
    );
    expect(silent.status).toBe('fail');
    expect(silent.evidence).toContain('evidence_status_disagreement=MCP11-reference-host-spec-02-cycle');
  });

  test('[covers:F-c2d7dc78/AC-2c7b4afa] passes the reference-host checks only for receipts signed by a registered issuer in the recorded snapshot', () => {
    const root = temporaryRoot('clad-release-evidence-');
    const evidence = [recordHost(root, 'codex'), recordHost(root, 'claude-code')];
    const manifest = fixtureManifest(root, evidence, {journeyStatus: 'validation-active'});
    const result = evaluateReferenceHostEvidence(root, manifest);
    expect(result.outcomes.map((outcome) => outcome.satisfied)).toEqual([true, true]);
    expect(result.satisfied).toBe(true);
    const checks = referenceHostChecks(manifest, result);
    expect(checks.journey.status).toBe('pass');
    expect(checks.e2e.status).toBe('pass');
    expect(checks.e2e.evidence).toContain('signed by a registered issuer in the recorded snapshot');
    // The check never claims the foreign receipt is current.
    expect(`${checks.journey.evidence}${checks.e2e.evidence}`).not.toContain('current');
    expect(checkReleaseBoundary(root, manifest, result).status).toBe('pass');

    const unmet = (records: readonly RecordedHost[], ledgerRoot: string = root): string => {
      const ledger = fixtureManifest(ledgerRoot, records, {journeyStatus: 'not_run'});
      const evaluated = evaluateReferenceHostEvidence(ledgerRoot, ledger);
      expect(evaluated.satisfied).toBe(false);
      expect(referenceHostChecks(ledger, evaluated).e2e.status).toBe('not_run');
      expect(checkReleaseBoundary(ledgerRoot, ledger, evaluated).status).toBe('not_run');
      return evaluated.outcomes.map((outcome) => outcome.reason).join(' | ');
    };

    const forgedRoot = temporaryRoot('clad-release-forged-');
    expect(unmet([recordHost(forgedRoot, 'codex', {forge: true}), recordHost(forgedRoot, 'claude-code')], forgedRoot))
      .toContain('receipt signature is not usable: invalid_signature');

    const strangerRoot = temporaryRoot('clad-release-stranger-');
    expect(unmet([recordHost(strangerRoot, 'codex', {registerIssuer: false}), recordHost(strangerRoot, 'claude-code')], strangerRoot))
      .toContain('issuer is not registered in the recorded trust snapshot');

    const mismatchedRoot = temporaryRoot('clad-release-mismatch-');
    const mismatched = recordHost(mismatchedRoot, 'claude-code');
    expect(unmet([{...mismatched, host: 'codex'}, mismatched], mismatchedRoot))
      .toContain('not a host-owned copy under docs/dogfood/');

    const escapedRoot = temporaryRoot('clad-release-escaped-');
    const escaped = recordHost(escapedRoot, 'codex');
    writeFileSync(join(escapedRoot, 'receipt.yaml'), 'schema: 0\n');
    expect(unmet([{...escaped, receipt_ref: 'docs/dogfood/../receipt.yaml'}, recordHost(escapedRoot, 'claude-code')], escapedRoot))
      .toContain('not a host-owned copy under docs/dogfood/');

    const strayRoot = temporaryRoot('clad-release-stray-');
    const stray = recordHost(strayRoot, 'codex', {attestedFeature: 'F-99999999'});
    expect(unmet([stray, recordHost(strayRoot, 'claude-code')], strayRoot))
      .toContain('attestation copy does not carry the receipt subject feature F-aaaaaaaa');
  });

  test('[covers:F-c2d7dc78/AC-f50ef520] fails the journey ledger when the reference-host journey status disagrees with the recorded evidence', () => {
    const root = temporaryRoot('clad-release-journey-');
    const claimed = fixtureManifest(root, [], {journeyStatus: 'validation-active'});
    const claimedResult = evaluateReferenceHostEvidence(root, claimed);
    expect(checkJourneyLedger(root, claimed, claimedResult).status).toBe('fail');
    expect(checkJourneyLedger(root, claimed, claimedResult).evidence).toContain('evidence_status_disagreement=J13');

    const recorded = [recordHost(root, 'codex'), recordHost(root, 'claude-code')];
    const silent = fixtureManifest(root, recorded, {journeyStatus: 'not_run'});
    const silentResult = evaluateReferenceHostEvidence(root, silent);
    expect(silentResult.satisfied).toBe(true);
    expect(checkJourneyLedger(root, silent, silentResult).status).toBe('fail');

    const honest = fixtureManifest(root, recorded, {journeyStatus: 'validation-active'});
    expect(checkJourneyLedger(root, honest, evaluateReferenceHostEvidence(root, honest)).status).toBe('pass');

    // A journey that names `evidence_from` is discriminated by that scenario's
    // recorded evidence, not by a test reference of its own. Promoting J13 with
    // no test_ref is therefore legal — and still bound to the same evidence.
    const evidenceOnlyRoot = temporaryRoot('clad-release-evidence-only-');
    const bothHosts = [recordHost(evidenceOnlyRoot, 'codex'), recordHost(evidenceOnlyRoot, 'claude-code')];
    const exempt = fixtureManifest(evidenceOnlyRoot, bothHosts, {
      journeyStatus: 'validation-active',
      journeyTestRef: false,
    });
    expect(exempt.integration_journeys.find((journey) => journey.id === 'J13')?.test_ref).toBeUndefined();
    const exemptCheck = checkJourneyLedger(evidenceOnlyRoot, exempt, evaluateReferenceHostEvidence(evidenceOnlyRoot, exempt));
    expect(exemptCheck.status).toBe('pass');
    expect(exemptCheck.evidence).toContain('decided by recorded scenario evidence (J13)');

    // The exemption removes a witness requirement, it does not weaken the
    // invariant: one host short, the same test_ref-less promotion still fails,
    // and it fails on the evidence rule rather than on a missing reference.
    const halfRoot = temporaryRoot('clad-release-half-');
    const half = fixtureManifest(halfRoot, [recordHost(halfRoot, 'codex')], {
      journeyStatus: 'validation-active',
      journeyTestRef: false,
    });
    const halfCheck = checkJourneyLedger(halfRoot, half, evaluateReferenceHostEvidence(halfRoot, half));
    expect(halfCheck.status).toBe('fail');
    expect(halfCheck.evidence).toContain('evidence_status_disagreement=J13');
    expect(halfCheck.evidence).toContain('unresolved_test_ref=none');
  });

  test('[covers:F-c2d7dc78/AC-2c7b4afa] refuses two hosts that recorded one receipt as two independent cycles', () => {
    const root = temporaryRoot('clad-release-duplicate-');
    // One real cycle, filed twice. Copying the three files byte-for-byte into the
    // second host's directory is the only way to reach an identical digest:
    // `recordHost` mints a fresh key per call, so two calls can never collide.
    const codex = recordHost(root, 'codex');
    const mirrored = join(root, 'docs', 'dogfood', 'mcp11-0.10.0', 'claude-code');
    mkdirSync(mirrored, {recursive: true});
    for (const name of ['receipt.yaml', 'issuers.yaml', 'attestation.yaml']) {
      copyFileSync(join(root, 'docs', 'dogfood', 'mcp11-0.10.0', 'codex', name), join(mirrored, name));
    }
    const base = 'docs/dogfood/mcp11-0.10.0/claude-code';
    const duplicate = {
      host: 'claude-code',
      receipt_ref: `${base}/receipt.yaml`,
      trust_ref: `${base}/issuers.yaml`,
      attestation_ref: `${base}/attestation.yaml`,
      recorded_at: '2026-09-07T00:00:00.000Z',
    };
    const manifest = fixtureManifest(root, [codex, duplicate], {journeyStatus: 'not_run'});
    const result = evaluateReferenceHostEvidence(root, manifest);
    // Each copy is individually valid; two hosts filing one artifact is still one cycle.
    expect(result.satisfied).toBe(false);
    expect(result.outcomes.map((outcome) => outcome.satisfied)).toEqual([false, false]);
    expect(result.outcomes.map((outcome) => outcome.reason))
      .toEqual(['two hosts recorded the same receipt', 'two hosts recorded the same receipt']);
    expect(referenceHostChecks(manifest, result).e2e.status).toBe('not_run');
    expect(checkReleaseBoundary(root, manifest, result).status).toBe('not_run');
  });

  test('[covers:F-c2d7dc78/AC-2c7b4afa] confirms the committed reference-host cycles of this repository against their own recorded trust snapshots', async () => {
    const root = process.cwd();
    const manifest = loadValidationManifest(root);
    const result = evaluateReferenceHostEvidence(root, manifest);
    // Every declared host is satisfied by its own committed copies, and the two
    // receipts are distinct artifacts rather than one cycle filed twice.
    expect(result.outcomes.map((outcome) => outcome.host)).toEqual(['codex', 'claude-code']);
    expect(result.outcomes.map((outcome) => outcome.satisfied)).toEqual([true, true]);
    for (const outcome of result.outcomes) {
      expect(outcome.reason).toContain('signed by a registered issuer in the recorded snapshot');
    }
    expect(new Set(result.outcomes.map((outcome) => outcome.digest)).size).toBe(2);
    expect(result.satisfied).toBe(true);
    // The check still refuses to claim the foreign receipts are current.
    const checks = referenceHostChecks(manifest, result);
    expect(`${checks.journey.evidence}${checks.e2e.evidence}`).not.toContain('current');
    // And the release run over the same recorded evidence is satisfied end to end.
    const released = await runValidatorCli(['--release'], root);
    expect(released.exitCode).toBe(0);
    expect(released.report.checks.find((check) => check.id === 'release-boundary')?.status).toBe('pass');
  });

  test('[covers:F-c2d7dc78/AC-c5bbd322] refuses a boundary that pulls adoption, token, or host A/B rows inside it', () => {
    const root = temporaryRoot('clad-release-scope-');
    const evidence = [recordHost(root, 'codex'), recordHost(root, 'claude-code')];
    for (const intruder of ['MCP12-adoption-versus-delivery-telemetry', 'AB12', 'J13']) {
      const manifest = fixtureManifest(root, evidence, {
        journeyStatus: 'validation-active',
        blocking: ['MCP01-handshake-and-capabilities', 'MCP11-reference-host-spec-02-cycle', intruder],
      });
      const check = checkReleaseBoundary(root, manifest, evaluateReferenceHostEvidence(root, manifest));
      expect(check.status, intruder).toBe('fail');
      expect(check.evidence, intruder).toContain(intruder);
    }
    const repeated = fixtureManifest(root, evidence, {
      journeyStatus: 'validation-active',
      blocking: ['MCP01-handshake-and-capabilities', 'MCP01-handshake-and-capabilities', 'MCP11-reference-host-spec-02-cycle'],
    });
    expect(checkReleaseBoundary(root, repeated, evaluateReferenceHostEvidence(root, repeated)).status).toBe('fail');
  });
});
