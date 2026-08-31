// Cladding · `clad clarify <answer>` — Q&A onboarding loop driver (verb renamed from `refine` in 0.6.0)
//
// After `clad init <intent>` writes `.cladding/onboarding/state.yaml`
// with the LLM's clarifying questions, the orchestrator persona asks
// the user each pending question one at a time. The user's reply is
// forwarded as `clad clarify <answer>` — this handler:
//
//   1. Loads the state file (errors out gracefully if absent).
//   2. Marks the first pending question answered.
//   3. Reads the current artifact bodies on disk.
//   4. Calls the LLM with the full Q-A history + current bodies and
//      receives refined artifact bodies + any new questions.
//   5. Publishes active SSoT bodies through the shared compatibility journal;
//      user-authored designs divert to `.cladding/scan/*.proposal`.
//   6. Appends new questions to the state file (`appendNewQuestions`
//      de-duplicates) and marks `status: done` when nothing remains.
//
// The handler never throws — telemetry under `phase: 'onboarding'`
// captures every fallback path so `clad doctor` surfaces the gap.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import process from 'node:process';

import {selectDispatcher} from './scan/dispatcher.js';
import {
  appendNewQuestions,
  artifactsAreUntouched,
  captureArtifactDigests,
  firstPendingIndex,
  isComplete,
  loadState,
  markDone,
  markFirstPendingAnswered,
  saveState,
  type OnboardingState,
  type OnboardingReviewBase,
} from './scan/onboarding-state.js';
import {
  interpretRefinementWithFallback,
  type OnboardingObserved,
  type OnboardingResult,
  type RefinementCurrent,
  type RefinementQa,
} from './scan/intent-onboarding.js';
import {pulse} from '../ui/pulse.js';
import {isReadableShardFilename} from '../spec/compiler/id-policy.js';
import {commitSchema01CompatibilityMutation, type Schema01CompatibilityReplacement} from '../spec/edit.js';
import type {ScanLlmDispatcher} from './scan/llm.js';

export interface RefineCommandOptions {
  readonly cwd?: string;
  /** Emit a structured `RefineReport` JSON instead of the formatted text. */
  readonly json?: boolean;
  /** Force the deterministic interpreter (matches `clad init --no-llm`). */
  readonly noLlm?: boolean;
  /** Host-produced refinement response; used by the MCP prepare/apply flow. */
  readonly hostDispatcher?: ScanLlmDispatcher;
  /** Deterministic state-persistence fault hook used only by the transaction regression tests. */
  readonly testFailStateSave?: boolean;
  /** Deterministic concurrent-writer seam after active refinement planning. */
  readonly testBeforeCanonicalCommit?: () => void;
}

/** Wire format for `clad clarify --json`. */
export interface RefineReport {
  readonly cwd: string;
  readonly answered: {readonly question: string; readonly answer: string} | null;
  readonly newQuestions: readonly string[];
  readonly mode: OnboardingResult['mode'] | null;
  readonly status: OnboardingState['status'];
  readonly nextQuestion: string | null;
  readonly remainingQuestions: number;
  readonly pendingReview?: readonly string[];
}

/** Process-independent result used by both the CLI and MCP boundaries. */
export interface RefineOutcome {
  readonly ok: boolean;
  readonly code: 0 | 1 | 2;
  readonly report?: RefineReport;
  readonly error?: string;
  readonly message?: string;
  /** Canonical artifacts committed but onboarding state could not be advanced. */
  readonly partial?: boolean;
  readonly source?: OnboardingResult['source'];
  readonly created: readonly string[];
  readonly proposals: readonly string[];
}

export interface ResolveOnboardingReviewOutcome {
  readonly ok: boolean;
  readonly changed: boolean;
  readonly status?: OnboardingState['status'];
  readonly remaining?: readonly string[];
  readonly error?: string;
}

