// Cladding · `clad` CLI entry — composes the Iron Core verbs.
//
// Uses `commander` for parsing. Each verb's handler is exported as a
// named function so unit tests can exercise it without spawning a
// subprocess; the top-level `program.parse()` is guarded by
// `isCliEntry` so importing the module from a test does not trigger
// CLI behavior.

import process from 'node:process';
import {readFileSync} from 'node:fs';

import {Command} from 'commander';

import {classifyIntent} from '../router/intent.js';
import {runChangelogCommand} from './changelog.js';
import {runDoctorCommand} from './doctor.js';
import {runDone} from './done.js';
import {runHookCommand} from './hook.js';
import {runUpdate} from './update.js';
import {runInit} from './init.js';
import {runClarifyCommand} from './clarify.js';
import {runHostSetup} from '../init/host-setup.js';
import {recordEvent} from '../events/log.js';
import {buildContextSlice} from '../optimizer/context-slice.js';
import {buildImpactSlice} from '../optimizer/reverse-slice.js';
import {inferDependsOn} from '../optimizer/infer-depends-on.js';
import {measureGraphEfficiency} from '../optimizer/measurement.js';
import {runGraphExportCommand, runGraphStatsCommand} from './graph.js';
import {runGraphServeCommand} from './graph-serve.js';
import {strictSkipViolations} from '../stages/skip-policy.js';
import {runArch} from '../stages/arch.js';
import {runAudit} from '../stages/audit.js';
import {runCommit} from '../stages/commit.js';
import {runCov} from '../stages/cov.js';
import {runDrift} from '../stages/drift.js';
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
import {findLatestCheckpoint, recordCheckpoint, recordRollback} from '../core/checkpoint.js';
import {maintainDeliverable} from '../spec/deliverable-detect.js';
import {computeInventory, writeInventoryToSpecYaml, writeFeatureIndex} from '../spec/inventory.js';
import {writeDocLinksYaml} from '../spec/doc-references.js';
import {repairTestRefs} from '../spec/test-ref-repair.js';
import {writeAttestation} from '../spec/attestation.js';
import {buildBlindPayload, renderBlindBrief} from '../oracle/payload.js';
import {requiredOracleWorklist} from '../oracle/policy.js';
import {loadSpec} from '../spec/load.js';
import {pulse, type PulseKind} from '../ui/pulse.js';
import {renderPanel} from '../ui/panel.js';
import {featureLabel, gateLabel, haltMessage} from '../ui/softShell.js';

/** Handler for `clad serve`. Boots the MCP server over stdio. */
export async function runServeCommand(opts: {cwd?: string}): Promise<void> {
  // Dynamic import: the MCP SDK is sizeable and most `clad` invocations
  // never reach `serve`. Loading it on-demand keeps cold-start fast.
  const [{buildServer}, {StdioServerTransport}, {setHostMcpServer}] = await Promise.all([
    import('../serve/server.js'),
    import('@modelcontextprotocol/sdk/server/stdio.js'),
    import('../adapters/host/sampling-context.js'),
  ]);
  const server = buildServer({cwd: opts.cwd});
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
  for (const c of result.created) pulse('pass', `created ${c}`);
  for (const s of result.skipped) pulse('skip', s);
  for (const p of result.proposals ?? []) pulse('note', 'proposal', p);
  const modeDetail = result.onboardingMode ? `language: ${result.language} · mode: ${result.onboardingMode}` : `language: ${result.language}`;
  pulse('note', 'init done', modeDetail);

  // v0.3.43 — surface LLM-generated clarifying questions so the AI
  // host (or a direct CLI user) sees the next-step prompts that
  // refine the spec. The questions are calibrated to product-owner
  // vocabulary — no implementation jargon.
  if (result.clarifyingQuestions && result.clarifyingQuestions.length > 0) {
    process.stdout.write('\n💡 다음 정보가 있으면 더 정확한 스펙이 됩니다:\n');
    for (const [i, q] of result.clarifyingQuestions.entries()) {
      process.stdout.write(`   ${i + 1}. ${q}\n`);
    }
    process.stdout.write('\n');
  } else if (!intent) {
    // Greenfield + no intent + direct CLI user — emit a gentle hint
    // suggesting the intent-driven path so they can re-run with more
    // context. The orchestrator persona normally asks for intent
    // BEFORE invoking `clad init`, so this hint fires mostly for
    // power users who skip the chat flow.
    const greenfield = result.created.some((c) => c === 'docs/conventions.md');
    if (greenfield) {
      process.stdout.write('\n💡 Tip: 더 정확한 스캐폴드를 원하시면\n');
      process.stdout.write('   clad init <project description>\n');
      process.stdout.write('   예: clad init 결제 SaaS for B2B\n');
      process.stdout.write('   기존 seeds 는 .cladding/scan/*.proposal 로 분기됩니다.\n\n');
    }
  }

  process.exit(0);
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
    // the project's whole scale. ISO-date `last_synced` keeps the
    // file commit-stable across same-day runs.
    const inventory = computeInventory('.');
    writeInventoryToSpecYaml('.', inventory);
    writeFeatureIndex('.'); // F-37b4a8 — 1-file feature lookup at scale
    writeDocLinksYaml('.'); // F-doc-graph — doc→spec/doc link index (Tier C)
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
        `auto-detected entry '${autoDeliverable.path}' — the gate now smoke-tests it (stage_2.4). Opt out with is_safe_to_smoke: false.`,
      );
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

