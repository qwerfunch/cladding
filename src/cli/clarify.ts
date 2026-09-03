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
//   5. Publishes active SSoT bodies — schema 0.1 through the shared
//      compatibility journal, schema 0.2 through the typed edit boundary;
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
  readLegacyForbiddenImports,
  readSchema02Capabilities,
  readSchema02Layers,
  renderSchema02ArchitectureYaml,
  renderSchema02CapabilitiesYaml,
  renderSchema02ScenarioDraftYaml,
  schema02ScenarioDraftPath,
  type OnboardingObserved,
  type OnboardingResult,
  type OnboardingScenario,
  type RefinementCurrent,
  type RefinementQa,
} from './scan/intent-onboarding.js';
import {pulse} from '../ui/pulse.js';
import {onboardingCompletionMessage} from '../ui/softShell.js';
import {isReadableShardFilename} from '../spec/compiler/id-policy.js';
import {
  commitSchema01CompatibilityMutation,
  editSpec,
  readSpecEditRevisions,
  type Schema01CompatibilityReplacement,
  type SpecEditOperation,
} from '../spec/edit.js';
import {readSchema02AuthoringSnapshot} from '../spec/compiler/authoring-view.js';
import {
  commitSpecTransactionFiles,
  readSpecTransactionBytes,
  requiredRootSchema,
  SpecEditError,
  withSpecWorkspaceLock,
} from '../spec/transaction.js';
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
      message: onboardingCompletionMessage(),
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
      message: onboardingCompletionMessage(),
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
  const schema = workspaceSchema(cwd);
  const applyToActiveDesign = artifactsAreUntouched(cwd, state);
  // Schema 0.2 journeys must bind a feature, so a refinement's scenarios are
  // never canonical targets there; they are staged beside the other proposals.
  const scenarioPaths = schema === '0.2'
    ? []
    : refined.scenarios.map((scenario) =>
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
    // A refinement body that carries no readable catalog or layer list is an
    // unusable response, not an instruction to empty the workspace: the
    // current canonical body travels forward untouched instead.
    const refinedCapabilities = schema === '0.2' ? readSchema02Capabilities(refined.capabilitiesYaml) : null;
    const refinedLayers = schema === '0.2' ? readSchema02Layers(refined.architectureYaml) : null;
    const artifacts = [
      {path: 'docs/project-context.md', body: refined.projectContextMd},
      {
        path: 'spec/architecture.yaml',
        body: schema !== '0.2'
          ? refined.architectureYaml
          : refinedLayers
            ? renderSchema02ArchitectureYaml(
              observed.language,
              refinedLayers,
              readLegacyForbiddenImports(refined.architectureYaml),
            )
            : current.architectureYaml,
      },
      {
        path: 'spec/capabilities.yaml',
        body: schema !== '0.2'
          ? refined.capabilitiesYaml
          : refinedCapabilities
            ? renderSchema02CapabilitiesYaml(projectName, refinedCapabilities)
            : current.capabilitiesYaml,
      },
      ...refined.scenarios.map((scenario, index) => ({path: scenarioPaths[index], body: renderScenarioYaml(scenario)}))
        .filter((artifact) => artifact.path !== undefined),
    ];
    if (new Set(artifacts.map((artifact) => artifact.path)).size !== artifacts.length) {
      throw new Error('onboarding refinement proposed duplicate managed artifact paths');
    }
    if (schema === '0.2') {
      for (const scenario of refined.scenarios) stageSchema02ScenarioDraft(cwd, scenario, proposals);
    }
    if (applyToActiveDesign) {
      // Active design artifacts are canonical SSoT. Schema 0.1 publishes them
      // through the compatibility journal; schema 0.2 publishes the catalog,
      // the layer ranks, and the refined purpose through the typed edit
      // boundary, and the untyped project-context document through the same
      // F4 journal those operations use.
      const replacements = artifactReplacements(artifacts, planBefore);
      opts.testBeforeCanonicalCommit?.();
      if (schema === '0.2') {
        commitSchema02OnboardingArtifacts(
          cwd,
          replacements,
          refined.source === 'deterministic' ? undefined : projectPurposeFromContext(refined.projectContextMd),
          () => {canonicalCommitted = true;},
        );
      } else {
        commitSchema01CompatibilityMutation(cwd, replacements);
        canonicalCommitted = true;
      }
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
    // selected SSoT artifact. Schema 0.1 publishes through the compatibility
    // journal; schema 0.2 publishes through the same typed boundary a
    // refinement uses, so a reviewed body and a refined body land identically.
    opts.testBeforeCanonicalCommit?.();
    const replacements = pairs.map(({target, proposal}) => ({
      path: target,
      before: checked.find((candidate) => candidate.target === target)!.before,
      after: readFileSync(join(cwd, proposal), 'utf8'),
    }));
    if (workspaceSchema(cwd) === '0.2') {
      const context = replacements.find((replacement) => replacement.path === 'docs/project-context.md');
      commitSchema02OnboardingArtifacts(
        cwd,
        replacements,
        context && projectPurposeFromContext(context.after),
        () => {canonicalCommitted = true;},
      );
    } else {
      commitSchema01CompatibilityMutation(cwd, replacements);
      canonicalCommitted = true;
    }
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

/**
 * Reads the schema a workspace declares, treating an unreadable root as legacy.
 *
 * An onboarding session always follows a `clad init`, so `spec.yaml` exists;
 * an unreadable root means the workspace is broken in a way the legacy writer
 * already reports, and defaulting to 0.1 keeps that message.
 *
 * @param cwd - Workspace root.
 * @returns The declared schema.
 */
function workspaceSchema(cwd: string): '0.1' | '0.2' {
  try {
    return requiredRootSchema(cwd);
  } catch {
    return '0.1';
  }
}

/**
 * Publishes one onboarding generation into a schema 0.2 workspace.
 *
 * The capability catalog, the architecture layer ranks, and the project
 * purpose are schema 0.2 contracts, so they travel as typed operations rather
 * than as replacement bytes — the typed boundary is what validates them.
 * `docs/project-context.md` has no contract and no typed operation, so it
 * travels as a byte-bound file through the same F4 journal.
 *
 * Architecture rules are never written here: a schema 0.2 rule carries a
 * rationale, and an onboarding pass observes none.
 *
 * The two publications are separate transactions, so the caller is told as soon
 * as the first one is durable and can report a partial commit honestly.
 *
 * @param cwd - Workspace root.
 * @param replacements - Byte-bound artifact generation the caller planned.
 * @param purpose - Refined project purpose to fold into the project region, if any.
 * @param onCommitted - Invoked once the first publication is durable.
 * @throws SpecEditError when the workspace moved after the generation was planned.
 * @see spec/features/spec-02-native-onboarding-c4df5fb4.yaml AC-9e0a4c31
 * @since 0.10.0
 */
function commitSchema02OnboardingArtifacts(
  cwd: string,
  replacements: readonly Schema01CompatibilityReplacement[],
  purpose: string | undefined,
  onCommitted?: () => void,
): void {
  // Every planned path must have a schema 0.2 publisher. A scenario shard has
  // none — a journey binds a feature, and onboarding has no feature to bind —
  // so a generation planned before a concurrent migration is refused whole
  // rather than published minus the artifact nobody can write.
  const publishable = new Set(['docs/project-context.md', 'spec/capabilities.yaml', 'spec/architecture.yaml']);
  const unpublishable = replacements.filter((replacement) => !publishable.has(replacement.path));
  if (unpublishable.length > 0) {
    throw new Error(
      `the workspace is on schema 0.2, which has no onboarding write for ${unpublishable.map((replacement) => replacement.path).join(', ')}`,
    );
  }
  // The typed boundary rechecks its own regions, but nothing rechecks an
  // untyped document. Refuse a concurrent author before the first publication
  // as well as under the lock, so the ordinary race leaves nothing behind.
  const documents = replacements.filter((replacement) => replacement.path === 'docs/project-context.md');
  for (const document of documents) assertUnchangedOnboardingDocument(cwd, document);
  const operations: SpecEditOperation[] = [];
  const catalog = replacements.find((replacement) => replacement.path === 'spec/capabilities.yaml');
  const architecture = replacements.find((replacement) => replacement.path === 'spec/architecture.yaml');
  const entries = catalog ? readSchema02Capabilities(catalog.after) : null;
  if (entries) {
    const snapshot = readSchema02AuthoringSnapshot(cwd);
    const bound = new Set(snapshot.features.flatMap((feature) => feature.capabilityRefs));
    // A capability a feature already claims is not the refinement's to drop;
    // removing it would break that feature's contract on the model's say-so.
    for (const existing of snapshot.capabilities) {
      if (!entries.some((entry) => entry.id === existing.id) && !bound.has(existing.id)) {
        operations.push({kind: 'capability.remove', capabilityId: existing.id});
      }
    }
    for (const entry of entries) operations.push({kind: 'capability.upsert', capability: {...entry}});
  }
  const layers = architecture ? readSchema02Layers(architecture.after) : null;
  if (layers) operations.push({kind: 'architecture.set_layers', layers: layers.map((rank) => [...rank])});
  if (purpose) operations.push({kind: 'project.set_purpose', purpose});
  if (operations.length > 0) {
    editSpec({cwd, operations, inputRevisions: readSpecEditRevisions(cwd, operations)});
    onCommitted?.();
  }
  if (documents.length > 0) {
    withSpecWorkspaceLock(cwd, () => {
      for (const document of documents) assertUnchangedOnboardingDocument(cwd, document);
      commitSpecTransactionFiles(cwd, documents.map((document) => ({
        path: document.path,
        before: document.before,
        after: document.after,
      })));
    });
    onCommitted?.();
  }
}

/** Rejects an onboarding document whose bytes moved after the generation was planned. */
function assertUnchangedOnboardingDocument(cwd: string, document: Schema01CompatibilityReplacement): void {
  if (readSpecTransactionBytes(cwd, document.path) !== document.before) {
    throw new SpecEditError('STALE_INPUT', `The onboarding source ${document.path} changed while the refinement was being prepared.`);
  }
}

/**
 * Reads the refined project purpose out of an onboarding project-context body.
 *
 * Only the "What is its purpose?" section is a purpose statement, and only
 * when a model actually wrote one: the deterministic fallback leaves an
 * italic placeholder there, and folding that into `project.purpose` would
 * replace a real sentence with an instruction to the reader.
 *
 * @param projectContextMd - Project-context body about to be published.
 * @returns A single-paragraph purpose, or `undefined` when none is stated.
 */
function projectPurposeFromContext(projectContextMd: string): string | undefined {
  const lines = projectContextMd.split('\n');
  const heading = lines.findIndex((line) => /^##\s*3\./.test(line.trim()));
  if (heading < 0) return undefined;
  const section: string[] = [];
  for (let index = heading + 1; index < lines.length; index++) {
    if (/^##\s/.test(lines[index])) break;
    section.push(lines[index]);
  }
  const paragraph = section.join('\n').trim().split(/\n\s*\n/)[0]?.trim() ?? '';
  const purpose = paragraph.split('\n').map((line) => line.trim()).join(' ').trim();
  if (!purpose || purpose.startsWith('_') || purpose.startsWith('<!--') || purpose.length > 400) return undefined;
  return purpose;
}

/** Stages one refinement scenario as a schema 0.2 journey draft for review. */
function stageSchema02ScenarioDraft(cwd: string, scenario: OnboardingScenario, proposals: string[]): void {
  writeOnboardingProposal(cwd, schema02ScenarioDraftPath(scenario), renderSchema02ScenarioDraftYaml(scenario), proposals);
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
      `✓ ${onboardingCompletionMessage()}`,
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