/** Applies one onboarding answer without writing to stdout or exiting. */
export async function refineOnboarding(
  answer: string,
  opts: Omit<RefineCommandOptions, 'json'> = {},
): Promise<RefineOutcome> {
  const cwd = opts.cwd ?? '.';
  let state: OnboardingState | null;
  try {
    state = loadState(cwd);
  } catch (err) {
    return {ok: false, code: 1, error: (err as Error).message, created: [], proposals: []};
  }
  if (state === null) {
    return {
      ok: false,
      code: 2,
      error: 'no onboarding session — initialize Cladding with a project intent first',
      created: [],
      proposals: [],
    };
  }
  if (state.status === 'done') {
    return {
      ok: true,
      code: 0,
      message: 'onboarding already complete (state.yaml status: done)',
      report: buildReport(cwd, null, [], null, state),
      created: [],
      proposals: [],
    };
  }

  const pendingIdx = firstPendingIndex(state);
  if (pendingIdx === -1) {
    const done = markDone(state);
    saveState(cwd, done);
    return {
      ok: true,
      code: 0,
      message: 'onboarding complete · state.yaml marked done',
      report: buildReport(cwd, null, [], null, done),
      created: [],
      proposals: [],
    };
  }
  if (!answer.trim()) {
    return {
      ok: false,
      code: 2,
      error: `provide an answer for: "${state.qa[pendingIdx].question}"`,
      created: [],
      proposals: [],
    };
  }

  const normalizedAnswer = answer.trim();
  const stateAfterAnswer = markFirstPendingAnswered(state, normalizedAnswer);
  const projectName = stateAfterAnswer.projectName || basename(resolve(cwd));
  const observed: OnboardingObserved = {
    cwdBasename: basename(resolve(cwd)),
    language: stateAfterAnswer.language,
    sourceFileCount: 0,
    readmePresent: false,
    readmeFirstParagraph: null,
    projectName,
  };
  const prepared = loadCurrentArtifacts(cwd);
  const current = prepared.current;
  const qaHistory: RefinementQa[] = stateAfterAnswer.qa.flatMap((qa) =>
    qa.answer === null ? [] : [{question: qa.question, answer: qa.answer}],
  );
  const dispatcher = opts.hostDispatcher ?? selectDispatcher({noLlm: opts.noLlm});
  const refined = await interpretRefinementWithFallback(
    stateAfterAnswer.intent,
    observed,
    qaHistory,
    current,
    dispatcher,
    cwd,
  );

  const proposals: string[] = [];
  const created: string[] = [];
  const applyToActiveDesign = artifactsAreUntouched(cwd, state);
  const scenarioPaths = refined.scenarios.map((scenario) =>
    `spec/scenarios/${scenario.slug}-${scenario.id.replace(/^S-/, '')}.yaml`);
  // Scenario bodies are outputs rather than LLM prompt inputs, but they are
  // still canonical targets. Capture their absent-vs-empty preimages once at
  // plan preparation, never by rereading just before the transaction.
  const planBefore = {
    ...prepared.before,
    ...Object.fromEntries(scenarioPaths.map((path) => [path, readArtifactOrNull(cwd, path)])),
  };
  let updated: OnboardingState = appendNewQuestions(stateAfterAnswer, refined.clarifyingQuestions);
  let canonicalCommitted = false;
  try {
    const artifacts = [
      {path: 'docs/project-context.md', body: refined.projectContextMd},
      {path: 'spec/architecture.yaml', body: refined.architectureYaml},
      {path: 'spec/capabilities.yaml', body: refined.capabilitiesYaml},
      ...refined.scenarios.map((scenario, index) => ({path: scenarioPaths[index], body: renderScenarioYaml(scenario)})),
    ];
    if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
      throw new Error('onboarding refinement proposed duplicate managed artifact paths');
    }
    if (applyToActiveDesign) {
      // Active design artifacts are canonical SSoT. They share the same
      // version check, byte-before precondition, journal, and replacement
      // boundary as every other remaining schema-0.1 writer.
      const replacements = artifactReplacements(artifacts, planBefore);
      opts.testBeforeCanonicalCommit?.();
      commitSchema01CompatibilityMutation(cwd, replacements);
      canonicalCommitted = true;
      created.push(...replacements.map((replacement) => replacement.before === null ? replacement.path : `${replacement.path} (refined)`));
    } else {
      for (const artifact of artifacts) writeOnboardingProposal(cwd, artifact.path, artifact.body, proposals);
      const reviewBases = captureReviewBases(cwd, artifacts.map((artifact) => artifact.path), planBefore);
      // A proposal belongs to the exact canonical generation it was derived
      // from. A later review may never treat its then-current target as the
      // proposal base merely because that target was reread at apply time.
      updated = {
        ...updated,
        status: 'needs_review',
        pendingReview: ['docs/project-context.md', 'spec/architecture.yaml', 'spec/capabilities.yaml', ...scenarioPaths],
        pendingReviewBases: reviewBases,
      };
    }

    if (applyToActiveDesign) {
      updated = {...updated, artifactDigests: captureArtifactDigests(cwd)};
      if (refined.clarifyingQuestions.length === 0 && isComplete(updated)) updated = markDone(updated);
    }
    saveOnboardingState(cwd, updated, opts.testFailStateSave);
  } catch (error) {
    return {
      ok: false, code: 1,
      error: canonicalCommitted
        ? `onboarding refinement committed the active design but could not advance onboarding state; retry the state update: ${(error as Error).message}`
        : `onboarding refinement failed before its specification transaction could commit: ${(error as Error).message}`,
      ...(canonicalCommitted ? {partial: true, created, proposals} : {created: [], proposals: []}),
    };
  }
  const answeredQa = stateAfterAnswer.qa[pendingIdx];
  return {
    ok: true,
    code: 0,
    report: buildReport(
      cwd,
      {question: answeredQa.question, answer: normalizedAnswer},
      refined.clarifyingQuestions,
      refined.mode,
      updated,
    ),
    source: refined.source,
    created,
    proposals,
  };
}

