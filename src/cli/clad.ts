// Cladding · `clad` CLI entry — composes the Iron Core verbs.
//
// Uses `commander` for parsing. Each verb's handler is exported as a
// named function so unit tests can exercise it without spawning a
// subprocess; the top-level `program.parse()` is guarded by
// `isCliEntry` so importing the module from a test does not trigger
// CLI behavior.

import process from 'node:process';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';

import {Command, Option} from 'commander';

import {classifyIntent} from '../router/intent.js';
import {runChangelogCommand} from './changelog.js';
import {collectChangelog, defaultSinceRef} from '../changelog/collect.js';
import {renderAuditTable, renderCatalog, renderChangelogMarkdown} from '../changelog/render.js';
import {buildBundleHtml, type BundleChanges} from '../report/bundle.js';
import {runReportCommand} from './report.js';
import {runDoctorCommand} from './doctor.js';
import {runDoctorHosts} from './doctor-hosts.js';
import {runDone} from './done.js';
import {featureCycleAdvisory} from './enforcement-advisory.js';
import {runHookCommand} from './hook.js';
import {runVerdictCommand} from './verdict.js';
import {runUpdate} from './update.js';
import {runInit, type InitResult} from './init.js';
import {refineOnboarding, resolveOnboardingReview, runClarifyCommand} from './clarify.js';
import {onboardingCompletionMessage} from '../ui/softShell.js';
import {prepareHostClarify, prepareHostInit, renderHostDraft} from './host-onboarding.js';
import {getCurrentCladdingVersion, runHostSetup} from '../init/host-setup.js';
import {recordEvent} from '../events/log.js';
import {blockingDetectorNames, gateStopFingerprint} from '../events/stop-telemetry.js';
import {buildContextSlice} from '../optimizer/context-slice.js';
import {graphIrView} from '../graph/query.js';
import {buildImpactSlice} from '../optimizer/reverse-slice.js';
import {inferDependsOn} from '../optimizer/infer-depends-on.js';
import {measureGraphEfficiency, MEASUREMENT_DISCLAIMER} from '../optimizer/measurement.js';
import {appendMeasureSnapshot} from '../optimizer/measure-ledger.js';
import {runSessionsMeasure, runTrendMeasure} from './measure.js';
import {runGraphExportCommand, runGraphStatsCommand} from './graph.js';
import {runGraphServeCommand} from './graph-serve.js';
import {runMigrateCommand} from './migrate.js';
import {runBeginCommand} from './begin.js';
import {runSignoffCommand} from './signoff.js';
import {runIngestReceiptCommand} from './ingest-receipt.js';
import {strictSkipViolations} from '../stages/skip-policy.js';
import {runArch} from '../stages/arch.js';
import {runAudit} from '../stages/audit.js';
import {clearDetectorResultCache, primeDetectorResultCache} from '../stages/detector-result-cache.js';
import {clearTestRunCache, currentGateProofEvidence, currentRunProofIdentity, primeTestRunCache, type CurrentRunProofEvidence} from '../stages/test-run-cache.js';
import {runCommit} from '../stages/commit.js';
import {runCov} from '../stages/cov.js';
import {runDrift} from '../stages/drift.js';
import {allDetectors} from '../stages/detectors/index.js';
import {runLint} from '../stages/lint.js';
import {runPerf} from '../stages/perf.js';
import {runSecret} from '../stages/secret.js';
import {runDeliverableSmoke} from '../stages/deliverable-smoke.js';
import {runSmoke} from '../stages/smoke.js';
import {runSpecConformance} from '../stages/spec-conformance.js';
import {runType} from '../stages/type.js';
import {runUat} from '../stages/uat.js';
import {runUnit} from '../stages/unit.js';
import {runVisual} from '../stages/visual.js';
import type {DriftFinding, Disposition} from '../stages/types.js';
import {gateStatusOf, isBlocking, worstContribution, type GateStatus} from '../stages/disposition.js';
import {staleSpecification} from '../stages/detectors/stale-specification.js';
import {findLatestCheckpoint, readGitHead, recordCheckpoint, recordRollback} from '../core/checkpoint.js';
import {gitOperationInProgress, gitOperationInProgressName} from '../core/git-ops.js';
import {maintainDeliverable} from '../spec/deliverable-detect.js';
import {
  beginPreparedSchema02DoneGate,
  consumePreparedSchema02DoneWriter,
  preparedSchema02DoneGate,
  refreshDerivedSpecProjections,
  type DoneGateMark,
  type GeneratedAttestationCompletion,
  type PreparedSchema02DoneEvent,
  type PreparedSchema02DoneWriter,
} from '../spec/edit.js';
import {requiredRootSchema} from '../spec/transaction.js';
import {writeSpecDrivenAgentsMd} from '../init/agents-md.js';
import {repairTestRefs} from '../spec/test-ref-repair.js';
import {captureAttestationInputSnapshot, detectorCatalogSha256, featureAttestationV3, readAttestation, writeAttestation} from '../spec/attestation.js';
import {compileSpecWorkspace, compileSpecWorkspaceWithLockHeld} from '../spec/compiler/compile.js';
import type {SpecCompilation} from '../spec/compiler/types.js';
import {
  prospectiveDoneCompilation,
  prospectiveDoneSpec,
  withProspectiveCompilationOverlay,
  withProspectiveSpecOverlay,
} from '../spec/prospective.js';
import {reduceLegacyStageAdapter} from '../assurance/adapters.js';
import {createAttestationV3RetentionContext} from '../assurance/attestation.js';
import {canonicalClosureJson} from '../assurance/closures.js';
import {mintRunCheckStagesAuthority} from '../assurance/run-authority.js';
import {assuranceClosureInputFromWorkspace, createWorkspaceAttestations, currentProofViewsFromWorkspace, effectiveFeatureScope, featureClosureSeals, hasApplicableSchema02TestCriteria, workspaceClosureSeals, workspaceProfileSnapshot, type BoundCriteriaCollector, type WorkspaceProfileSnapshot} from '../assurance/workspace.js';
import {liveCriterionReportsFromCurrentRun, staticCriterionReportsFromWorkspace, staticCriterionScopeFromWorkspace} from '../assurance/criterion-observations.js';
import {emptyTrustSnapshot} from '../proof/receipt.js';
import {assuranceProfile, invalidateAssuranceVerdict, resolveRequestedAssuranceLevel, type AssuranceProfile, type AssuranceVerdict} from '../assurance/kernel.js';
import {normalizeProfile, OBLIGATION_DESCRIPTORS, profileBlocksWarnClass, type AssuranceLevel, type AssuranceProfileId} from '../assurance/registry.js';
import {buildBlindPayload, renderBlindBrief} from '../oracle/payload.js';
import {requiredOracleWorklist} from '../oracle/policy.js';
import {loadSpec, loadSpecFromDiskUnlocked} from '../spec/load.js';
import {readEvidence} from '../hitl/audit.js';
import {pulse, type PulseKind} from '../ui/pulse.js';
import {buildPanelModel, renderPanel} from '../ui/panel.js';
import {featureLabel, gateLabel, haltMessage, plainLead} from '../ui/softShell.js';

/** Handler for `clad serve`. Boots the MCP server over stdio. */
export async function runServeCommand(opts: {cwd?: string}): Promise<void> {
  // Dynamic import: the MCP SDK is sizeable and most `clad` invocations
  // never reach `serve`. Loading it on-demand keeps cold-start fast.
  const [{buildServer}, {StdioServerTransport}, {setHostMcpServer}] = await Promise.all([
    import('../serve/server.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('../adapters/host/sampling-context.js'),
  ]);
  const server = buildServer({
    cwd: opts.cwd,
    onboarding: {
      renderDraft: (draft) => renderHostDraft(draft as Parameters<typeof renderHostDraft>[0]),
      prepareInit: ({cwd, mode, intent}) => prepareHostInit(cwd, mode, intent),
      initialize: runInit,
      prepareClarify: (answer, {cwd}) => prepareHostClarify(cwd, answer),
      clarify: refineOnboarding,
      resolveReview: (targets, {cwd}) => resolveOnboardingReview(targets, {cwd}),
    },
  });
  // v0.2.26 (F-075): register the server in the sampling context so
  // the host adapters (`generic-mcp`, `claude-code`) automatically
  // route LLM dispatch through McpSamplingTransport instead of the
  // Mock fallback. The registration is process-scoped; clearing it
  // is not necessary because the cladding process exits when stdio
  // closes.
  setHostMcpServer(server.server);
  const transport = new StdioServerTransport();
  // stdout is reserved for MCP protocol traffic on stdio transport, so
  // status lines go to stderr via pulse (which writes to stderr by
  // default; verified below if pulse changes).
  // stdout IS the MCP wire — strict line-delimited JSON clients choke on a
  // banner there (battery C8 note). The banner goes to stderr, bypassing pulse.
  process.stderr.write(`· serve  stdio transport · cwd=${opts.cwd ?? '.'}\n`);
  await server.connect(transport);
  // The server runs until the client closes stdio; connect() does not
  // resolve until then on stdio transport, so we await it as-is. If a
  // host wraps cladding without proper close semantics, Ctrl-C in the
  // host process terminates this child.
}

/**
 * Handler for `clad init`. Scaffolds a workspace at cwd, then exits 0.
 *
 * `--scan` walks the existing codebase and writes `docs/conventions.md`
 * + `spec/architecture.yaml` + per-layer scenario stubs so external
 * projects adopting cladding inherit a maintenance brief — see
 * ironclad-design/07-ssot-init.md §3 B. `--no-llm` forces the
 * deterministic interpreter (v0.3.24 default until v0.3.25 wires the
 * MCP sampling dispatcher).
 */
export async function runInitCommand(
  intentTokens: readonly string[] | undefined,
  opts: {
    name?: string;
    force?: boolean;
    scan?: boolean;
    noLlm?: boolean;
    roots?: string;
    withHook?: boolean;
    withCi?: boolean;
    json?: boolean;
  },
): Promise<void> {
  const intent = intentTokens && intentTokens.length > 0 ? intentTokens.join(' ').trim() : undefined;
  const result = await runInit({
    projectName: opts.name,
    force: opts.force,
    scan: opts.scan,
    noLlm: opts.noLlm,
    roots: opts.roots ? opts.roots.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    intent,
    withHook: opts.withHook,
    withCi: opts.withCi,
  });
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(0);
    return;
  }
  for (const c of result.created) pulse('pass', `created ${c}`);
  for (const s of result.skipped) pulse('skip', s);
  for (const p of result.proposals ?? []) pulse('note', 'proposal', p);
  const modeDetail = result.onboardingMode ? `language: ${result.language} · mode: ${result.onboardingMode}` : `language: ${result.language}`;
  pulse('note', 'init done', modeDetail);

  const completionHints = renderInitCompletionHints(result, intent);
  if (completionHints) process.stdout.write(completionHints);

  process.exit(0);
}

/**
 * Renders the system-authored completion guidance for `clad init`.
 * User/model-authored questions pass through verbatim so the host can keep
 * the user's language; only Cladding's framing is English single-source.
 *
 * @param result Completed init result that may carry follow-up questions.
 * @param intent Original user intent, if supplied to `clad init`.
 * @returns A complete stdout fragment, or an empty string when no hint applies.
 * @see spec/features/init-onboarding-english-source-5cac007a.yaml AC-f12ce851
 */
export function renderInitCompletionHints(
  result: Pick<InitResult, 'created' | 'clarifyingQuestions'>,
  intent: string | undefined,
): string {
  const questions = result.clarifyingQuestions ?? [];
  if (questions.length > 0) {
    return [
      '',
      '💡 A few more details would sharpen the spec:',
      ...questions.map((question, index) => `   ${index + 1}. ${question}`),
      '',
      '',
    ].join('\n');
  }

  // Greenfield + no intent + direct CLI user — emit a gentle hint suggesting
  // the intent-driven path. The orchestrator normally asks for intent before
  // invoking `clad init`, so this primarily supports direct CLI users.
  const greenfield = result.created.some((created) => created === 'docs/conventions.md');
  if (!intent && greenfield) {
    return [
      '',
      '💡 Tip: for a more precise scaffold, describe the project:',
      '   clad init <project description>',
      '   e.g. clad init payment SaaS for B2B',
      '   The existing seeds divert to .cladding/scan/*.proposal.',
      '',
      '',
    ].join('\n');
  }
  if (intent) {
    return [
      '',
      onboardingCompletionMessage(),
      '',
      '',
    ].join('\n');
  }
  return '';
}

interface RunCommandOptions {
  cwd?: string;
  maxIterations: string;
  maxWallClockMs: string;
  maxRetries: string;
  json?: boolean;
}