/** Handler for `clad setup`. Wires cladding into installed AI tool host channels. */
export async function runSetupCommand(opts: {force?: boolean; quiet?: boolean}): Promise<void> {
  const result = await runHostSetup({force: opts.force, quiet: opts.quiet});
  process.exit(result.errors.length > 0 ? 1 : 0);
}

/**
 * Handler for `clad update`. The one-command "after you upgraded the engine"
 * step, run from INSIDE the project you want to reconcile: re-wire hosts +
 * reconcile the spec inventory + refresh the managed CLAUDE.md/AGENTS.md section
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
    wireHosts: async () => (await runHostSetup({quiet: true})).errors.length,
  });
  pulse(r.wiringErrors > 0 ? 'fail' : 'pass', 'hosts', r.wiringErrors > 0 ? `${r.wiringErrors} wiring error(s)` : 're-wired');
  if (!r.isProject) {
    pulse('skip', 'spec', 'no spec.yaml here — run `clad init` to put this project under cladding');
    process.exit(r.code);
    return;
  }
  pulse('pass', 'spec', `inventory synced · ${r.features} features`);
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

/** Outcome of running a tier's stages — exported so `clad done` can gate on
 *  the identical code path `clad check` uses (not a weaker re-implementation). */
export interface CheckOutcome {
  /** Worst exit code across the run stages (0 = all green/skip). */
  readonly worst: number;
  /** True when at least one stage RAN and failed (exitCode 1). */
  readonly anyFailed: boolean;
}

/**
 * Runs a tier's Iron Law stages in-process and reports the worst exit code.
 * Shared by `clad check` (which wraps it with `process.exit`) and `clad done`
 * (which gates the status flip on it), so the two verify against the SAME stage
 * pipeline.
 */