/** Applies explicitly reviewed proposal bodies and re-enters or completes onboarding. */
export function resolveOnboardingReview(
  targets: readonly string[],
  opts: {readonly cwd?: string; readonly testFailStateSave?: boolean; readonly testBeforeCanonicalCommit?: () => void} = {},
): ResolveOnboardingReviewOutcome {
  const cwd = opts.cwd ?? '.';
  const state = loadState(cwd);
  if (!state || state.status !== 'needs_review' || !state.pendingReview?.length) {
    return {ok: false, changed: false, error: 'no onboarding design review is pending'};
  }
  const requested = [...new Set(targets)];
  if (requested.length === 0 || requested.some((target) => !state.pendingReview!.includes(target))) {
    return {ok: false, changed: false, error: 'targets must be selected from the pending onboarding review'};
  }
  if (requested.some((target) => !isOnboardingReviewTarget(target))) {
    return {ok: false, changed: false, error: 'review targets must be Cladding onboarding design artifacts'};
  }
  const pairs = requested.map((target) => ({
    target,
    proposal: `.cladding/scan/${basename(target)}.proposal`,
  }));
  const missing = pairs.filter(({proposal}) => !existsSync(join(cwd, proposal))).map(({target}) => target);
  if (missing.length > 0) {
    return {ok: false, changed: false, error: `proposal missing for: ${missing.join(', ')}`};
  }
  const bases = state.pendingReviewBases;
  if (!bases || requested.some((target) => bases[target] === undefined)) {
    return {ok: false, changed: false, error: 'review proposal lacks its generation base; regenerate the proposal before applying it'};
  }
  const checked = requested.map((target) => ({target, before: readArtifactOrNull(cwd, target)}));
  const stale = checked.find(({target, before}) => !matchesReviewBase(before, bases[target]!));
  if (stale) {
    return {ok: false, changed: false, error: `review target changed after proposal generation: ${stale.target}`};
  }
  let canonicalCommitted = false;
  try {
    // Review confirmation changes canonical artifacts. Treat the selected
    // proposal bodies as an optimistic source and atomically publish every
    // selected SSoT artifact, rejecting a schema-0.2 migration race.
    opts.testBeforeCanonicalCommit?.();
    commitSchema01CompatibilityMutation(cwd, pairs.map(({target, proposal}) => ({
      path: target,
      before: checked.find((candidate) => candidate.target === target)!.before,
      after: readFileSync(join(cwd, proposal), 'utf8'),
    })));
    canonicalCommitted = true;
    const remaining = state.pendingReview.filter((target) => !requested.includes(target));
    let updated: OnboardingState = {
      ...state,
      status: remaining.length > 0 ? 'needs_review' : firstPendingIndex(state) >= 0 ? 'active' : 'done',
      pendingReview: remaining.length > 0 ? remaining : undefined,
      pendingReviewBases: remaining.length > 0
        ? Object.fromEntries(remaining.map((target) => [target, bases[target]!]))
        : undefined,
    };
    updated = {...updated, artifactDigests: captureArtifactDigests(cwd)};
    // Keep proposals until the non-SSoT state advances. A retry after this
    // point can safely reapply the same byte-bound candidate; deleting first
    // would lose the review body while reporting a failed review.
    saveOnboardingState(cwd, updated, opts.testFailStateSave);
    for (const {proposal} of pairs) {
      try { rmSync(join(cwd, proposal), {force: true}); } catch { /* State is authoritative; leftover proposal is harmless cleanup. */ }
    }
    return {ok: true, changed: true, status: updated.status, remaining};
  } catch (error) {
    return {
      ok: false,
      changed: canonicalCommitted,
      error: canonicalCommitted
        ? `review specification transaction committed but onboarding state remains pending; retry the review: ${(error as Error).message}`
        : `review apply failed before its specification transaction could commit: ${(error as Error).message}`,
    };
  }
}