/** Handler for `clad run [goal]` (formerly `drive`). Runs the autonomous loop. */
export async function runRunCommand(
  goal: string | undefined,
  opts: RunCommandOptions,
): Promise<void> {
  // `clad run` is EXPERIMENTAL. The headless code-author transport is unbuilt
  // and nothing auto-invokes it — the supported, exercised path is host-delegated
  // (run `clad serve` and let your AI host loop the per-feature cadence). The loop
  // halts honestly rather than certifying empty stubs when no real LLM is reachable.
  pulse('note', 'run', 'EXPERIMENTAL — prefer the host-delegated path (clad serve + your AI host). See docs/feature-cycle.md § Execution surface.');
  const {runDriveLoop} = await import('../drive/loop.js');
  const result = await runDriveLoop({
    cwd: opts.cwd,
    goal,
    budget: {
      maxIterations: Number(opts.maxIterations),
      maxWallClockMs: Number(opts.maxWallClockMs),
      maxRetriesPerFeature: Number(opts.maxRetries),
    },
  });
  const tag = result.halt.class === 'ALL_FEATURES_DONE' ? 'pass' : 'note';
  if (opts.json) {
    pulse(
      tag,
      'run',
      `halt=${result.halt.class} iter=${result.iterations} features=${result.featuresTouched.length} stubs=${result.stubsCreated.length} gates=${result.gateRuns}`,
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const spec = loadSpec(opts.cwd ?? '.');
    const touched = result.featuresTouched.map((id) => featureLabel(id, spec));
    const summary = `${haltMessage(result.halt, spec)} iter=${result.iterations} features=${touched.length} stubs=${result.stubsCreated.length} gates=${result.gateRuns}`;
    pulse(tag, 'run', summary);
    if (touched.length > 0) {
      process.stdout.write(`Touched: ${touched.join(', ')}\n`);
    }
  }
  // Honest exit code (anti-Vacuous-Green for the headless loop). A run that
  // produced empty auto-stubs (no real implementation — the code-author transport
  // is mock/unbuilt) is NOT a success even when the loop "cleared" features on the
  // L1 floor: it implemented nothing. Surface that and exit non-zero, so a user or
  // CI never reads a stub-only `clad run` as done. Likewise any non-completion
  // halt exits non-zero. Only a real, fully-cleared run is 0.
  const vacuous = result.stubsCreated.length > 0;
  if (vacuous) {
    pulse(
      'fail',
      'run',
      `produced ${result.stubsCreated.length} empty auto-stub(s) and implemented nothing — the headless code-author needs a real LLM transport (set ANTHROPIC_API_KEY) or use the host-delegated path (clad serve + your AI host). This run did NOT do the work.`,
    );
  }
  process.exit(result.halt.class === 'ALL_FEATURES_DONE' && !vacuous ? 0 : 1);
}

/**
 * Handler for `clad sync`. Validates the spec and reports feature
 * count. With `--propose-archive`, runs the STALE_SPECIFICATION
 * detector and prints the subset of findings whose
 * `suggestion.action === 'propose-archive'` — the Phased
 * Decommissioning Tier 2 entry point (ironclad-design 07-ssot-init §5).
 *
 * Output format matches the Pulse UI conventions — one note per
 * candidate, then a summary. Exit 0 either way; the maintainer
 * decides whether to update the spec.
 */
export function runSyncCommand(opts: {proposeArchive?: boolean} = {}): void {
  try {
    const spec = loadSpec();
    // v0.3.56 (F-5b9f9f) — auto-rewrite the `inventory:` block in
    // spec.yaml on every sync so AI agents can grep 1 file to see
    // the project's whole scale. Counts only — an unchanged-count
    // re-sync is byte-identical, so parallel branches don't conflict.
    if (gitOperationInProgress('.')) {
      pulse('note', 'sync', 'derived-file writes deferred — git operation in progress; re-run after the merge/rebase completes.');
    } else {
      refreshDerivedSpecProjections('.'); // inventory/index/doc-links share one journaled snapshot
      // F-a4085adf (#199) — refresh the spec-driven AGENTS.md managed block so
      // cross-host agents (Codex/Gemini/Cursor/…) read the same spec-sourced
      // guidance Claude gets. Marker-upsert: regenerates only the delimited
      // block, preserves user prose, byte-stable on unchanged spec, and leaves a
      // markerless (hand-authored) AGENTS.md untouched — so cladding's own root
      // /AGENTS.md is never rewritten.
      const agentsMd = writeSpecDrivenAgentsMd('.');
      if (agentsMd === 'created') {
        pulse('note', 'agents.md', 'wrote a spec-driven AGENTS.md so non-Claude agents share the same guidance.');
      } else if (agentsMd === 'updated') {
        pulse('note', 'agents.md', 'refreshed the AGENTS.md managed block from the current spec.');
      }
      // F-c037ae — heal annotation drift before it rejects correct features:
      // unique-basename repair of moved test_ref paths + derived: suggestions
      // (which never satisfy a mandate — see MISSING_TESTS/UNTESTED_AC).
      const refFixes = repairTestRefs('.');
      for (const r of refFixes.repaired) pulse('note', 'test_refs', `repaired ${r.from} → ${r.to} (${r.shard})`);
      for (const sug of refFixes.suggested) pulse('note', 'test_refs', `suggested ${sug.ref} (${sug.shard}) — confirm by removing the 'derived:' prefix`);
      // v0.5.x — auto-populate project.deliverable when absent + a CLI entry is calibratable, so
      // DELIVERABLE_SMOKE (stage_2.4) engages without the agent having to declare it correctly (the
      // re-run showed a conservative agent declares it DISABLED). Calibrates against the passing state,
      // so it never enables a false-failing invocation. One-time (skips once a deliverable is present).
      const autoDeliverable = maintainDeliverable('.');
      if (autoDeliverable) {
        pulse(
          'note',
          'deliverable',
          `auto-detected entry '${autoDeliverable.path}' — the gate now smoke-tests it. Opt out with is_safe_to_smoke: false.`,
        );
      }
    }
    if (opts.proposeArchive) {
      const findings = staleSpecification.run({cwd: '.'});
      const proposals = findings.filter(
        (f) => f.suggestion?.action === 'propose-archive',
      );
      if (proposals.length === 0) {
        pulse('pass', 'sync', `${spec.features.length} features · 0 archive candidates`);
        process.exit(0);
        return;
      }
      for (const p of proposals) {
        const args = p.suggestion?.args ?? {};
        const featureId = String(args.featureId ?? '?');
        const reason = String(args.reason ?? p.message);
        pulse('note', `propose-archive · ${featureId}`, reason);
      }
      pulse(
        'pass',
        'sync',
        `${spec.features.length} features · ${proposals.length} archive candidate(s)`,
      );
      process.exit(0);
      return;
    }
    pulse('pass', 'sync', `${spec.features.length} features valid`);
    process.exit(0);
  } catch (err) {
    pulse('fail', 'sync', (err as Error).message);
    process.exit(1);
  }
}

/**
 * Handler for `clad checkpoint <featureId>`. Phase 1 of the
 * Iron Law backbone — records a `feature_checkpoint` event capturing
 * git HEAD + spec digest. No working-tree mutation. The maintainer
 * keeps the option to actually freeze the state with a normal git
 * commit; cladding only stamps the audit-log entry.
 *
 * @see iron-law.md §2.5
 */
export function runCheckpointCommand(featureId: string): void {
  if (!featureId) {
    pulse('fail', 'checkpoint', 'feature id required (e.g. clad checkpoint F-001)');
    process.exit(2);
    return;
  }
  const cp = recordCheckpoint('.', featureId);
  const head = cp.gitHead ? cp.gitHead.slice(0, 12) : '(no git)';
  pulse('pass', `checkpoint · ${featureId}`, `head=${head} digest=${cp.specDigest.slice(0, 12)}`);
  process.exit(0);
}

/**
 * Handler for `clad rollback <featureId>`. Phase 1 records the
 * `feature_rolled_back` transition and prints the maintainer-runnable
 * git command for the latest checkpoint. Cladding does **not** run the
 * checkout itself — the host's branch policy and dirty-working-tree
 * state may demand a non-default strategy, so the decision stays with
 * the maintainer. A later phase may take this over for the drive loop.
 */
export function runRollbackCommand(featureId: string, opts: {reason?: string} = {}): void {
  if (!featureId) {
    pulse('fail', 'rollback', 'feature id required (e.g. clad rollback F-001)');
    process.exit(2);
    return;
  }
  const cp = findLatestCheckpoint('.', featureId);
  if (!cp) {
    pulse('fail', `rollback · ${featureId}`, 'no prior checkpoint recorded');
    process.exit(1);
    return;
  }
  recordRollback('.', featureId, cp, opts.reason);
  const head = cp.gitHead ? cp.gitHead.slice(0, 12) : '(no git)';
  pulse('note', `rollback · ${featureId}`, `recorded — run the printed command to apply (cladding does not execute git) · target head=${head} ts=${cp.timestamp}`);
  if (cp.gitHead) {
    process.stdout.write(`Run: git checkout ${cp.gitHead}\n`);
  } else {
    process.stdout.write('No git head pinned — restore spec.yaml manually from VCS history.\n');
  }
  process.exit(0);
}

/** Handler for `clad setup`. Activates Cladding only for one project. */
export async function runSetupCommand(opts: {force?: boolean; quiet?: boolean; project?: string; host?: string}): Promise<void> {
  // No --host → detected hosts only (spec AC-001); --host all → every channel.
  const hosts = !opts.host
    ? undefined
    : opts.host === 'all'
      ? (['claude', 'codex', 'gemini', 'antigravity', 'cursor'] as const).slice()
      : [opts.host as 'claude' | 'codex' | 'gemini' | 'antigravity' | 'cursor'];
  const result = await runHostSetup({
    force: opts.force,
    quiet: opts.quiet,
    projectRoot: opts.project,
    hosts,
  });
  process.exit(result.errors.length > 0 ? 1 : 0);
}

/**
 * Handler for `clad update`. The one-command "after you upgraded the engine"
 * step, run from INSIDE the project you want to reconcile: refresh its host
 * wiring + reconcile the spec inventory + refresh the managed CLAUDE.md/AGENTS.md section
 * (all safe + idempotent — see cli/update.ts), THEN run the now-stricter
 * detectors in REPORT mode. The drift report never blocks and never edits the
 * user's spec — it only surfaces the bar the upgrade raised, so `clad update`
 * can't quietly hide that the engine got stricter. It reconciles only the
 * CURRENT directory (no `--cwd`): the inventory/section refresh and the drift
 * report must all see the same tree, so the honest contract is "cd in, then
 * run". The engine itself is NOT self-updated here: `npm update -g cladding` is
 * the user's step.
 */
export async function runUpdateCommand(): Promise<void> {
  pulse('note', 'update', 'reconciling the current project after the engine upgrade');
  const r = await runUpdate('.', {
    wireHosts: async () => (await runHostSetup({quiet: true, projectRoot: '.'})).errors.length,
  });
  if (!r.isProject) {
    pulse('skip', 'update', 'no spec.yaml here — nothing re-wired. Run `clad update` inside a cladding project, or `clad init` to start one.');
    process.exit(r.code);
    return;
  }
  pulse(r.wiringErrors > 0 ? 'fail' : 'pass', 'hosts', r.wiringErrors > 0 ? `${r.wiringErrors} wiring error(s)` : 're-wired');
  if (r.inventoryDeferred) {
    pulse('note', 'spec', `inventory + index writes deferred — git operation in progress; re-run \`clad update\` after it completes (${r.features} features seen).`);
  } else {
    pulse('pass', 'spec', `inventory synced · ${r.features} features`);
  }
  pulse(r.claudeMd === 'refreshed-stale' ? 'note' : 'pass', 'CLAUDE.md', r.claudeMd);
  pulse(r.agentsMd === 'refreshed-stale' ? 'note' : 'pass', 'AGENTS.md', r.agentsMd);
  for (const d of r.deprecations) pulse('note', 'deprecated', d);
  // Surface what the now-stricter detectors flag — REPORT only, never blocks.
  process.stdout.write('\n→ drift check (report-only · does not block, does not edit your spec):\n');
  const drift = runCheckStages({tier: 'pre-commit', strict: true});
  if (drift.anyFailed) {
    process.stdout.write(
      '\nℹ The findings above are the bar this upgrade raised — not a failed update.' +
      ' Reconcile them in YOUR spec when ready (`clad check --strict` for the full gate).\n',
    );
  } else {
    pulse('pass', 'drift', 'clean against the stricter detectors');
  }
  process.exit(r.code);
}

/**
 * Stages run by each `clad check --tier` (Phase 2 ambient hooks). Each trigger
 * runs the subset that is fast + meaningful in its context:
 *   pre-commit — drift/arch/secret: cheap, spec-native, deterministic, no
 *                whole-toolchain spawn → instant per-commit feedback.
 *   pre-push   — + type/lint/unit/cov: deterministic but heavier; run before
 *                push, not on every commit (avoids `--no-verify` fatigue).
 *   all        — every stage (default; backward-compatible; CI uses this).
 * Excluded from local hooks: commit(1.4) needs a clean tree (would always fail
 * pre-commit); smoke/perf/visual(3.x) are probabilistic; audit/uat(4.x) need
 * human evidence — these run in CI (`clad check`, i.e. tier=all).
 * Exported for testing.
 */
export const TIER_STAGES: Record<string, readonly string[]> = {
  'pre-commit': ['stage_1.3', 'stage_1.5', 'stage_1.6'],
  'pre-push': ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4'],
  all: ['stage_1.1', 'stage_1.2', 'stage_1.3', 'stage_1.4', 'stage_1.5', 'stage_1.6', 'stage_2.1', 'stage_2.2', 'stage_2.3', 'stage_2.4', 'stage_3.1', 'stage_3.2', 'stage_3.3', 'stage_4.1', 'stage_4.2'],
};

/** Per-stage record collected during a gate run. Exported so the verdict
 *  reducer (src/verdict/verdict.ts) can read the disposition + findings of each
 *  stage WITHOUT re-running or re-implementing the pipeline. `status` is the
 *  honest disposition (see stages/disposition.ts), NOT just the exit code. */
export interface StageOutcome {
  /** Ironclad stage id, e.g. `stage_2.1`. */
  readonly stage: string;
  /** User-facing label (or the raw id under `internal`). */
  readonly label: string;
  /** Honest gate disposition (pass/skip/fail/pending_env/advisory/na/liveness). */
  readonly status: GateStatus;
  /** Underlying exit code (1 for a disposition-blocking stage; 2 = skip lane). */
  readonly exitCode: number;
  /** Captured stderr; populated on failure. */
  readonly stderr?: string;
  /** Structured drift findings (only the drift stage carries these). */
  readonly findings?: readonly DriftFinding[];
  /**
   * WHY a skipped stage skipped (F-c17e1edc), carried through from the stage
   * result: `no-runner` = cladding knows no command for this project (curable
   * by declaring `gate.commands`), `tool-missing` = the command is known but
   * absent here. By-design skips (no oracle, no deliverable) carry nothing.
   */
  readonly skipReason?: 'no-runner' | 'tool-missing';
}

/** Outcome of running a tier's stages — exported so `clad done` can gate on
 *  the identical code path `clad check` uses (not a weaker re-implementation). */
export interface CheckOutcome {
  /** Worst exit code across the run stages (0 = all green/skip). */
  readonly worst: number;
  /** True when at least one stage RAN and failed (exitCode 1). */
  readonly anyFailed: boolean;
  /**
   * Per-stage records for this run. Present when the caller wants the full
   * disposition breakdown (verdict reducer); existing callers (`clad check`,
   * `clad done`) ignore it. Absent on the early unknown-tier bail-out.
   */
  readonly stages?: readonly StageOutcome[];
  /** Canonical F6 projection, additive to the legacy stage JSON. */
  readonly assurance?: AssuranceVerdict;
  /** Machine-readable refusal made before any stage or attestation writer runs. */
  readonly error?: string;
  /** Deferred only for schema-0.2 `done`, then committed under its F4 target lock. */
  readonly commitAttestation?: (completion: GeneratedAttestationCompletion) => void;
}

/**
 * Renders the one trailing line a runner-less project needs (F-c17e1edc).
 *
 * WHY: on a project whose language cladding cannot drive, the command stages
 * skip silently and the exit is invisible — `gate.commands` appears nowhere an
 * adopter reaches (gate output, doctor, READMEs), so a fully-capable agent
 * still could not find it. The remedy is inline (key path + example) because
 * `docs/` does not ship in the npm package. The language name is deliberately
 * absent: it reads `'unknown'` in exactly the case this fires.
 *
 * @param labels - Labels of the stages that skipped for lack of a runner, in run order.
 * @returns The guidance line, or `''` when nothing skipped that way (print nothing).
 */
export function renderNoRunnerGuidance(labels: readonly string[]): string {
  if (labels.length === 0) return '';
  return (
    `${labels.join(', ')} skipped — no runner is known for this project. ` +
    'Declare commands in .cladding/config.yaml (gate: → commands: → e.g. test: ["zig","test"]) ' +
    'to run them; the file is committable, so CI runs the same gate you do.'
  );
}

/**
 * Compatibility-only root dispatch used when a compiler error prevents a full
 * schema projection. It can grant raw module focus only to an explicit 0.1
 * root; every other unreadable/unknown/0.2 root fails closed to repository
 * execution. The compiler remains the sole schema-0.2 scope authority.
 */
function rootSelectsSchema01(cwd: string): boolean {
  try {
    return requiredRootSchema(cwd) === '0.1';
  } catch {
    return false;
  }
}

/**
 * Runs a tier's Iron Law stages in-process and reports the worst exit code.
 * Shared by `clad check` (which wraps it with `process.exit`) and `clad done`
 * (which gates the status flip on it), so the two verify against the SAME stage
 * pipeline.
 */
export interface CheckStageOptions {
  internal?: boolean;
  strict?: boolean;
  tier?: string;
  profile?: string;
  assuranceLevel?: AssuranceLevel;
  json?: boolean;
  silent?: boolean;
  focusModules?: readonly string[];
  scopeSubjects?: readonly string[];
  /** `clad done` prepares but does not stamp until lifecycle finalization. */
  deferAttestation?: boolean;
  /** Completion-only in-memory target; never written before the final F4 commit. */
  prospectiveFeatureId?: string;
  /** Exact non-serializable schema-0.2 completion capability from `clad done`. */
  completionGate?: DoneGateMark;
  /** Exact non-serializable success-event binding from the same `clad done` run. */
  completionEvent?: PreparedSchema02DoneEvent;
}

/** Runs stages, refusing public completion transport flags without a prepared capability. */
export function runCheckStages(opts: CheckStageOptions): CheckOutcome {
  const requestsCompletion = opts.deferAttestation === true
    || opts.prospectiveFeatureId !== undefined
    || opts.completionGate !== undefined
    || opts.completionEvent !== undefined;
  if (!requestsCompletion) return runCheckStagesCore(opts);
  if (opts.deferAttestation !== true || opts.prospectiveFeatureId === undefined
    || opts.completionGate === undefined || opts.completionEvent === undefined) {
    return refuseUnpreparedCompletion(opts);
  }
  let capability: ReturnType<typeof preparedSchema02DoneGate>;
  let writer: PreparedSchema02DoneWriter;
  let spec: ReturnType<typeof loadSpec>;
  let compilation: ReturnType<typeof compileSpecWorkspace>;
  try {
    capability = preparedSchema02DoneGate('.', opts.completionGate);
    if (capability.featureId !== opts.prospectiveFeatureId
      || opts.profile !== 'completion'
      || opts.scopeSubjects?.length !== 1
      || opts.scopeSubjects[0] !== `feature:${capability.featureId}`) {
      return refuseUnpreparedCompletion(opts);
    }
    writer = beginPreparedSchema02DoneGate('.', opts.completionGate, opts.completionEvent).writer;
    // The public runner owns the completion view from planning through every
    // stage and mint. A late writer overlay cannot repair a detector that was
    // allowed to observe an in-progress target.
    spec = prospectiveDoneSpec(loadSpec('.'), capability.featureId);
    compilation = prospectiveDoneCompilation(compileSpecWorkspace('.'), capability.featureId);
  } catch {
    return refuseUnpreparedCompletion(opts);
  }
  return withProspectiveSpecOverlay('.', spec, () =>
    withProspectiveCompilationOverlay('.', compilation, () => runCheckStagesCore(opts, writer)));
}

/** Internal runner entered only after the public completion boundary is sealed. */
function runCheckStagesCore(opts: CheckStageOptions, completionWriter?: PreparedSchema02DoneWriter): CheckOutcome {
  const selectedProfile = normalizeProfile(opts.profile ?? opts.tier ?? 'all');
  const tier = opts.tier ?? (opts.profile === 'feedback' || opts.profile === 'checkpoint' ? 'pre-commit' : opts.profile === 'release' ? 'all' : 'pre-push');
  // `silent` (the verdict poll) suppresses ALL user-facing IO — no pulse, no
  // --json stdout write, no attestation stamp — but still computes the honest
  // worst/anyFailed/stages and records the gate_run telemetry. A poll observes;
  // it never speaks or mutates.
  const silent = opts.silent === true;
  if ((opts.profile !== undefined && selectedProfile === undefined)
    || (opts.assuranceLevel !== undefined && !['L1', 'L2', 'L3', 'L4'].includes(opts.assuranceLevel))) {
    const error = opts.profile !== undefined && selectedProfile === undefined
      ? 'unknown assurance profile'
      : 'unknown assurance level';
    if (opts.json && !silent) process.stdout.write(`${JSON.stringify({tier, error, worst: 2, anyFailed: true, stages: []}, null, 2)}\n`);
    else if (!silent) pulse('fail', 'check', error);
    return {worst: 2, anyFailed: true, stages: []};
  }
  let allowed = TIER_STAGES[tier];
  if (!allowed) {
    if (opts.json && !silent) {
      process.stdout.write(`${JSON.stringify({tier, error: `unknown tier '${tier}'`, worst: 2, anyFailed: true, stages: []}, null, 2)}\n`);
    } else if (!silent) {
      pulse('fail', 'check', `unknown --tier '${tier}' (expected: pre-commit | pre-push | all)`);
    }
    return {worst: 2, anyFailed: true, stages: []};
  }
  // Release is a repository assertion, never a convenient spelling for a
  // feature gate. Keep this at the exported runner boundary so MCP/internal
  // callers cannot execute a subset then mint a repository-shaped result.
  if (selectedProfile === 'release'
    && ((opts.scopeSubjects?.length ?? 0) > 0 || (opts.focusModules?.length ?? 0) > 0)) {
    const error = 'release profile is repository-wide and cannot be narrowed by feature or module';
    if (opts.json && !silent) process.stdout.write(`${JSON.stringify({tier, error, worst: 1, anyFailed: true, stages: []}, null, 2)}\n`);
    else if (!silent) pulse('fail', 'check', 'Release checks always run across the whole repository. Remove the feature or module filter.');
    return {worst: 1, anyFailed: true, stages: [], error};
  }
  // Schema 0.2 profiles own the execution set.  The legacy aliases retain
  // their historical 0.1 subsets, while a canonical profile never quietly
  // defaults to `all` merely because no tier was supplied.
  let profileCompilation: ReturnType<typeof compileSpecWorkspace> | undefined;
  if (selectedProfile) {
    try {
      profileCompilation = compileSpecWorkspace('.');
      if (profileCompilation.schemaVersion === '0.2') {
        const configured = profileCompilation.contract?.project.assuranceLevel ?? 'L2';
        const resolved = resolveRequestedAssuranceLevel({
          configured,
          requested: opts.assuranceLevel,
          boundedScope: opts.scopeSubjects !== undefined && opts.scopeSubjects.length > 0,
        });
        if (resolved.ok) {
          const profileLevel = selectedProfile === 'feedback' || selectedProfile === 'checkpoint' ? 'L1' : resolved.level;
          allowed = assuranceProfile(selectedProfile, profileLevel).obligations;
        }
      }
    } catch {
      profileCompilation = undefined;
    }
  }
  // Resolve the schema-0.2 scope before stages are constructed. A raw module
  // list is only a schema-0.1 transport compatibility input; F6 stages must
  // receive the compiler-proven closure that the reducer and v3 writer use.
  let gateAssurancePlan: Schema02AssurancePlan | undefined;
  if (selectedProfile && profileCompilation?.schemaVersion === '0.2') {
    try {
      gateAssurancePlan = schema02AssurancePlan(profileCompilation, selectedProfile, opts.assuranceLevel, opts.scopeSubjects);
    } catch {
      // A schema-0.2 planning failure must not retain a caller-provided module
      // filter. Reduction later records the authoritative fault as blocking.
      gateAssurancePlan = undefined;
    }
  }
  // Focus-feature module scope (Gradle monorepos): forwarded to every command
  // stage and to the drift suite so the coverage detector reads per-module
  // reports. Schema 0.2 derives this from the same resolved plan used below;
  // empty/absent means whole-repository execution.
  const base: {focusModules?: readonly string[]} = profileCompilation?.schemaVersion === '0.2'
    ? (gateAssurancePlan?.focusModules ? {focusModules: gateAssurancePlan.focusModules} : {})
    : (profileCompilation?.schemaVersion === '0.1' || rootSelectsSchema01('.')) ? {focusModules: opts.focusModules} : {};
  // D21 — authority comes from the DECLARED PROFILE, not the strict flag. A
  // schema 0.2 completion/push/release run asserts its scope is fit to claim,
  // so a warn-class drift finding blocks it with no transport escalation;
  // `--strict` stays the explicit escalation that schema 0.1's legacy tiers
  // (and the advisory feedback/checkpoint profiles) still rely on. Schema 0.1
  // is byte-identical: `profileCompilation.schemaVersion` gates the whole
  // predicate, so a legacy tier keeps its warn-tolerant non-strict run.
  const profileOwnedWarnBlocking = profileCompilation?.schemaVersion === '0.2'
    && selectedProfile !== undefined
    && profileBlocksWarnClass(selectedProfile);
  const allStages = [
    ['stage_1.1', () => runType(base)],
    ['stage_1.2', () => runLint(base)],
    ['stage_1.3', () => runDrift({...base, strict: opts.strict || profileOwnedWarnBlocking})],
    ['stage_1.4', runCommit],
    ['stage_1.5', runArch],
    ['stage_1.6', runSecret],
    ['stage_2.1', () => runUnit({...base, strict: opts.strict})],
    ['stage_2.2', () => runCov(base)],
    ['stage_2.3', runSpecConformance],
    ['stage_2.4', runDeliverableSmoke],
    ['stage_3.1', runSmoke],
    ['stage_3.2', runPerf],
    ['stage_3.3', runVisual],
    ['stage_4.1', runAudit],
    ['stage_4.2', runUat],
  ] as const;
  const stages = allStages.filter(([name]) => allowed.includes(name));
  let worst = 0;
  let anyFailed = false;
  // Smoke dispositions widen the legacy 3-bucket spine (F-e0f6c7; see stages/disposition.ts).
  // Map a gate status to one of pulse's 5 kinds at the call site (no PulseKind churn):
  // blocking → fail glyph; na → skip; liveness → note (ran, not green-as-smoke).
  const pulseKindOf = (s: GateStatus): PulseKind =>
    s === 'pass' ? 'pass' : s === 'liveness' ? 'note' : s === 'na' ? 'skip' : isBlocking(s) ? 'fail' : 'skip';
  // Mutable during the run (the EXEMPT half below rewrites the drift row); the
  // element shape matches StageOutcome exactly, so `collected` returns cleanly
  // as `readonly StageOutcome[]`.
  const collected: {stage: string; label: string; status: GateStatus; exitCode: number; stderr?: string; findings?: readonly DriftFinding[]; skipReason?: 'no-runner' | 'tool-missing'}[] = [];
  // The writer receives this pre-gate source revision, never a convenient
  // post-gate reload.  A concurrent typed edit therefore rejects the stamp
  // instead of attesting bytes this gate never observed.
  let gateAttestationSnapshot: ReturnType<typeof captureAttestationInputSnapshot> | undefined;
  try {
    const snapshotSpec = opts.prospectiveFeatureId === undefined
      ? loadSpec('.')
      : prospectiveDoneSpec(loadSpec('.'), opts.prospectiveFeatureId);
    gateAttestationSnapshot = captureAttestationInputSnapshot('.', snapshotSpec);
    if (selectedProfile && profileCompilation?.schemaVersion === '0.2') {
      if (gateAssurancePlan) {
        const capturedPlan = gateAssurancePlan;
        gateAttestationSnapshot = Object.freeze({
          ...gateAttestationSnapshot,
          runtime: Object.freeze({
            inputSha256: capturedPlan.snapshot.inputSha256,
            complete: capturedPlan.snapshot.complete,
            matchesCurrent: (): boolean => {
              try {
                // The completion overlay is already popped when the F4
                // writer asks this question. Re-read disk, then apply only
                // the proposed status in memory so an intervening source,
                // control, receipt, root, or shard change cannot hide behind
                // the gate's former cache view.
                // `matchesCurrent` is invoked by writeAttestation while its
                // F4 lock is held. Use the explicit lock-held readers rather
                // than trying to reacquire that non-reentrant workspace lock.
                const diskSpec = loadSpecFromDiskUnlocked('.');
                const currentSpec = opts.prospectiveFeatureId === undefined
                  ? diskSpec
                  : prospectiveDoneSpec(diskSpec, opts.prospectiveFeatureId);
                const currentCompilation = opts.prospectiveFeatureId === undefined
                  ? compileSpecWorkspaceWithLockHeld('.')
                  : prospectiveDoneCompilation(compileSpecWorkspaceWithLockHeld('.'), opts.prospectiveFeatureId);
                // The D17 closure loader reads the current Spec itself. Keep
                // that read and the compiler view in the same reconstructed
                // prospective target so the F4 recheck cannot compare a done
                // gate seal with an in-progress disk closure.
                const current = opts.prospectiveFeatureId === undefined
                  ? schema02AssurancePlan(
                    currentCompilation, selectedProfile, opts.assuranceLevel, opts.scopeSubjects, currentSpec,
                  )
                  : withProspectiveSpecOverlay('.', currentSpec, () =>
                    withProspectiveCompilationOverlay('.', currentCompilation, () =>
                      schema02AssurancePlan(
                        currentCompilation, selectedProfile, opts.assuranceLevel, opts.scopeSubjects, currentSpec,
                      ),
                    ));
                return current !== undefined
                  && current.snapshot.complete
                  && current.snapshot.inputSha256 === capturedPlan.snapshot.inputSha256;
              } catch {
                return false;
              }
            },
          }),
        });
      }
    }
  } catch {
    // Existing no-spec diagnostics retain their behavior; without a snapshot a
    // schema 0.2 v3 stamp is conservatively unavailable.
  }
  // F-e53596dd — prime the run-scoped detector cache so the drift stage's
  // ARCHITECTURE_VIOLATION + HARDCODED_SECRET runs are reused by stage_1.5/1.6
  // instead of re-spawning madge + secretlint (~5s of duplicate work per run).
  // The stages here default cwd to '.', so prime the same root. Cleared in
  // finally — a session outliving the loop would serve stale findings.
  primeDetectorResultCache('.');
  // F-49f6f2d2 (#215) — prime the run-scoped shared-test-run cache so the unit
  // stage (2.1) spawns ONE coverage+dual-json vitest run that the coverage stage
  // (2.2) folds, instead of running the suite twice. Same '.' root, same
  // finally-clear discipline; clear also unlinks the shared temp json.
  primeTestRunCache('.', gateAssurancePlan?.snapshot.inputSha256);
  let currentRunProof: CurrentRunProofEvidence | undefined;
  try {
    for (const [name, run] of stages) {
      const r = run({}) as {
        pass: boolean;
        exitCode: number;
        stderr?: string;
        findings?: readonly DriftFinding[];
        disposition?: Disposition;
        skipReason?: 'no-runner' | 'tool-missing';
      };
      const label = opts.internal ? name : gateLabel(name);
      // INVARIANT: exitCode 2 means "skipped" (cladding chose not to run — tool
      // missing / unknown language). It is NON-blocking. A stage that RAN and
      // found a real problem MUST return exitCode 1, never 2 — see
      // stages/util.ts::ranToolResult. (tsc exits 2 on type errors; relaying that
      // raw 2 here is what let a real type failure pass as a skip.)
      // Disposition-first (F-e0f6c7): see stages/disposition.ts.
      const status = gateStatusOf(r);
      if (isBlocking(status)) {
        anyFailed = true;
        worst = Math.max(worst, worstContribution(r, status));
      }
      // `skipReason` rides along additively (F-c17e1edc) — the --json writer
      // serializes `collected` wholesale, so no field whitelist to update.
      collected.push({stage: name, label, status, exitCode: r.exitCode, stderr: r.stderr, findings: r.findings, skipReason: r.skipReason});
      if (!opts.json && !silent) {
        pulse(pulseKindOf(status), label);
        if (isBlocking(status)) printStageDetails(r);
      }
    }
  } finally {
    clearDetectorResultCache();
    if (gateAssurancePlan) currentRunProof = currentGateProofEvidence('.', gateAssurancePlan.snapshot.inputSha256);
    clearTestRunCache();
  }
  // STRICT SKIP-POLICY (F-67d2e9, generalizes the 0.5.x unit-only guard).
  // Under --strict, a skipped stage the spec DEMANDS is a fail: 1.1 when a
  // declared language ships done features, 2.1 when done features declare
  // test_refs, and 2.3 when done ACs declare oracle_refs. stage_2.4 is
  // deliberately excluded: SMOKE_PROBE_DEMAND solely owns its safe-deliverable
  // demand, avoiding a duplicate failure. Demand-gated — no demand keeps the
  // lenient skip-as-pass contract; spec load failure yields no violations
  // (ABSENCE_OF_GOVERNANCE owns that blocking signal). Table pinned in the gate
  // golden matrix.
  if (opts.strict) {
    try {
      const spec = loadSpec();
      for (const v of strictSkipViolations(spec, collected)) {
        worst = Math.max(worst, 1);
        anyFailed = true;
        collected.push({stage: v.stage, label: v.label, status: 'fail', exitCode: 1, stderr: v.message});
        if (!opts.json && !silent) pulse('fail', v.label, v.message);
      }
    } catch {
      /* spec unreadable → other detectors own it; don't block here */
    }
  }
  // Re-attestation is part of the same verification decision: normalize the
  // one self-staleness finding before F6 reduces its observations.  Doing this
  // afterwards would leave a schema 0.2 profile unresolved and deadlock the
  // very run that must replace the old receipt.
  // The exemption must hold wherever warn-class blocking is active, so it
  // reads the same profile-owned predicate the drift stage did. Keying it on
  // the resolved plan alone would deadlock a completion run whose planning
  // failed: drift would block on the stale receipt this very run replaces.
  if (exemptSolelyStaleAttestation({
    strict: opts.strict === true,
    authoritative: profileOwnedWarnBlocking || gateAssurancePlan?.profile.authoritative === true,
    tier,
    stages: collected,
  })) {
    anyFailed = collected.some((stage) => isBlocking(stage.status));
    worst = collected.reduce((current, stage) => Math.max(current, worstContribution(stage, stage.status)), 0);
    if (!opts.json && !silent) pulse('note', 'attestation', 'stale entries re-verified by this run — re-attesting');
  }
  // F6 observes the already-run compatibility stages through one adapter.  It
  // never invokes a command, recomputes a stage result, or changes 0.1's
  // established exit result.  Schema 0.2 alone consumes the new authority.
  const requestedProfile = selectedProfile;
  let assurance: AssuranceVerdict | undefined;
  let assuranceSchema: '0.1' | '0.2' | undefined;
  let v3Entries: ReturnType<typeof createWorkspaceAttestations> = [];
  let v3Retention: ReturnType<typeof createAttestationV3RetentionContext>;
  let v3Freshness: readonly {readonly feature: string; readonly state: 'fresh' | 'stale' | 'unattested'; readonly field?: string}[] = [];
  let attestationError: string | undefined;
  let deferredAttestation: CheckOutcome['commitAttestation'];
  if (requestedProfile) {
    try {
      const compilation = profileCompilation ?? compileSpecWorkspace('.');
      assuranceSchema = compilation.schemaVersion;
      const configured = compilation.contract?.project.assuranceLevel ?? 'L2';
      const level = resolveRequestedAssuranceLevel({
        configured,
        requested: opts.assuranceLevel,
        boundedScope: opts.scopeSubjects !== undefined && opts.scopeSubjects.length > 0,
      });
      if (!level.ok) {
        if (compilation.schemaVersion === '0.2') {
          worst = Math.max(worst, 1);
          anyFailed = true;
        }
      } else {
        const profileLevel = requestedProfile === 'feedback' || requestedProfile === 'checkpoint' ? 'L1' : level.level;
        const fallbackProfile = assuranceProfile(requestedProfile, profileLevel);
        const fallbackScope = [...(opts.scopeSubjects ?? (compilation.schemaVersion === '0.2'
          ? (compilation.contract?.features ?? []).map((feature) => `feature:${feature.id}`)
          : ['project']))].sort();
        const plan = compilation.schemaVersion === '0.2' && gateAssurancePlan?.compilation === compilation
          ? gateAssurancePlan
          : undefined;
        // Observations are bound to the pre-gate closure digest.  Rebuilding
        // once after the stages detects a source/test/module/config/receipt
        // interleave before reduction; the writer repeats this comparison
        // under the F4 lock.
        let closureStable = compilation.schemaVersion === '0.1';
        let postPlan: Schema02AssurancePlan | undefined;
        if (plan) {
          try {
            const postCompilation = opts.prospectiveFeatureId === undefined
              ? compileSpecWorkspace('.')
              : prospectiveDoneCompilation(compileSpecWorkspace('.'), opts.prospectiveFeatureId);
            const postSpec = opts.prospectiveFeatureId === undefined
              ? undefined
              : prospectiveDoneSpec(loadSpec('.'), opts.prospectiveFeatureId);
            postPlan = schema02AssurancePlan(postCompilation, requestedProfile, opts.assuranceLevel, opts.scopeSubjects, postSpec);
            closureStable = plan.snapshot.complete
              && postPlan !== undefined
              && postPlan.snapshot.complete
              && postPlan.snapshot.inputSha256 === plan.snapshot.inputSha256;
          } catch {
            closureStable = false;
          }
        }
        const profile = plan?.profile ?? fallbackProfile;
        // Schema 0.1 keeps its historic stage subjects. B4 static subjects are
        // introduced only through the schema-0.2 compiler-minted scope below.
        const scopeAddresses = plan?.scopeAddresses ?? fallbackScope;
        const oracleRequiredSubjects = plan?.oracleRequiredSubjects;
        const staticReports = compilation.schemaVersion === '0.2'
          ? plan?.snapshot.criterionObservations ?? staticCriterionReportsFromWorkspace('.', compilation, scopeAddresses)
          : [];
        const staticCriterionScope = compilation.schemaVersion === '0.2'
          ? plan?.snapshot.staticCriterionScope ?? staticCriterionScopeFromWorkspace(compilation, scopeAddresses)
          : undefined;
        const liveReports = compilation.schemaVersion === '0.2'
          ? liveCriterionReportsFromCurrentRun({
            cwd: '.', compilation, scopeAddresses, currentRun: currentRunProof,
            expectedGateInputSha256: plan?.snapshot.inputSha256,
          })
          : [];
        // The criteria whose selection named a binding source. Without it the
        // reducer cannot separate "nothing renewed this proof" from "this
        // criterion never named a testcase", and would tell a reader to re-run
        // a gate that can never clear the row. It is resolved BEFORE the
        // adapter input is built, so the reducer never reads a half-filled
        // collector, and it stays absent whenever no report joined.
        const boundProofCriteria: BoundCriteriaCollector = {};
        const currentProofViews = compilation.schemaVersion === '0.2'
          ? currentProofViewsFromWorkspace('.', compilation, scopeAddresses, currentRunProof, plan?.snapshot.inputSha256, boundProofCriteria)
          : [];
        assurance = reduceLegacyStageAdapter({
          profile,
          configuredAssuranceLevel: plan?.configured ?? configured,
          completeScope: compilation.schemaVersion === '0.1'
            ? compilation.contract !== undefined || compilation.schemaVersion === '0.1'
            : closureStable,
          scopeAddresses,
          inputSha256: plan?.snapshot.inputSha256 ?? workspaceClosureSeals('.', compilation).inputSha256,
          inputAddresses: compilation.nodes.map((node) => node.address).sort(),
          hasExecutableTests: compilation.schemaVersion === '0.2'
            ? plan?.hasApplicableTestCriteria ?? hasApplicableSchema02TestCriteria(compilation, scopeAddresses)
            : compilation.edges.some((edge) => edge.channel === 'test'),
          hasOracleProof: oracleRequiredSubjects?.size !== undefined ? oracleRequiredSubjects.size > 0 : compilation.edges.some((edge) => edge.channel === 'oracle'),
          ...(oracleRequiredSubjects ? {oracleRequiredSubjects} : {}),
          hasDeliverable: plan?.hasDeliverable ?? compilation.nodes.some((node) => node.address === 'artifact:package.json'),
          requiresQuality: plan?.requiresQuality ?? (level.level === 'L3' || level.level === 'L4'),
          requiresHuman: plan?.requiresHuman ?? level.level === 'L4',
          criterionObservations: [...staticReports, ...liveReports],
          ...(staticCriterionScope ? {staticCriterionScope} : {}),
          ...(plan?.snapshot.migrationBaselineCandidates !== undefined
            ? {migrationBaselineCandidates: plan.snapshot.migrationBaselineCandidates}
            : {}),
          ...(compilation.schemaVersion === '0.2' ? {
            proofViews: currentProofViews,
            ...(boundProofCriteria.criteria === undefined ? {} : {boundProofCriteria: boundProofCriteria.criteria}),
            currentProofObservationIdentity: currentRunProofIdentity(currentRunProof),
            exactProofRequired: true,
          } : {}),
          stages: collected.map((stage) => ({stage: stage.stage, status: stage.status})),
          environmentClass: 'foreground',
        });
        // The public reducer result remains a useful machine projection. Only
        // this coordinator can additionally bind that exact object to the
        // compiler-owned plan and stages it just executed; no public adapter
        // call can replay this mint with caller-provided rows.
        // Completion may enter through a caller that did not retain the
        // prospective overlay.  Rebuild the one target status on the exact
        // compiler snapshot used for the gate before deriving either private
        // authority seals or its v3 row.  The verdict still carries the full
        // compiler impact scope; this view only prevents the target's
        // in-progress disk row from making its own completed receipt
        // impossible to mint.
        const attestationCompilation = opts.deferAttestation && opts.prospectiveFeatureId !== undefined
          ? prospectiveDoneCompilation(compilation, opts.prospectiveFeatureId)
          : compilation;
        if (compilation.schemaVersion === '0.2' && plan && closureStable) {
          const closures = assuranceClosureInputFromWorkspace('.', attestationCompilation);
          const featureSeals = plan.scopeAddresses.flatMap((address) => {
            if (!address.startsWith('feature:')) return [];
            const feature = address.slice('feature:'.length);
            return [{feature, ...featureClosureSeals(closures, feature)}];
          });
          const profileIdentity = {
            registrySha256: createHash('sha256').update(canonicalClosureJson(OBLIGATION_DESCRIPTORS), 'utf8').digest('hex'),
            detectorCatalogSha256: detectorCatalogSha256(allDetectors),
            toolIdentity: getCurrentCladdingVersion() ?? 'unknown',
            environmentClass: 'foreground',
            trustSnapshotSha256: emptyTrustSnapshot().digest,
          } as const;
          mintRunCheckStagesAuthority(assurance, {
            inputSha256: plan.snapshot.inputSha256,
            scopeAddresses: plan.scopeAddresses,
            profileAuthoritative: plan.profile.authoritative,
            executedStageIds: collected.map((stage) => stage.stage),
            featureSeals,
            profileIdentity,
          });
        }
        if (compilation.schemaVersion === '0.2' && requestedProfile !== 'feedback' && assurance.state !== 'green') {
          worst = Math.max(worst, 1);
          anyFailed = true;
        }
        if (assurance.state === 'green' && assurance.profile_complete
          && (assurance.profile === 'completion' || assurance.profile === 'push' || assurance.profile === 'release')) {
          const scopeFeatureIds = (plan?.scopeAddresses ?? opts.scopeSubjects ?? (compilation.schemaVersion === '0.2'
            ? (compilation.contract?.features ?? []).map((feature) => `feature:${feature.id}`)
            : (loadSpec('.').features ?? []).filter((feature) => feature.status === 'done').map((feature) => `feature:${feature.id}`)))
            .map((address) => address.replace(/^feature:/, ''));
          // A deferred schema-0.2 completion seals the full impact scope in
          // its verdict, but only mints the target row. Existing done
          // prerequisites/co-owners remain eligible only through the locked
          // sibling-retention reducer, never as fresh replacement authority.
          const replacementFeatureIds = opts.deferAttestation && opts.prospectiveFeatureId !== undefined
            ? [opts.prospectiveFeatureId]
            : scopeFeatureIds;
          // F6 has no registered product issuer.  Preserve this explicit empty
          // current context so F9 can add a complete receipt-location census
          // without changing writer-side sibling retention.
          const receiptContext = {candidates: [], trustSnapshot: emptyTrustSnapshot()} as const;
          v3Entries = createWorkspaceAttestations({
            cwd: '.', compilation: attestationCompilation, verdict: assurance, featureIds: replacementFeatureIds,
            detectorCatalogSha256: detectorCatalogSha256(allDetectors),
            toolIdentity: getCurrentCladdingVersion() ?? 'unknown', environmentClass: 'foreground',
            trustSnapshotSha256: receiptContext.trustSnapshot.digest,
            receiptContext,
          });
          v3Retention = createAttestationV3RetentionContext(v3Entries, receiptContext);
          const previous = readAttestation('.');
          v3Freshness = v3Entries.map((entry) => {
            const result = previous ? featureAttestationV3(previous, entry.feature, entry) : {state: 'unattested' as const};
            return {feature: entry.feature, state: result.state, ...(result.state === 'stale' ? {field: result.field} : {})};
          });
      }
      }
    } catch {
      // A schema 0.2 compiler/closure fault is not a compatibility warning:
      // there is no complete authoritative input to reduce or stamp. Keep the
      // schema 0.1 stage projection unchanged, but fail closed for F6.
      if (profileCompilation?.schemaVersion === '0.2' || assuranceSchema === '0.2') {
        worst = Math.max(worst, 1);
        anyFailed = true;
      }
    }
  }
  // F-a5228c/F6 — schema 0.1 retains its GREEN strict pre-push/all attestation
  // path.  Schema 0.2 stamps only from the authoritative profile-complete
  // reducer verdict; `--strict` must not make that otherwise identical
  // profile more or less authoritative.
  //   POLL    — under `silent` (the verdict poll) the EXEMPT half STILL runs: it
  //             recomputes worst/anyFailed, which ARE the verdict, so a poll must
  //             agree with `clad check`/`clad done` on a solely-stale tree
  //             (AC-5d88c6b9 — same gate, one touch). Only the STAMP (the
  //             writeAttestation mutation) is skipped: a poll is a read-only
  //             stop-signal, never a verification of record. The next real
  //             `clad check`/`clad done` does the writing.
  const legacyMayStamp = opts.strict && (tier === 'pre-push' || tier === 'all');
  const schema02MayStamp = assuranceSchema === '0.2' && v3Entries.length > 0 && gateAttestationSnapshot !== undefined;
  const stampSchema02 = (completion?: GeneratedAttestationCompletion): void => {
    if (gitOperationInProgress('.')) throw new Error('ATTESTATION_WRITE_DEFERRED');
    writeAttestation('.', gateAttestationSnapshot!.spec, undefined, v3Entries, gateAttestationSnapshot, {
      writeLegacy: false,
      ...(v3Retention === undefined ? {} : {retention: v3Retention}),
      ...(completion === undefined ? {} : {completion}),
    });
  };
  if (legacyMayStamp || schema02MayStamp) {
    // STAMP — the mutation. A poll (silent) must never write spec/attestation.yaml.
    if (!anyFailed && !silent && schema02MayStamp && opts.deferAttestation) {
      deferredAttestation = (completion) => {
        if (completionWriter === undefined) throw new Error('UNPREPARED_SCHEMA02_COMPLETION');
        consumePreparedSchema02DoneWriter('.', completionWriter, completion);
        stampSchema02(completion);
      };
    } else if (!anyFailed && !silent && (assuranceSchema !== '0.2' || schema02MayStamp)) {
      if (gitOperationInProgress('.')) {
        if (!opts.json) pulse('note', 'attestation', 'deferred — git operation in progress; run the gate again after the merge/rebase completes.');
      } else {
        try {
          if ((assuranceSchema === '0.2'
            ? (stampSchema02(), true)
            : writeAttestation('.', gateAttestationSnapshot?.spec ?? loadSpec(), {
              cladding: getCurrentCladdingVersion() ?? 'unknown',
              blocking: 'strict',
              detectorsSha256: detectorCatalogSha256(allDetectors),
            }, v3Entries, gateAttestationSnapshot, {writeLegacy: true}))) {
            if (!opts.json) pulse('note', 'attestation', 'spec/attestation.yaml refreshed (verified tree stamped)');
          }
        } catch (error) {
          // Schema 0.2 cannot report a GREEN authoritative gate if the F4
          // writer rejected its exact preimage.  Preserve legacy behavior for
          // schema 0.1, but carry the failure into the canonical machine
          // verdict rather than swallowing STALE_INPUT behind a success JSON.
          if (assuranceSchema === '0.2' && assurance) {
            assurance = invalidateAssuranceVerdict(assurance);
            attestationError = (error as {code?: string}).code ?? 'ATTESTATION_WRITE_FAILED';
            v3Entries = [];
            worst = Math.max(worst, 1);
            anyFailed = true;
            if (!opts.json && !silent) pulse('fail', 'attestation', 'verification inputs changed before the attestation could be recorded. Run the gate again.');
          }
        }
      }
    }
  }
  if (opts.json && !silent) {
    // Machine-readable, UNTRUNCATED — findings carry file/line/suggestion so an
    // agent fixes in one pass instead of re-running to discover where + what.
    process.stdout.write(`${JSON.stringify({
      tier,
      ...(assurance ? {
        profile: assurance.profile,
        requested_assurance_level: assurance.assurance_level,
        configured_assurance_level: assurance.configured_assurance_level,
        achieved_assurance_level: assurance.achieved_assurance_level,
        scope_sha256: assurance.scope_sha256,
        input_sha256: assurance.input_sha256,
        profile_complete: assurance.profile_complete,
        obligations: assurance.results,
        // An unresolved verdict has to name WHY it could not resolve. The
        // snapshot already addressed every incomplete closure; publishing it
        // turns `profile_complete: false` from a verdict into a work list.
        // Schema 0.1 has no such closure, and its JSON stays byte-identical.
        ...(assuranceSchema === '0.2'
          ? {incomplete_addresses: gateAssurancePlan?.snapshot.incompleteAddresses ?? []}
          : {}),
        independence: assurance.independence,
        attestation_freshness: v3Freshness,
        ...(attestationError ? {attestation_error: attestationError} : {}),
        assurance,
      } : {}),
      worst,
      anyFailed,
      stages: collected,
    }, null, 2)}\n`);
  } else if (anyFailed && !silent) {
    process.stdout.write('\nℹ Run `clad doctor` for the event log, or `clad sync` to check the spec. The findings above say what drifted and why.\n');
  }
  // F-c17e1edc — name the exit for the curable skips only. A no-runner skip is
  // one declaration away from running; a tool-missing skip already HAS its
  // command, and a by-design skip (no oracle / no deliverable) would be given a
  // false prescription — so both stay out of the line, and out of its list.
  if (!opts.json && !silent) {
    const guidance = renderNoRunnerGuidance(
      collected.filter((c) => c.skipReason === 'no-runner').map((c) => c.label),
    );
    if (guidance) process.stdout.write(`\nℹ ${guidance}\n`);
  }
  // F-b84c38 + F-1aab1bba — verification freshness and Stop follow-through
  // need one gate record. Compact blocker names explain rejected done attempts;
  // the Stop-compatible trio fingerprint lets read-time analysis determine
  // whether a prior Stop block was later reproduced by a normal gate.
  recordEvent('.', 'gate_run', {
    tier,
    strict: opts.strict === true,
    worst,
    anyFailed,
    blockers: blockingDetectorNames(collected),
    stopFingerprint: gateStopFingerprint(collected),
  });
  return {worst, anyFailed, stages: collected, ...(assurance ? {assurance} : {}), ...(deferredAttestation ? {commitAttestation: deferredAttestation} : {})};
}

/** Refuses caller-supplied completion transport before any stage or writer side effect. */
function refuseUnpreparedCompletion(opts: CheckStageOptions): CheckOutcome {
  const error = 'schema-0.2 completion verification must be started by clad done';
  if (opts.json && !opts.silent) {
    process.stdout.write(`${JSON.stringify({error, worst: 1, anyFailed: true, stages: []}, null, 2)}\n`);
  } else if (!opts.silent) {
    pulse('fail', 'check', 'Completion verification must be started by clad done.');
  }
  return {worst: 1, anyFailed: true, stages: [], error};
}

/**
 * Turns the one self-invalidating stale-attestation finding into the current
 * gate's re-verification result.  It is intentionally pure of the writer so
 * callers can reduce the same corrected rows before deciding whether to stamp.
 */
export function exemptSolelyStaleAttestation(input: {
  readonly strict: boolean;
  /** Schema 0.2 authoritative profiles re-attest without a transport strict flag. */
  readonly authoritative?: boolean;
  readonly tier: string;
  readonly stages: Array<{
    stage: string;
    status: GateStatus;
    exitCode: number;
    stderr?: string;
    findings?: readonly DriftFinding[];
  }>;
}): boolean {
  if ((!input.strict && input.authoritative !== true) || (input.tier !== 'pre-push' && input.tier !== 'all')) return false;
  const drift = input.stages.find((stage) => stage.stage === 'stage_1.3');
  const failing = (drift?.findings ?? []).filter((finding) => finding.severity === 'error' || finding.severity === 'warn');
  const solelyStale = drift?.status === 'fail' && failing.length > 0 && failing.every((finding) => finding.detector === 'STALE_ATTESTATION');
  const othersGreen = input.stages.every((stage) => stage.stage === 'stage_1.3' || !isBlocking(stage.status));
  if (!solelyStale || !othersGreen || !drift) return false;
  drift.status = 'pass';
  drift.exitCode = 0;
  drift.stderr = 'stale attestation exempted — this run re-verified and re-attests';
  return true;
}

/** Pre-gate schema 0.2 policy and closure snapshot; it is reused after stages and under the writer lock. */
interface Schema02AssurancePlan {
  readonly compilation: SpecCompilation;
  readonly profile: AssuranceProfile;
  readonly configured: AssuranceLevel;
  readonly scopeAddresses: readonly string[];
  readonly scopedFeatures: ReadonlySet<string>;
  /** Compiler-owned schema 0.2 Unit/Coverage applicability, not binding availability. */
  readonly hasApplicableTestCriteria: boolean;
  readonly oracleRequiredSubjects: ReadonlySet<string>;
  readonly hasDeliverable: boolean;
  readonly requiresQuality: boolean;
  readonly requiresHuman: boolean;
  /** The compiler-proven module closure supplied to command-stage adapters. */
  readonly focusModules?: readonly string[];
  readonly snapshot: WorkspaceProfileSnapshot;
}

/** Builds an exact subject-scoped plan from compiler facts without interpreting proof results. */
function schema02AssurancePlan(
  compilation: SpecCompilation,
  requestedProfile: AssuranceProfileId,
  requestedLevel: AssuranceLevel | undefined,
  scopeSubjects: readonly string[] | undefined,
  suppliedSpec?: ReturnType<typeof loadSpec>,
): Schema02AssurancePlan | undefined {
  if (compilation.schemaVersion !== '0.2' || !compilation.contract) return undefined;
  const configured = compilation.contract.project.assuranceLevel ?? 'L2';
  // Resolve scope before accepting a one-run assurance upgrade: only an exact
  // completion closure is bounded. Push remains an integration/repository run.
  const initialProfile = assuranceProfile(requestedProfile, configured);
  const effectiveScope = effectiveFeatureScope(compilation, initialProfile, scopeSubjects);
  const level = resolveRequestedAssuranceLevel({
    configured,
    requested: requestedLevel,
    boundedScope: requestedProfile === 'completion' && !effectiveScope.repository && effectiveScope.complete,
  });
  if (!level.ok) return undefined;
  const profileLevel = requestedProfile === 'feedback' || requestedProfile === 'checkpoint' ? 'L1' : level.level;
  const profile = assuranceProfile(requestedProfile, profileLevel);
  const allScopeAddresses = compilation.contract.features.map((feature) => `feature:${feature.id}`).sort();
  let requestedScopeAddresses = [...effectiveScope.scopeAddresses];
  let scopedFeatures = new Set(effectiveScope.featureIds);
  let repositoryScope = effectiveScope.repository || requestedScopeAddresses.length === allScopeAddresses.length;
  const currentSpec = suppliedSpec ?? loadSpec('.');
  let oracleRequiredSubjects = new Set(requiredOracleWorklist(currentSpec)
    .filter((row) => scopedFeatures.size === 0 || scopedFeatures.has(row.featureId))
    .map((row) => `criterion:${row.featureId}/${row.acId}`));
  let hasApplicableTestCriteria = hasApplicableSchema02TestCriteria(compilation, requestedScopeAddresses);
  const requiresQuality = level.level === 'L3' || level.level === 'L4';
  const requiresHuman = level.level === 'L4';
  const buildSnapshot = (scopeComplete: boolean): WorkspaceProfileSnapshot => workspaceProfileSnapshot('.', compilation, {
    profile,
    scopeAddresses: requestedScopeAddresses,
    hasExecutableTests: hasApplicableTestCriteria,
    oracleRequiredSubjects,
    requiresHuman,
    scopeComplete,
  });
  let snapshot = buildSnapshot(effectiveScope.complete);
  const selectScope = (scopeAddresses: readonly string[]): void => {
    requestedScopeAddresses = [...scopeAddresses].sort();
    scopedFeatures = new Set(requestedScopeAddresses.flatMap((address) => address.startsWith('feature:') ? [address.slice('feature:'.length)] : []));
    hasApplicableTestCriteria = hasApplicableSchema02TestCriteria(compilation, requestedScopeAddresses);
    oracleRequiredSubjects = new Set(requiredOracleWorklist(currentSpec)
      .filter((row) => scopedFeatures.has(row.featureId))
      .map((row) => `criterion:${row.featureId}/${row.acId}`));
  };
  if (snapshot.effectiveScopeAddresses.some((address) => !requestedScopeAddresses.includes(address))) {
    selectScope(snapshot.effectiveScopeAddresses);
    repositoryScope = requestedScopeAddresses.length === allScopeAddresses.length;
    snapshot = buildSnapshot(effectiveScope.complete && !repositoryScope);
  }
  // Controls, contract closures, and runtime-dependency closures determine
  // what a runner can honestly cover. If any is incomplete, rerun the whole
  // repository rather than leaving the command stage focused on a subset.
  const unsafeScope = snapshot.incompleteAddresses.some((address) =>
    address === 'runner-controls' || address === 'scope-closure' || address.startsWith('contract:') || address.startsWith('runtime:'));
  if (!repositoryScope && unsafeScope) {
    repositoryScope = true;
    selectScope(allScopeAddresses);
    snapshot = buildSnapshot(false);
  }
  return {
    compilation,
    profile,
    configured,
    scopeAddresses: snapshot.effectiveScopeAddresses,
    scopedFeatures,
    hasApplicableTestCriteria,
    oracleRequiredSubjects,
    hasDeliverable: compilation.nodes.some((node) => node.address === 'artifact:package.json'),
    requiresQuality,
    requiresHuman,
    ...(!repositoryScope && effectiveScope.complete && effectiveScope.focusModules
      ? {focusModules: effectiveScope.focusModules}
      : {}),
    snapshot,
  };
}

/** Handler for `clad check`. Runs the tier's Iron Law stages; exits with worst code. */
/** Handler for `clad context <query>` (F-d2c806) — print the context slice. */
export function runContextCommand(query: string): void {
  try {
    const spec = loadSpec();
    const slice = buildContextSlice(spec, query);
    process.stdout.write(`${JSON.stringify(slice, null, 2)}\n`);
    process.exit('not_found' in slice ? 1 : 0);
  } catch (err) {
    pulse('fail', 'context', (err as Error).message);
    process.exit(1);
  }
}

/** Handler for `clad impact <query>` (F-7794a6bc) — print the blast-radius slice. */
export function runImpactCommand(query: string, opts: {depth?: string} = {}): void {
  try {
    const spec = loadSpec();
    const depth = opts.depth !== undefined ? Number(opts.depth) : undefined;
    const slice = buildImpactSlice(spec, query, {depth, graph: graphIrView('.', spec)});
    process.stdout.write(`${JSON.stringify(slice, null, 2)}\n`);
    process.exit('not_found' in slice ? 1 : 0);
  } catch (err) {
    pulse('fail', 'impact', (err as Error).message);
    process.exit(1);
  }
}

/**
 * `clad infer-deps` (F-2be3e3bb) — reconstruct feature depends_on edges from the code import
 * graph and print them as REVIEWABLE suggestions (does not write the spec — a human merges the
 * edges, anti-self-cert). Surfaces the dependency graph cladding never auto-produced.
 */
export function runInferDepsCommand(opts: {ambiguity?: string} = {}): void {
  try {
    const spec = loadSpec();
    const ambiguity = opts.ambiguity !== undefined ? Number(opts.ambiguity) : undefined;
    const read = (p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    };
    const result = inferDependsOn(spec, read, {
      ...(ambiguity !== undefined ? {maxOwnerAmbiguity: ambiguity} : {}),
      graph: graphIrView('.', spec),
    });
    process.stdout.write(
      `${JSON.stringify({suggestions: result.suggestions, new_edges: result.edges.length, already_declared: result.alreadyDeclared.length, dynamic_import_files: result.dynamicImportFiles}, null, 2)}\n`,
    );
    process.exit(0);
  } catch (err) {
    pulse('fail', 'infer-deps', (err as Error).message);
    process.exit(1);
  }
}

/**
 * `clad measure` (F-16138071) — deterministically report the search + context efficiency the
 * graph provides per feature: working-set tokens vs the naive (shard + all module files)
 * baseline, the dependency depth/edges it resolves for you, and the regression-set coverage.
 * No agent, no test run — measures what the infrastructure CAN provide (an upper bound vs one
 * naive baseline), not whether an agent adopts it.
 *
 * ATTRIBUTION (v0.7.1): the shrink number is split — for budget-capped features the reduction
 * is the CAP doing the work (arithmetic, not graph value), and the uncapped structural slice is
 * ≈1x of naive (code + structured metadata). What the working set sells is the guaranteed
 * budget + the wired needs/breaks/verify context, not raw byte shrink.
 */
export function runMeasureCommand(opts: {json?: boolean; sessions?: boolean; trend?: boolean | string} = {}): void {
  try {
    if (opts.sessions) {
      runSessionsMeasure(opts);
      return;
    }
    if (opts.trend !== undefined && opts.trend !== false) {
      runTrendMeasure(opts);
      return;
    }
    const spec = loadSpec();
    const read = (p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    };
    const r = measureGraphEfficiency(spec, read, '.', graphIrView('.', spec));
    // Persist the summary BEFORE printing so the numbers stop evaporating on
    // stdout (F-39609db4). Best-effort: a failed/deduped write never blocks the
    // report or changes the exit code.
    const rec = appendMeasureSnapshot('.', r);
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    } else {
      const c = r.context;
      const capPart =
        c.truncatedCount > 0
          ? `budget enforces ${c.medianShrinkTruncated}x on ${c.truncatedCount} capped feature(s) (cap-driven)`
          : 'no feature hit the budget cap';
      const fitPart = c.fitsCount > 0 ? `${c.medianShrinkFit}x on ${c.fitsCount} fitting` : 'none fit untruncated';
      const lines = [
        `graph efficiency · ${r.measured}/${r.featureCount} features`,
        `  context: working-set ${c.medianSliceTokens} tok vs naive ${c.medianNaiveTokens} tok — ${capPart}, ${fitPart}`,
        `           uncapped structural slice = ${c.medianStructuralRatio}x of naive — the value is the guaranteed budget + wired needs/breaks/verify, not raw shrink`,
        `  search:  median ${r.search.medianDepth} hop(s) resolved (p95 ${r.search.p95Depth}), median ${r.search.medianEdges} edge(s)/feature (max hub ${r.search.maxEdges})`,
        `  stability: median blast-radius coverage ${r.stability.medianCoverage}, median ${r.stability.medianRegressionTests} regression test(s) surfaced; stops ${JSON.stringify(r.stability.byStopReason)}`,
        `  ${MEASUREMENT_DISCLAIMER}`,
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
      if (rec.appended) pulse('note', 'measure', 'snapshot recorded to .cladding/measure.jsonl — see `clad measure --trend`');
      else if (rec.reason === 'deduped') pulse('note', 'measure', 'commit+spec state unchanged since last snapshot — not recorded');
      else if (rec.reason === 'no_head') pulse('note', 'measure', 'no git HEAD — snapshot not recorded (commit first; a head-less line has no reproduce target)');
    }
    process.exit(0);
  } catch (err) {
    pulse('fail', 'measure', (err as Error).message);
    process.exit(1);
  }
}

export function runCheckCommand(opts: {internal?: boolean; strict?: boolean; tier?: string; profile?: string; assuranceLevel?: AssuranceLevel; json?: boolean; feature?: string}): void {
  if (opts.profile && !normalizeProfile(opts.profile)) {
    pulse('fail', 'check', 'Unknown assurance profile. Use feedback, checkpoint, completion, push, or release.');
    process.exit(2);
    return;
  }
  if (opts.profile && opts.tier && normalizeProfile(opts.tier) !== normalizeProfile(opts.profile)) {
    pulse('fail', 'check', 'The requested profile conflicts with the legacy tier alias. Use one matching profile or tier.');
    process.exit(2);
    return;
  }
  if (opts.assuranceLevel && !['L1', 'L2', 'L3', 'L4'].includes(opts.assuranceLevel)) {
    pulse('fail', 'check', 'Unknown assurance level. Use L1, L2, L3, or L4.');
    process.exit(2);
    return;
  }
  const requestedProfile = normalizeProfile(opts.profile ?? opts.tier ?? 'all');
  if (opts.feature && requestedProfile === 'release') {
    pulse('fail', 'check', 'Release checks always run across the whole repository. Remove the feature filter.');
    process.exit(2);
    return;
  }
  let focusModules: readonly string[] | undefined;
  let scopeSubjects: readonly string[] | undefined;
  if (opts.feature) {
    // Opt-in module scope: resolve the named feature's modules. clad check
    // without --feature stays whole-repo (CI / tier=all unchanged).
    try {
      const spec = loadSpec();
      const f = (spec.features ?? []).find(
        (x) => x.id === opts.feature || (x as {slug?: string}).slug === opts.feature,
      );
      if (!f) {
        pulse('fail', 'check', `no feature '${opts.feature}' in spec — cannot scope gate`);
        process.exit(1);
      }
      focusModules = f.modules;
      scopeSubjects = [`feature:${f.id}`];
    } catch (err) {
      pulse('fail', 'check', (err as Error).message);
      process.exit(1);
    }
  }
  const result = runCheckStages({...opts, focusModules, ...(scopeSubjects ? {scopeSubjects} : {})});
  // F-f4e184f7 + F-be5306eb: a non-blocking advisory when the feature cycle isn't
  // being driven — code with no feature specs (cold-start), or undone features with
  // no hook/CI. Suppressed under --json.
  if (!opts.json) {
    const advisory = featureCycleAdvisory('.');
    if (advisory) process.stdout.write(`ℹ ${advisory}\n`);
  }
  // Set process.exitCode rather than process.exit(): the machine-output mode
  // (--json) can write >64KB to stdout, and process.exit() terminates before a
  // buffered stdout PIPE flushes — truncating the document for any consumer
  // that pipes (vs. redirects to a file). Letting the event loop drain
  // guarantees the full payload is emitted, then Node exits with this code.
  process.exitCode = result.worst;
}

/**
 * Handler for `clad done <featureId>`. Gates the `status: done` transition on a
 * GREEN `clad check --tier=pre-push --strict` (flip → gate → keep-or-revert),
 * so `done` cannot claim more than the gate verifies. @see cli/done.ts
 */
export function runDoneCommand(featureId: string): void {
  // F-c566f590 — load the project's independence policy + the evidence ledger and
  // hand them to runDone as its optional independence seam. A spec that will not
  // load simply omits the seam (runDone finds the shard directly and stays on its
  // pre-independence path). readEvidence is read-only.
  let independence: {policy: 'label' | 'require'; evidence: ReturnType<typeof readEvidence>} | undefined;
  try {
    const spec = loadSpec('.');
    independence = {policy: spec.project.independence_policy ?? 'label', evidence: readEvidence('.')};
  } catch {
    independence = undefined;
  }
  const r = runDone('.', featureId, {
    checkStages: runCheckStages,
    gitOpInProgress: gitOperationInProgressName,
    independence,
  });
  pulse(r.ok ? 'pass' : 'fail', `done · ${featureId}`, r.reason);
  // Surface the independence label as a concise plain note (only once the gate
  // actually ran — the early refusals carry no label). Soft-shell wording.
  if (r.independence) {
    const line =
      r.independence === 'independent'
        ? 'independence: independent — backed by human or independent review'
        : 'independence: self-certified — no independent or human review yet';
    pulse('note', `done · ${featureId}`, line);
  }
  process.exit(r.code);
}

/**
 * Handler for `clad oracle <featureId>`. Prints the deterministic, impl-blind
 * authoring brief (acceptance criteria + module paths + decl-only signatures,
 * NEVER bodies) for a feature/AC. cladding calls no LLM — the host hands this
 * brief to a fresh blind sub-agent, which writes the oracle; the host then
 * records provenance via the `clad_author_oracle` MCP tool. @see oracle/payload.ts
 */
export function runOracleCommand(featureId: string | undefined, opts: {ac?: string; cwd?: string; required?: boolean} = {}): void {
  const cwd = opts.cwd ?? '.';
  let spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    pulse('fail', 'oracle', `spec not loaded: ${(err as Error).message}`);
    process.exit(1);
    return;
  }

  // `--required`: print the policy worklist (which done ACs the oracle_policy /
  // require_oracles demands an oracle for) instead of a single feature's brief.
  if (opts.required) {
    if (featureId) {
      // --required is project-wide; a positional featureId is meaningless here.
      // Say so rather than silently dropping it (review nit, honesty lens).
      process.stdout.write(`(note: --required lists the whole-project worklist; ignoring '${featureId}')\n`);
    }
    const rows = requiredOracleWorklist(spec);
    if (rows.length === 0) {
      process.stdout.write('No oracles required — set project.oracle_policy or require_oracles, or no done ACs match the policy.\n');
      process.exit(0);
      return;
    }
    const missing = rows.filter((r) => !r.hasOracle);
    for (const r of rows) {
      const mark = r.hasOracle ? '✓' : '·';
      const tail = r.hasOracle ? '' : '  ← needs an impl-blind oracle';
      process.stdout.write(`  ${mark} ${r.featureId}.${r.acId}  [${r.reason}${r.ears ? `:${r.ears}` : ''}]${tail}\n`);
    }
    process.stdout.write(`\n${rows.length} AC(s) required, ${missing.length} missing an oracle.\n`);
    process.exit(missing.length > 0 ? 1 : 0);
    return;
  }

  if (!featureId) {
    pulse('fail', 'oracle', 'provide a <featureId> to print its blind brief, or --required to list the ACs the policy needs an oracle for');
    process.exit(1);
    return;
  }
  const payload = buildBlindPayload(spec, featureId, opts.ac, cwd);
  if (!payload || payload.acs.length === 0) {
    pulse('fail', 'oracle', `no acceptance criteria for ${featureId}${opts.ac ? `.${opts.ac}` : ''} — nothing to author a blind oracle from`);
    process.exit(1);
    return;
  }
  process.stdout.write(`${renderBlindBrief(payload)}\n`);
  process.exit(0);
}