export function runCheckStages(opts: {internal?: boolean; strict?: boolean; tier?: string; json?: boolean; focusModules?: readonly string[]}): CheckOutcome {
  const tier = opts.tier ?? 'all';
  const allowed = TIER_STAGES[tier];
  if (!allowed) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({tier, error: `unknown tier '${tier}'`, worst: 2, anyFailed: true, stages: []}, null, 2)}\n`);
    } else {
      pulse('fail', 'check', `unknown --tier '${tier}' (expected: pre-commit | pre-push | all)`);
    }
    return {worst: 2, anyFailed: true};
  }
  // Focus-feature module scope (Gradle monorepos): forwarded to every command
  // stage and to the drift suite so the coverage detector reads per-module
  // reports. Empty/absent → whole-repo (the unchanged default). @see toolchain/scoped-command.ts
  const base: {focusModules?: readonly string[]} = {focusModules: opts.focusModules};
  const allStages = [
    ['stage_1.1', () => runType(base)],
    ['stage_1.2', () => runLint(base)],
    ['stage_1.3', () => runDrift({...base, strict: opts.strict})],
    ['stage_1.4', runCommit],
    ['stage_1.5', runArch],
    ['stage_1.6', runSecret],
    ['stage_2.1', () => runUnit(base)],
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
  const collected: {stage: string; label: string; status: GateStatus; exitCode: number; stderr?: string; findings?: readonly DriftFinding[]}[] = [];
  for (const [name, run] of stages) {
    const r = run({}) as {
      pass: boolean;
      exitCode: number;
      stderr?: string;
      findings?: readonly DriftFinding[];
      disposition?: Disposition;
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
    collected.push({stage: name, label, status, exitCode: r.exitCode, stderr: r.stderr, findings: r.findings});
    if (!opts.json) {
      pulse(pulseKindOf(status), label);
      if (isBlocking(status)) printStageDetails(r);
    }
  }
  // STRICT SKIP-POLICY (F-67d2e9, generalizes the 0.5.x unit-only guard).
  // Under --strict, a skipped stage the spec DEMANDS is a fail: 1.1 when a
  // declared language ships done features, 2.1 when done features declare
  // test_refs, 2.3 when done ACs declare oracle_refs, 2.4 when a declared-
  // safe deliverable ships. Demand-gated — no demand keeps the lenient
  // skip-as-pass contract; spec load failure yields no violations (ABSENCE_OF_
  // GOVERNANCE owns that blocking signal). Table pinned in the gate golden matrix.
  if (opts.strict) {
    try {
      const spec = loadSpec();
      for (const v of strictSkipViolations(spec, collected)) {
        worst = Math.max(worst, 1);
        anyFailed = true;
        collected.push({stage: v.stage, label: v.label, status: 'fail', exitCode: 1, stderr: v.message});
        if (!opts.json) pulse('fail', v.label, v.message);
      }
    } catch {
      /* spec unreadable → other detectors own it; don't block here */
    }
  }
  // F-a5228c — verification attestation. Two halves:
  //   EXEMPT  — when this strict pre-push/all run is RED *solely* from
  //             STALE_ATTESTATION findings while every other stage passed,
  //             count it GREEN: this very run IS the re-verification the
  //             staleness demanded (otherwise re-attestation deadlocks on
  //             its own warning). The cheap pre-commit tier gets no
  //             exemption — there, staleness correctly says "run the full gate".
  //   STAMP   — a GREEN strict pre-push/all run writes spec/attestation.yaml
  //             (module tree-hashes per done feature), the committed,
  //             clone-portable freshness anchor STALE_ATTESTATION compares.
  if (opts.strict && (tier === 'pre-push' || tier === 'all')) {
    const drift = collected.find((c) => c.stage === 'stage_1.3');
    const strictFailing = (drift?.findings ?? []).filter((f) => f.severity === 'error' || f.severity === 'warn');
    const solelyStale =
      drift?.status === 'fail' &&
      strictFailing.length > 0 &&
      strictFailing.every((f) => f.detector === 'STALE_ATTESTATION');
    const othersGreen = collected.every((c) => c.stage === 'stage_1.3' || !isBlocking(c.status));
    if (solelyStale && othersGreen && drift) {
      drift.status = 'pass';
      drift.exitCode = 0;
      drift.stderr = 'stale attestation exempted — this run re-verified and re-attests';
      anyFailed = collected.some((c) => isBlocking(c.status));
      worst = anyFailed ? Math.max(1, worst) : 0;
      if (!opts.json) pulse('note', 'attestation', 'stale entries re-verified by this run — re-attesting');
    }
    if (!anyFailed) {
      try {
        if (writeAttestation('.', loadSpec())) {
          if (!opts.json) pulse('note', 'attestation', 'spec/attestation.yaml refreshed (verified tree stamped)');
        }
      } catch {
        /* unloadable spec → nothing to attest */
      }
    }
  }
  if (opts.json) {
    // Machine-readable, UNTRUNCATED — findings carry file/line/suggestion so an
    // agent fixes in one pass instead of re-running to discover where + what.
    process.stdout.write(`${JSON.stringify({tier, worst, anyFailed, stages: collected}, null, 2)}\n`);
  } else if (anyFailed) {
    process.stdout.write('\nℹ Run `clad doctor` for the event log, or `clad sync` to validate spec shards. Drift findings above name the offending detector.\n');
  }
  // F-b84c38 — verification freshness needs a data source: every tier run
  // lands in the ledger (best-effort, deduped per identical HEAD/tier/strict/
  // worst tuple so repeated identical runs add no growth).
  recordEvent('.', 'gate_run', {tier, strict: opts.strict === true, worst, anyFailed});
  return {worst, anyFailed};
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
    const slice = buildImpactSlice(spec, query, {depth});
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
    const result = inferDependsOn(spec, read, ambiguity !== undefined ? {maxOwnerAmbiguity: ambiguity} : {});
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
 */
export function runMeasureCommand(opts: {json?: boolean} = {}): void {
  try {
    const spec = loadSpec();
    const read = (p: string): string | null => {
      try {
        return readFileSync(p, 'utf8');
      } catch {
        return null;
      }
    };
    const r = measureGraphEfficiency(spec, read, '.');
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    } else {
      const lines = [
        `graph efficiency · ${r.measured}/${r.featureCount} features`,
        `  context: working-set ${r.context.medianSliceTokens} tok vs naive ${r.context.medianNaiveTokens} tok = ${r.context.medianShrinkFactor}x smaller (median)`,
        `  search:  median ${r.search.medianDepth} hop(s) resolved (p95 ${r.search.p95Depth}), median ${r.search.medianEdges} edge(s)/feature (max hub ${r.search.maxEdges})`,
        `  stability: median blast-radius coverage ${r.stability.medianCoverage}, median ${r.stability.medianRegressionTests} regression test(s) surfaced; stops ${JSON.stringify(r.stability.byStopReason)}`,
        `  (deterministic upper bound vs the shard+all-modules baseline — not an agent-adoption measurement)`,
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }
    process.exit(0);
  } catch (err) {
    pulse('fail', 'measure', (err as Error).message);
    process.exit(1);
  }
}

export function runCheckCommand(opts: {internal?: boolean; strict?: boolean; tier?: string; json?: boolean; feature?: string}): void {
  let focusModules: readonly string[] | undefined;
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
    } catch (err) {
      pulse('fail', 'check', (err as Error).message);
      process.exit(1);
    }
  }
  process.exit(runCheckStages({...opts, focusModules}).worst);
}

/**
 * Handler for `clad done <featureId>`. Gates the `status: done` transition on a
 * GREEN `clad check --tier=pre-push --strict` (flip → gate → keep-or-revert),
 * so `done` cannot claim more than the gate verifies. @see cli/done.ts
 */
export function runDoneCommand(featureId: string): void {
  const r = runDone('.', featureId, {checkStages: runCheckStages, onIndex: writeFeatureIndex});
  pulse(r.ok ? 'pass' : 'fail', `done · ${featureId}`, r.reason);
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

function printStageDetails(r: {
  stderr?: string;
  findings?: readonly {detector: string; severity: string; message: string; path?: string}[];
}): void {
  if (r.findings && r.findings.length > 0) {
    const errors = r.findings.filter((f) => f.severity === 'error');
    const warns = r.findings.filter((f) => f.severity === 'warn');
    const surface = errors.length > 0 ? errors : warns;
    for (const f of surface.slice(0, 3)) {
      const where = f.path ? ` ${f.path}` : '';
      process.stdout.write(`    [${f.detector}]${where} — ${truncate(f.message, 140)}\n`);
    }
    if (surface.length > 3) {
      process.stdout.write(`    … and ${surface.length - 3} more finding(s)\n`);
    }
    return;
  }
  if (r.stderr && r.stderr.trim().length > 0) {
    const first = r.stderr.split('\n').find((l) => l.trim().length > 0);
    if (first) {
      process.stdout.write(`    ${truncate(first.trim(), 160)}\n`);
    }
  }
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Handler for `clad status` (formerly `panel`). Renders the feature × stage integrity matrix. */
export function runStatusCommand(opts: {internal?: boolean}): void {
  const spec = loadSpec();
  process.stdout.write(`${renderPanel(spec, '.', {internal: opts.internal})}\n`);
  process.exit(0);
}

/** Handler for `clad route <prompt>`. Classifies natural language → verb. */
export function runRouteCommand(prompt: string): void {
  const intent = classifyIntent(prompt);
  pulse('note', `route → ${intent}`, prompt);
  process.exit(intent === 'unknown' ? 1 : 0);
}

/**
 * 0.6.0 verb renames (alias-and-deprecate, docs/glossary.md). Commander keeps
 * the old spellings working via `.alias()`; this map only powers the one-line
 * stderr deprecation notice. The old verbs are removed in 0.7.
 */
export const RENAMED_VERBS: Readonly<Record<string, string>> = {
  refine: 'clarify',
  panel: 'status',
  drive: 'run',
};

/**
 * Prints the one-line deprecation notice when the invoked verb is a 0.6.0
 * alias (`clad panel` → "'panel' is now 'status'"). stderr, never stdout —
 * `--json` consumers and MCP stdio traffic stay clean.
 */
export function printVerbDeprecationNotice(verb: string | undefined): void {
  const replacement = verb ? RENAMED_VERBS[verb] : undefined;
  if (!replacement) return;
  process.stderr.write(
    `cladding: '${verb}' is now '${replacement}' — the old verb is removed in 0.7\n`,
  );
}

/**
 * Builds the commander Program with every verb wired up. Exported so
 * unit tests can invoke specific subcommands via
 * `createProgram().parse([verb, ...args], {from: 'user'})` without
 * touching `process.argv`.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name('clad').description('Reference Ironclad CLI').version('0.6.3');

  program
    .command('init [intent...]')
    .description(
      'Scaffold a cladding workspace. Pass a free-text project description as positional argument ' +
        '(e.g. `clad init 결제 SaaS for B2B`) to drive intent-aware onboarding — the LLM dispatcher then ' +
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
    .action(runInitCommand);

  program
    .command('run [goal]')
    .alias('drive') // 0.6.0 rename — `drive` is removed in 0.7
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
    .command('setup')
    .description('Wire cladding into installed AI tool host channels (Claude Code / Codex / Gemini)')
    .option('--force', 'overwrite directory-copy wires (Windows fallback) even when changes detected')
    .option('--quiet', 'suppress stdout output')
    .action(runSetupCommand);

  program
    .command('update')
    .description('Run from a project dir AFTER `npm update -g cladding`: re-wire hosts + sync inventory + refresh the managed CLAUDE.md/AGENTS.md section, then report (without blocking) what the now-stricter detectors flag')
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
    .option('--json', 'emit structured per-stage results (machine-readable: findings with file/line/suggestion, untruncated) — for agents/CI; cuts RED→fix round-trips')
    .option('--feature <id>', 'scope the gate to this feature\'s modules[] (Gradle monorepos): runs only :project: tasks instead of the root aggregate. No-op for non-Gradle repos or modules-less features')
    .action(runCheckCommand);

  program
    .command('checkpoint <featureId>')
    .description('Record a checkpoint event pinning git HEAD + spec digest for the feature (iron-law §2.5)')
    .action(runCheckpointCommand);

  program
    .command('done <featureId>')
    .description('Mark a feature done ONLY if `clad check --tier=pre-push --strict` is GREEN (flip → gate → revert-on-red). Keeps `done` honest.')
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
    .alias('panel') // 0.6.0 rename — `panel` is removed in 0.7
    .description('Render the feature × stage integrity matrix (business titles; use --internal for raw F-NNN ids)')
    .option('--internal', 'show internal F-NNN ids and stage codes')
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
    .command('infer-deps')
    .description('Suggest feature depends_on edges from the code import graph — the dependency edges cladding never auto-produced (F-2be3e3bb). Prints reviewable suggestions; does not write the spec.')
    .option('--ambiguity <n>', 'emit edges for imports owned by ≤ N features (default 1 = unambiguous single-owner only)')
    .action((opts) => runInferDepsCommand(opts));

  program
    .command('measure')
    .description('Report the search + context efficiency the graph provides per feature — working-set tokens vs the naive baseline, dependency depth/edges resolved, regression-set coverage (F-16138071). Deterministic; no agent.')
    .option('--json', 'emit the full per-feature report as JSON')
    .action((opts) => runMeasureCommand(opts));

  const graph = program
    .command('graph')
    .description('Render the spec↔code↔doc knowledge graph for a viewer, or report its shape (F-569f4b37)');
  graph
    .command('export')
    .description('Export the graph: mermaid/dot/json to stdout, or an Obsidian vault to --out')
    .option('--format <fmt>', 'mermaid | dot | json | obsidian | html (default: mermaid). html = a single self-contained offline viewer (requires --out)')
    .option('--focus <query>', 'restrict to a feature/file node’s neighborhood (id, slug, or module path)')
    .option('--depth <n>', 'neighborhood radius around --focus (default: unbounded)')
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
    .action((opts: {since?: string; json?: boolean; audit?: boolean; catalog?: boolean}) => runChangelogCommand(opts));

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
    .description('Summarise .cladding/events.log.jsonl — sentinel-miss frequency by phase/cause/fallback plus the top missed sentinels (LLM dispatcher health check)')
    .option('--cwd <path>', 'project directory to read events from (default cwd)')
    .option('--json', 'emit the raw DoctorReport for tooling; default is the human-readable surface')
    .action(runDoctorCommand);

  program
    .command('clarify [answer...]')
    .alias('refine') // 0.6.0 rename — `refine` is removed in 0.7
    .description(
      'Advance the onboarding Q&A loop. Pass the user\'s answer to the next pending question as a positional ' +
        '(no quotes needed, e.g. `clad clarify 법인 사업자만`); the LLM refines spec/docs based on the full Q-A ' +
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
  printVerbDeprecationNotice(process.argv[2]);
  createProgram().parse();
}