function isOnboardingReviewTarget(target: string): boolean {
  return target === 'docs/project-context.md' ||
    target === 'spec/architecture.yaml' ||
    target === 'spec/capabilities.yaml' ||
    isReadableShardFilename('scenario', target);
}

/** Builds byte-bound canonical writes for the schema-0.1 compatibility journal. */
function artifactReplacements(
  artifacts: readonly {readonly path: string; readonly body: string}[],
  before: Readonly<Record<string, string | null>>,
): readonly Schema01CompatibilityReplacement[] {
  return artifacts.map((artifact) => ({
    path: artifact.path,
    before: before[artifact.path] ?? null,
    after: artifact.body,
  }));
}

/** Reads exact previous artifact bytes for an optimistic compatibility write. */
function readArtifactOrNull(cwd: string, relativePath: string): string | null {
  const path = join(cwd, relativePath);
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Persists non-SSoT onboarding state with a deterministic fault seam for recovery tests. */
function saveOnboardingState(cwd: string, state: OnboardingState, fail: boolean | undefined): void {
  if (fail) throw new Error('InjectedOnboardingStateWriteFailure');
  saveState(cwd, state);
}

/**
 * Handler for `clad clarify [answer...]`. The positional argument is
 * joined with spaces so users can pass natural-language answers in any
 * language without quoting: `clad clarify B2B only (no sole proprietors)`.
 *
 * Exit codes:
 *   0 — answer accepted (or no-op when state is already `status: done`)
 *   1 — fatal error (corrupt state file)
 *   2 — usage error (no state file present, or no answer provided
 *       while a pending question exists)
 */
export async function runClarifyCommand(
  answerTokens: readonly string[] | undefined,
  opts: RefineCommandOptions = {},
): Promise<void> {
  const answer = (answerTokens ?? []).join(' ').trim();
  const outcome = await refineOnboarding(answer, {cwd: opts.cwd, noLlm: opts.noLlm});
  if (!outcome.ok) {
    pulse('fail', 'clarify', outcome.error!);
    process.exit(outcome.code);
    return;
  }
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(outcome.report, null, 2)}\n`);
    process.exit(0);
    return;
  }
  if (outcome.message) pulse('note', 'clarify', outcome.message);
  if (outcome.source && outcome.report) {
    pulse('pass', 'clarify', `answered · mode: ${outcome.report.mode} · source: ${outcome.source}`);
  }
  for (const c of outcome.created) pulse('pass', `created ${c}`);
  for (const p of outcome.proposals) pulse('note', 'proposal', p);

  const prompts = renderClarifyPrompts(outcome.report);
  if (prompts) process.stdout.write(prompts);
  process.exit(0);
}

/**
 * Renders the system-authored completion guidance for `clad clarify`.
 * Follow-up questions are model-authored data and remain verbatim, including
 * in the user's language; the CLI framing stays English single-source.
 *
 * @param report Structured clarification outcome, if one was produced.
 * @returns A complete stdout fragment, or an empty string when no prompt applies.
 * @see spec/features/init-onboarding-english-source-5cac007a.yaml AC-f12ce851
 */
export function renderClarifyPrompts(
  report: Pick<RefineReport, 'newQuestions' | 'remainingQuestions' | 'status'> | undefined,
): string {
  if (!report) return '';
  if (report.newQuestions.length > 0) {
    const lines = [
      '',
      '💡 Next questions:',
      ...report.newQuestions.map((question, index) => `   ${index + 1}. ${question}`),
    ];
    if (report.remainingQuestions > 0) {
      lines.push('', `${report.remainingQuestions} question(s) left · Continue with \`clad clarify <answer>\`.`, '', '');
    } else {
      lines.push('');
    }
    return lines.join('\n');
  }
  if (report.status === 'done') {
    return [
      '',
      '✓ All questions answered — onboarding complete.',
      "  Next: author your first feature's spec — its acceptance criteria (the testable promises) and the files it will cover — before writing code. The feature cycle starts there.",
      '',
      '',
    ].join('\n');
  }
  if (report.remainingQuestions > 0) {
    return [
      '',
      `${report.remainingQuestions} question(s) left. Continue with \`clad clarify <answer>\`.`,
      '',
      '',
    ].join('\n');
  }
  return '';
}