function printStageDetails(
  r: {
    stderr?: string;
    hint?: string;
    findings?: readonly {detector: string; severity: string; message: string; path?: string}[];
  },
): void {
  if (r.findings && r.findings.length > 0) {
    const errors = r.findings.filter((f) => f.severity === 'error');
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const surface = errors.length > 0 ? errors : warns;
    // Plain-first (F-dd8dc994): the plain English lead leads, path + detector id
    // demoted to the tail; the host agent renders the user's own language
    // (F-9af291fa). Truncation budget preserved on the (short) lead.
    for (const f of surface.slice(0, 3)) {
      const lead = truncate(plainLead(f.detector, f.message), 140);
      const where = f.path ? ` — ${f.path}` : '';
      process.stdout.write(`    ${lead}${where} [${f.detector}]\n`);
      // The plain lead names the KIND of problem; when it replaced a message
      // that carried the specifics, print those too. Without this a developer
      // is told "there is an import loop" and never which files form it — the
      // gap that cost a real adopter sixteen days and a wrong root cause.
      const spoken = plainLead(f.detector, f.message);
      if (spoken !== f.message) {
        const detail = f.message.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
        for (const line of detail.slice(0, 4)) {
          process.stdout.write(`        ${truncate(line, 160)}\n`);
        }
        if (detail.length > 4) {
          process.stdout.write(`        … and ${detail.length - 4} more line(s) — see \`clad check --json\`\n`);
        }
      }
    }
    if (surface.length > 3) {
      process.stdout.write(`    … and ${surface.length - 3} more finding(s)\n`);
    }
    // F-4643d99d: a one-line remediation hint under a failing tool stage.
    if (r.hint) process.stdout.write(`    fix: run \`${r.hint}\`\n`);
    return;
  }
  if (r.stderr && r.stderr.trim().length > 0) {
    // A tool's diagnostic is a LIST — cycles, type errors, lint hits — and one
    // line of it is not actionable. Show the head of the list, not its first
    // line, and point at --json for the rest.
    const lines = r.stderr.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    for (const line of lines.slice(0, 5)) {
      process.stdout.write(`    ${truncate(line, 160)}\n`);
    }
    if (lines.length > 5) {
      process.stdout.write(`    … and ${lines.length - 5} more line(s) — see \`clad check --json\`\n`);
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Handler for `clad status` (formerly `panel`). Renders the feature × stage integrity matrix. */
export function runStatusCommand(opts: {internal?: boolean; json?: boolean}): void {
  const spec = loadSpec();
  if (opts.json) {
    // AC-e5f48ce5 — expose the SAME row model the ANSI panel renders, from the
    // split-out builder: one SSoT for terminal, JSON, and the audit bundle.
    // The row model can exceed the 64KB pipe buffer (200+ features), so write
    // then let the event loop DRAIN — process.exit() truncates a buffered pipe
    // mid-write (the latent bug PR #201 fixed for `clad check`).
    process.stdout.write(`${JSON.stringify(buildPanelModel(spec, '.'), null, 2)}\n`);
    process.exitCode = 0;
    return;
  }
  process.stdout.write(`${renderPanel(spec, '.', {internal: opts.internal})}\n`);
  process.exit(0);
}

/** Formats a byte count as a compact human size (B / KB / MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Handler for `clad bundle --out <file.html> [--since <ref>]` (F-e940fffe).
 *
 * Gathers every audit surface — the spec, the feature × stage row model, git
 * HEAD + version provenance, the capability catalog, and (for the range) the
 * shipped changes + audit table — then hands the DATA to the pure
 * buildBundleHtml renderer and writes one self-contained HTML file. All I/O
 * lives here; the renderer stays pure so a fixed repo state + fixed `now`
 * yields byte-identical output. A range that cannot be anchored degrades the
 * changelog + audit sections to an explicit notice, never the whole bundle
 * (AC-15bb0b99).
 *
 * `opts.now` (ISO string) is injectable so tests can pin the one
 * nondeterministic input; the CLI leaves it undefined → wall clock.
 */
export function runBundleCommand(opts: {out?: string; since?: string; cwd?: string; now?: string}): void {
  const cwd = opts.cwd ?? '.';
  const out = (opts.out ?? '').trim();
  if (out.length === 0) {
    pulse('fail', 'bundle', 'missing --out <file.html> — the bundle needs a destination path');
    process.exit(1);
    return;
  }

  let html: string;
  try {
    const spec = loadSpec(cwd);
    const panel = buildPanelModel(spec, cwd);
    const provenance = {
      gitHead: readGitHead(cwd),
      version: getCurrentCladdingVersion(),
      generatedAt: opts.now ?? new Date().toISOString(),
    };
    const catalogMarkdown = renderCatalog(spec);
    let changes: BundleChanges;
    try {
      const sinceRef = opts.since ?? defaultSinceRef(cwd);
      const manifest = collectChangelog(cwd, sinceRef);
      changes = {
        kind: 'present',
        sinceRef,
        changelogMarkdown: renderChangelogMarkdown(manifest),
        auditMarkdown: renderAuditTable(manifest, spec, cwd),
      };
    } catch (err) {
      changes = {kind: 'omitted', reason: (err as Error).message};
    }
    html = buildBundleHtml({spec, panel, provenance, catalogMarkdown, changes});
  } catch (err) {
    pulse('fail', 'bundle', (err as Error).message);
    process.exit(1);
    return;
  }

  try {
    writeFileSync(out, html, 'utf8');
  } catch (err) {
    pulse('fail', 'bundle', `could not write ${out}: ${(err as Error).message}`);
    process.exit(1);
    return;
  }
  pulse('pass', 'bundle', `${out} · ${formatBytes(Buffer.byteLength(html, 'utf8'))}`);
  process.exit(0);
}

/** Handler for `clad route <prompt>`. Classifies natural language → verb. */
export function runRouteCommand(prompt: string): void {
  const intent = classifyIntent(prompt);
  pulse('note', `route → ${intent}`, prompt);
  process.exit(intent === 'unknown' ? 1 : 0);
}

/**
 * Builds the commander Program with every verb wired up. Exported so
 * unit tests can invoke specific subcommands via
 * `createProgram().parse([verb, ...args], {from: 'user'})` without
 * touching `process.argv`.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name('clad').description('Reference Ironclad CLI').version('0.9.4');

  program
    .command('init [intent...]')
    .description(
      'Scaffold a cladding workspace. Pass a free-text project description as positional argument ' +
        '(e.g. `clad init payment SaaS for B2B` — free text in any language) to drive intent-aware onboarding — the LLM dispatcher then ' +
        'produces domain-aware capabilities/architecture/project-context plus product-level follow-up questions. ' +
        'Bare `clad init` keeps the v0.3.42 behaviour (greenfield seeds, or observed scan when ≥3 source files exist).',
    )
    .option('-n, --name <name>', 'Project name (default: cwd basename)')
    .option('-f, --force', 'Overwrite existing spec.yaml')
    .option('--scan', 'Force-walk the existing codebase. Default auto-detects (≥3 source files trigger scan). Use --no-scan to skip even when source is present.')
    .option('--no-llm', 'Force the deterministic interpreter (skip the LLM dispatcher chain). Intent text falls back to a deterministic quote in project-context.md.')
    .option('--roots <list>', 'Override scanner source roots, comma-separated (e.g. packages/a/src,packages/b/src). Otherwise inferred from manifests + directory heuristics.')
    .option('--with-hook', 'Install git pre-commit (cheap tier) AND pre-push (strict tier) hooks. Opt-in; cladding never touches .git without it.')
    .option('--with-ci', 'Scaffold .github/workflows/cladding.yml running the strict pre-push gate — the authoritative enforcement layer.')
    .option('--json', 'emit the raw InitResult for tooling; default is the human-readable surface')
    .action(runInitCommand);

  program
    .command('run [goal]')
    .description('(experimental) Headless autonomous loop — iterate ready features, dispatch developer + reviewer personas, run L1 gates, record evidence. The supported, exercised path is host-delegated (clad serve + your AI host loops the cadence); this loop needs a real LLM transport and is not auto-invoked')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--max-iterations <n>', 'cap iterations (default 50)', '50')
    .option('--max-wall-clock-ms <ms>', 'cap wall clock (default 600000)', '600000')
    .option('--max-retries <n>', 'cap retries per feature (default 3)', '3')
    .option('--json', 'emit the raw internal result (Iron Core view); default is a plain Soft Shell summary')
    .action(runRunCommand);

  program
    .command('sync')
    .description('Validate spec.yaml against schema and report')
    .option(
      '--propose-archive',
      'list STALE_SPECIFICATION findings whose suggestion.action is propose-archive (Phased Decommissioning Tier 2)',
    )
    .action(runSyncCommand);

  program
    .command('migrate')
    .description('Preview schema migration, or apply explicit confirmed decisions as one recoverable transaction')
    .requiredOption('--to <version>', 'target schema version (currently 0.2)')
    .option('--apply', 'apply the current preview after explicit human decisions are supplied')
    .option('--resolutions <path>', 'JSON object with the reviewed previewDigest and explicit confirmed decisions, required by --apply')
    .option('--json', 'emit the deterministic internal preview for tooling')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .action((opts: {to?: string; apply?: boolean; resolutions?: string; json?: boolean; cwd?: string}) => {
      void runMigrateCommand(opts);
    });

  program
    .command('begin <featureId>')
    .description('Start an implementation cycle and save its pre-cycle checkpoint with the feature update')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--json', 'emit internal transaction details for automation')
    .action((featureId: string, opts: {cwd?: string; json?: boolean}) => {
      runBeginCommand({featureId, cwd: opts.cwd, json: opts.json});
    });

  program
    .command('signoff <featureId>')
    .description('Record an asserted local audit or UAT history entry. This command never creates verified evidence.')
    .addOption(new Option('--claim <claim>', 'asserted claim kind: audit or uat').makeOptionMandatory().choices(['audit', 'uat']))
    .option('--criterion <criterion>', 'criterion id; required for audit')
    .addOption(new Option('--result <result>', 'audit result: pass or fail').choices(['pass', 'fail']))
    .option('--note <note>', 'optional asserted history note')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--json', 'emit internal asserted-signoff details')
    .action((featureId: string, opts: {claim: 'audit' | 'uat'; criterion?: string; result?: 'pass' | 'fail'; note?: string; cwd?: string; json?: boolean}) => {
      runSignoffCommand(featureId, opts);
    });

  program
    .command('ingest-receipt <receiptFile>')
    .description('Create-only ingest of one portable receipt. Local CLI trust is empty until a registered host supplies F9 trust.')
    .option('--cwd <path>', 'target project directory (default cwd)')
    .option('--json', 'emit receipt-ingestion details')
    .action((receiptFile: string, opts: {cwd?: string; json?: boolean}) => {
      runIngestReceiptCommand(receiptFile, opts);
    });

  program
    .command('setup')
    .description('Activate Cladding only for the current project (Claude Code / Codex / Gemini / Antigravity / Cursor)')
    .option('--project <path>', 'activate a project other than the current directory')
    .option('--host <host>', 'activate detected hosts (default), all, or one of: claude, codex, gemini, antigravity, cursor')
    .option('--force', 'replace an existing conflicting cladding-owned project entry')
    .option('--quiet', 'suppress stdout output')
    .action(runSetupCommand);

  program
    .command('update')
    .description('Run from a project dir AFTER `npm update -g cladding`: refresh project host wiring + sync inventory + refresh managed CLAUDE.md/AGENTS.md, then report stricter detector findings')
    .action(runUpdateCommand);

  program
    .command('check')
    .description('Run every Iron Law stage and the drift detector suite')
    .option('--internal', 'show stage codes (`stage_1.1`) instead of names (`Type`)')
    .option('--strict', 'promote warn-severity drift findings to errors (CI / pre-publish gate)')
    .option(
      '--tier <tier>',
      'run only the stages for a trigger: pre-commit (drift/arch/secret) | pre-push (+ type/lint/unit/cov/spec-conformance/deliverable-smoke) | all (default; full 15-stage gate, used by CI)',
    )
    .option('--profile <profile>', 'assurance profile: feedback | checkpoint | completion | push | release (legacy tiers remain aliases)')
    .option('--assurance-level <level>', 'one-run level L1 | L2 | L3 | L4; cannot lower the persisted project level')
    .option('--json', 'emit structured per-stage results (machine-readable: findings with file/line/suggestion, untruncated) — for agents/CI; cuts RED→fix round-trips')
    .option('--feature <id>', 'scope the gate to this feature\'s modules[] (Gradle monorepos): runs only :project: tasks instead of the root aggregate. No-op for non-Gradle repos or modules-less features')
    .action(runCheckCommand);

  program
    .command('checkpoint <featureId>')
    .description('Record a checkpoint event pinning git HEAD + spec digest for the feature (iron-law §2.5)')
    .action(runCheckpointCommand);

  program
    .command('done <featureId>')
    .description('Mark a feature done through its completion gate (schema 0.2); schema 0.1 keeps strict pre-push compatibility (flip → gate → revert-on-red).')
    .action(runDoneCommand);

  program
    .command('oracle [featureId]')
    .description('Print the impl-blind oracle authoring brief (acceptance criteria + signatures, never the implementation). Hand it to a fresh blind sub-agent; record the result with clad_author_oracle. cladding calls no LLM. Use --required to list which done ACs the project policy needs an oracle for.')
    .option('--ac <id>', 'restrict the brief to a single acceptance criterion')
    .option('--required', 'list the done ACs the oracle_policy / require_oracles requires an oracle for (worklist), instead of a brief')
    .option('--cwd <path>', 'project root (defaults to .)')
    .action((featureId: string | undefined, opts: {ac?: string; cwd?: string; required?: boolean}) => runOracleCommand(featureId, opts));

  program
    .command('rollback <featureId>')
    .description('Record a rollback event and print the maintainer-runnable git command for the latest checkpoint')
    .option('-r, --reason <reason>', 'optional free-text reason recorded on the event payload')
    .action(runRollbackCommand);

  program
    .command('status')
    .description('Render the feature × stage integrity matrix (business titles; use --internal for raw F-NNN ids)')
    .option('--internal', 'show internal F-NNN ids and stage codes')
    .option('--json', 'emit the row model as JSON — the same feature × stage integrity matrix rendered to the terminal (columns + per-feature glyph cells), one SSoT for terminal, JSON, and the audit bundle')
    .action(runStatusCommand);

  program
    .command('context <query>')
    .description('Print the context slice for one feature — id (F-…), slug, or module path (F-d2c806)')
    .action(runContextCommand);

  program
    .command('impact <query>')
    .description('Print the blast radius for a change — what depends on a feature/file + the tests to re-run (F-7794a6bc)')
    .option('--depth <n>', 'bound the dependent walk to N hops (default: the full transitive radius)')
    .action((query, opts) => runImpactCommand(query, opts));

  program
    .command('verdict')
    .description('One-poll loop decision: DONE|ITERATE|ESCALATE|BLOCKED|BOOTSTRAP over the pre-push strict gate + feature statuses (F-2e28cc72). Single gate touch; DONE requires ≥1 non-liveness proof.')
    .option('--json', 'emit the verdict object as JSON')
    .option('--tier <tier>', 'gate tier (default pre-push)')
    .action((opts) => runVerdictCommand(opts, {checkStages: runCheckStages}));

  program
    .command('infer-deps')
    .description('Suggest feature depends_on edges from the code import graph — the dependency edges cladding never auto-produced (F-2be3e3bb). Prints reviewable suggestions; does not write the spec.')
    .option('--ambiguity <n>', 'emit edges for imports owned by ≤ N features (default 1 = unambiguous single-owner only)')
    .action((opts) => runInferDepsCommand(opts));

  program
    .command('measure')
    .description('Report the search + context efficiency the graph provides per feature — working-set tokens vs the naive baseline, dependency depth/edges resolved, regression-set coverage (F-16138071). Deterministic; no agent.')
    .option('--json', 'emit the full report as JSON')
    .option('--sessions', 'summarize recorded value-delivery telemetry instead — impact-card fire rate over eligible edits, the per-reason skip histogram, and MCP read-serve counts. Measures DELIVERY (did the surfaces fire), NOT adoption (F-6ba22c5c).')
    .option('--trend [n]', 'render the last N (default 5) recorded measure snapshots with signed deltas — spot efficiency drift over time from the deduped .cladding/measure.jsonl ledger (F-39609db4)')
    .action((opts) => runMeasureCommand(opts));

  const graph = program
    .command('graph')
    .description('Render the spec↔code↔doc knowledge graph for a viewer, or report its shape (F-569f4b37)');
  graph
    .command('export')
    .description('Export the graph: mermaid/dot/json to stdout, or an Obsidian vault to --out')
    .option('--format <fmt>', 'mermaid | dot | json | obsidian | html (default: mermaid). json without --focus is the complete schema_version 2 export; html = a single self-contained offline viewer (requires --out)')
    .option('--focus <query>', 'restrict to one node’s bounded, relation-aware projection (canonical address, feature id, slug, or repository path)')
    .option('--depth <n>', 'relation hops from --focus, 1 to 3 (default: 1)')
    .option('--max-nodes <n>', 'maximum nodes the --focus projection may materialize, 1 to 200 (default: 64)')
    .option('--max-edges <n>', 'maximum edges the --focus projection may materialize, 1 to 400 (default: 128)')
    .option('--out <path>', 'write to a file (or, for obsidian, a vault dir — default .cladding/graph)')
    .action((opts) => runGraphExportCommand(opts));
  graph
    .command('stats')
    .description('Report node/edge counts by kind and the top hubs by degree')
    .action(() => runGraphStatsCommand());
  graph
    .command('serve')
    .description('Serve a LIVE graph at localhost — recomputes on each load + auto-reloads on spec/doc changes (F-64a5c159)')
    .option('--port <n>', 'port to listen on (default 3000)')
    .action((opts) => {
      void runGraphServeCommand(opts);
    });

  program
    .command('changelog')
    .description(
      'Render shipped changes since a git ref into human-facing documents (F-904495a5). Default: capability-grouped ' +
        'markdown from feature titles + acceptance sentences (no internal ids). --json emits the deterministic ' +
        'manifest hosts render release notes from; --audit the id-keeping verification table; --catalog the full ' +
        'capability → feature → acceptance catalog.',
    )
    .option('--since <ref>', 'git ref to diff from (default: the latest tag via `git describe --tags --abbrev=0`)')
    .option('--json', 'print the deterministic ChangelogManifest as JSON (byte-identical across runs on the same state)')
    .option('--audit', 'print the audit table — feature | AC | EARS | verification refs, each marked resolved ✓/✗')
    .option('--catalog', 'print the full capability → feature → acceptance listing of the living spec (no git range)')
    .option(
      '--measure',
      "embed the release's own re-derivable measurement — but ONLY a snapshot taken at the current HEAD; " +
        'no match renders a not-measured notice, never an older snapshot (F-ede6fa75)',
    )
    .action((opts: {since?: string; json?: boolean; audit?: boolean; catalog?: boolean; measure?: boolean}) =>
      runChangelogCommand(opts),
    );

  program
    .command('report')
    .description(
      'Render one deterministic review packet for a git range (F-f6cc5e5a) — spec entry movement (from the ' +
        'changelog), how each acceptance criterion moved, changed source files resolved to their owning features ' +
        'via the reverse index, the tests those features declare, the deduped regression set, and gate + ' +
        'attestation state. For PR reviewers, team-leads, and auditors: it RENDERS, it gates nothing. ' +
        'Byte-identical across two runs on the same repository state.',
    )
    .option('--since <ref>', 'git ref to diff from (default: the latest tag via `git describe --tags --abbrev=0`)')
    .option(
      '--format <fmt>',
      'md (default, the six-section markdown packet) | sarif (SARIF 2.1.0 — one result per error/warn drift ' +
        'finding, for code-scanning UIs) | json (the raw deterministic model)',
    )
    .action((opts: {since?: string; format?: string}) => runReportCommand(opts));

  program
    .command('bundle')
    .description(
      'Write ONE self-contained HTML audit bundle (F-e940fffe) a non-coder can double-click — offline, zero ' +
        'network, no CDN, no scripts. Contains the project header + inventory, the feature × stage matrix, the ' +
        'capability catalog, shipped changes for the range, the audit table with resolved refs, and the attestation ' +
        'summary, under a provenance banner (git HEAD, date, version). Deterministic modulo the date stamp. If no ' +
        'anchor ref resolves, the changelog + audit sections show an omitted notice while the rest still renders.',
    )
    .requiredOption('--out <file.html>', 'destination path for the HTML bundle')
    .option('--since <ref>', 'git ref to diff shipped changes from (default: the latest tag via `git describe --tags --abbrev=0`)')
    .action((opts: {out?: string; since?: string}) => runBundleCommand(opts));

  program
    .command('route <prompt>')
    .description('Classify a natural-language prompt to a verb')
    .action(runRouteCommand);

  program
    .command('hook <event>')
    .description(
      'Host hook protocol adapter — consume one host lifecycle event (SessionStart | UserPromptSubmit | ' +
        'PreToolUse | PostToolUse | Stop) as stdin JSON and print the protocol response on stdout. ' +
        'Always exits 0 so a hook failure never bricks the host session.',
    )
    .action(runHookCommand);

  program
    .command('serve')
    .description('Run cladding as an MCP server over stdio — tools/resources/prompts for any MCP client')
    .option('--cwd <path>', 'project directory exposed to the client (default cwd)')
    .action(runServeCommand);

  program
    .command('doctor')
    .description('Diagnose Claude Code hook liveness/version, lifecycle governance, and LLM dispatcher sentinel misses')
    .option('--cwd <path>', 'project directory to read events from (default cwd)')
    .option('--json', 'emit the raw DoctorReport for tooling; default is the human-readable surface')
    .option('--hosts', 'smoke-test host CLIs (Claude Code / Gemini / Antigravity / Codex / Cursor) and project wiring → dated artifact + docs/dogfood/matrix.md. Live LLM prompts run only with consent (CLAD_HOST_SMOKE=1 or --yes); otherwise not-run')
    .option('--yes', 'grant live-run consent for --hosts (equivalent to CLAD_HOST_SMOKE=1)')
    .option('--matrix-only', 'regenerate docs/dogfood/matrix.md from the newest host-smoke artifact without any probing')
    .action((opts) => {
      if (opts.hosts || opts.matrixOnly) {
        runDoctorHosts({cwd: opts.cwd, yes: opts.yes, matrixOnly: opts.matrixOnly});
        return;
      }
      runDoctorCommand(opts);
    });

  program
    .command('clarify [answer...]')
    .description(
      'Advance the onboarding Q&A loop. Pass the user\'s answer to the next pending question as a positional ' +
        '(no quotes needed, free text in any language, e.g. `clad clarify B2B only`); the LLM refines spec/docs based on the full Q-A ' +
        'history and may emit new follow-up questions. Reads/writes `.cladding/onboarding/state.yaml`. Requires ' +
        '`clad init <intent>` to have started a session first.',
    )
    .option('--cwd <path>', 'project directory containing .cladding/onboarding/state.yaml (default cwd)')
    .option('--no-llm', 'force the deterministic interpreter (preserves current artifacts, logs the answer)')
    .option('--json', 'emit the raw RefineReport for tooling; default is the human-readable surface')
    .action(runClarifyCommand);

  return program;
}

// CLI entry — `tsx cli/clad.ts ...` or `node bin/clad ...`.
//
// Unlike helper modules, this file IS the CLI entry, so the bundled
// build (esbuild → dist/clad.js) must always trigger parsing. The
// guard exists only so unit tests can `import` the module to get the
// handler exports without commander touching `process.argv`.
const isBundled = Boolean((globalThis as {__CLADDING_BUNDLED?: boolean}).__CLADDING_BUNDLED);
const isCliEntry = isBundled || import.meta.url === `file://${process.argv[1]}`;
if (isCliEntry) {
  createProgram().parse();
}