function buildReport(
  cwd: string,
  answered: {question: string; answer: string} | null,
  newQuestions: readonly string[],
  mode: OnboardingResult['mode'] | null,
  state: OnboardingState,
): RefineReport {
  return {
    cwd,
    answered,
    newQuestions,
    mode,
    status: state.status,
    nextQuestion: state.qa.find((qa) => qa.answer === null)?.question ?? null,
    remainingQuestions: state.qa.filter((qa) => qa.answer === null).length,
    pendingReview: state.pendingReview,
  };
}

function loadCurrentArtifacts(cwd: string): {readonly current: RefinementCurrent; readonly before: Readonly<Record<string, string | null>>} {
  const before = Object.fromEntries([
    'docs/project-context.md',
    'spec/capabilities.yaml',
    'spec/architecture.yaml',
  ].map((path) => [path, readArtifactOrNull(cwd, path)]));
  return {
    current: {
      projectContextMd: before['docs/project-context.md'] ?? '',
      capabilitiesYaml: before['spec/capabilities.yaml'] ?? '',
      architectureYaml: before['spec/architecture.yaml'] ?? '',
    },
    before,
  };
}

function captureReviewBases(
  cwd: string,
  targets: readonly string[],
  prepared: Readonly<Record<string, string | null>>,
): Readonly<Record<string, OnboardingReviewBase>> {
  return Object.fromEntries(targets.map((target) => {
    const before = target in prepared ? prepared[target]! : readArtifactOrNull(cwd, target);
    return [target, reviewBase(before)];
  }));
}

function reviewBase(before: string | null): OnboardingReviewBase {
  return before === null
    ? {absent: true}
    : {sha256: createHash('sha256').update(before).digest('hex')};
}

function matchesReviewBase(before: string | null, base: OnboardingReviewBase): boolean {
  if (base.absent === true) return before === null;
  return before !== null && base.sha256 === createHash('sha256').update(before).digest('hex');
}

/** Writes a non-SSoT review proposal; canonical artifacts are never written here. */
function writeOnboardingProposal(cwd: string, relPath: string, body: string, proposals: string[]): void {
  const proposal = join(cwd, '.cladding', 'scan', `${basename(relPath)}.proposal`);
  mkdirSync(dirname(proposal), {recursive: true});
  writeFileSync(proposal, body);
  proposals.push(`${relPath} → .cladding/scan/${basename(relPath)}.proposal`);
}

/**
 * Renders one onboarding scenario as a YAML shard. Identical body
 * shape to {@link init.ts::renderScenarioYaml}; duplicated here to
 * keep clarify independent of init internals (and because Tier A
 * scenario YAML is small).
 */
function renderScenarioYaml(scenario: {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly flow: string;
  readonly features: readonly string[];
}): string {
  const escapedTitle = scenario.title.replace(/"/g, '\\"');
  const flowLines = scenario.flow.split('\n').map((line) => `  ${line}`).join('\n');
  return [
    '# Cladding · Tier A · SSoT — onboarding output, edit-friendly · Refreshed by: clad init / clad clarify',
    `id: ${scenario.id}`,
    `slug: ${scenario.slug}`,
    `title: "${escapedTitle}"`,
    'flow: |',
    flowLines || '  (no flow described)',
    'features: []',
    '',
  ].join('\n');
}
