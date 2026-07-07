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
//   5. Writes the refined bodies via `writeArtifact` (existing files
//      divert to `.cladding/scan/*.proposal` per the standard policy).
//   6. Appends new questions to the state file (`appendNewQuestions`
//      de-duplicates) and marks `status: done` when nothing remains.
//
// The handler never throws — telemetry under `phase: 'onboarding'`
// captures every fallback path so `clad doctor` surfaces the gap.

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import process from 'node:process';

import {selectDispatcher} from './scan/dispatcher.js';
import {
  appendNewQuestions,
  firstPendingIndex,
  isComplete,
  loadState,
  markDone,
  markFirstPendingAnswered,
  saveState,
  type OnboardingState,
} from './scan/onboarding-state.js';
import {
  interpretRefinementWithFallback,
  type OnboardingObserved,
  type OnboardingResult,
  type RefinementCurrent,
  type RefinementQa,
} from './scan/intent-onboarding.js';
import {pulse} from '../ui/pulse.js';

export interface RefineCommandOptions {
  readonly cwd?: string;
  /** Emit a structured `RefineReport` JSON instead of the formatted text. */
  readonly json?: boolean;
  /** Force the deterministic interpreter (matches `clad init --no-llm`). */
  readonly noLlm?: boolean;
}

/** Wire format for `clad clarify --json`. */
export interface RefineReport {
  readonly cwd: string;
  readonly answered: {readonly question: string; readonly answer: string} | null;
  readonly newQuestions: readonly string[];
  readonly mode: OnboardingResult['mode'] | null;
  readonly status: OnboardingState['status'];
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
  const cwd = opts.cwd ?? '.';
  let state: OnboardingState | null;
  try {
    state = loadState(cwd);
  } catch (err) {
    pulse('fail', 'clarify', (err as Error).message);
    process.exit(1);
    return;
  }
  if (state === null) {
    pulse(
      'fail',
      'clarify',
      'no onboarding session — run `clad init <intent>` first to start the Q&A loop',
    );
    process.exit(2);
    return;
  }

  if (state.status === 'done') {
    pulse('note', 'clarify', 'onboarding already complete (state.yaml status: done)');
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(buildReport(cwd, null, [], null, state), null, 2)}\n`);
    }
    process.exit(0);
    return;
  }

  const pendingIdx = firstPendingIndex(state);
  if (pendingIdx === -1) {
    // Every existing question is answered but `isComplete` may still be
    // false if the LLM was about to emit new questions; mark done.
    const done = markDone(state);
    saveState(cwd, done);
    pulse('pass', 'clarify', 'onboarding complete · state.yaml marked done');
    if (opts.json) {
      process.stdout.write(`${JSON.stringify(buildReport(cwd, null, [], null, done), null, 2)}\n`);
    }
    process.exit(0);
    return;
  }

  const answer = (answerTokens ?? []).join(' ').trim();
  if (answer.length === 0) {
    pulse(
      'fail',
      'clarify',
      `provide an answer for: "${state.qa[pendingIdx].question}" (usage: \`clad clarify <answer>\`)`,
    );
    process.exit(2);
    return;
  }

  const stateAfterAnswer = markFirstPendingAnswered(state, answer);
  const projectName = stateAfterAnswer.projectName || basename(resolve(cwd));
  const observed: OnboardingObserved = {
    cwdBasename: basename(resolve(cwd)),
    language: stateAfterAnswer.language,
    sourceFileCount: 0,
    readmePresent: false,
    readmeFirstParagraph: null,
    projectName,
  };
  const current = loadCurrentArtifacts(cwd);
  const qaHistory: RefinementQa[] = stateAfterAnswer.qa.flatMap((qa) =>
    qa.answer === null ? [] : [{question: qa.question, answer: qa.answer}],
  );

  const dispatcher = selectDispatcher({noLlm: opts.noLlm});
  const refined = await interpretRefinementWithFallback(
    stateAfterAnswer.intent,
    observed,
    qaHistory,
    current,
    dispatcher,
    cwd,
  );

  // Write the refined artifacts. The existing `writeArtifact` divert
  // pattern is inlined here so `clarify` does not depend on `init.ts`;
  // refresh on a populated file lands the new body in
  // `.cladding/scan/<basename>.proposal` instead of overwriting hand
  // edits.
  const proposals: string[] = [];
  const created: string[] = [];
  writeArtifact(cwd, 'docs/project-context.md', refined.projectContextMd, created, proposals);
  writeArtifact(cwd, 'spec/architecture.yaml', refined.architectureYaml, created, proposals);
  writeArtifact(cwd, 'spec/capabilities.yaml', refined.capabilitiesYaml, created, proposals);
  // v0.3.45 (F-d12edf) — refined scenarios land in spec/scenarios/
  // alongside the other refined artifacts; existing scenario files
  // divert to .cladding/scan/<basename>.proposal so the planner +
  // user can diff before promotion.
  for (const scenario of refined.scenarios) {
    const hash = scenario.id.replace(/^S-/, '');
    const filename = `spec/scenarios/${scenario.slug}-${hash}.yaml`;
    const body = renderScenarioYaml(scenario);
    writeArtifact(cwd, filename, body, created, proposals);
  }

  // Persist state: add new questions (de-dup), mark done when no more
  // questions and every existing question is answered.
  let updated = appendNewQuestions(stateAfterAnswer, refined.clarifyingQuestions);
  if (refined.clarifyingQuestions.length === 0 && isComplete(updated)) {
    updated = markDone(updated);
  }
  saveState(cwd, updated);

  // Output
  if (opts.json) {
    const answeredQa = stateAfterAnswer.qa[pendingIdx];
    const report = buildReport(
      cwd,
      // safe — we just set this entry's answer via markFirstPendingAnswered
      {question: answeredQa.question, answer: answer},
      refined.clarifyingQuestions,
      refined.mode,
      updated,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exit(0);
    return;
  }

  pulse('pass', 'clarify', `answered · mode: ${refined.mode} · source: ${refined.source}`);
  for (const c of created) pulse('pass', `created ${c}`);
  for (const p of proposals) pulse('note', 'proposal', p);

  if (refined.clarifyingQuestions.length > 0) {
    process.stdout.write('\n💡 Next questions:\n');
    for (const [i, q] of refined.clarifyingQuestions.entries()) {
      process.stdout.write(`   ${i + 1}. ${q}\n`);
    }
    const remaining = updated.qa.filter((q) => q.answer === null);
    if (remaining.length > 0) {
      process.stdout.write(`\n${remaining.length} question(s) left · continue with \`clad clarify <answer>\`.\n\n`);
    }
  } else if (updated.status === 'done') {
    process.stdout.write('\n✓ All questions answered — onboarding complete. state.yaml status: done.\n\n');
  } else {
    const remaining = updated.qa.filter((q) => q.answer === null);
    if (remaining.length > 0) {
      process.stdout.write(`\n${remaining.length} question(s) left. continue with \`clad clarify <answer>\`.\n\n`);
    }
  }

  process.exit(0);
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
  };
}

function loadCurrentArtifacts(cwd: string): RefinementCurrent {
  return {
    projectContextMd: readArtifact(cwd, 'docs/project-context.md'),
    capabilitiesYaml: readArtifact(cwd, 'spec/capabilities.yaml'),
    architectureYaml: readArtifact(cwd, 'spec/architecture.yaml'),
  };
}

function readArtifact(cwd: string, relPath: string): string {
  const target = join(cwd, relPath);
  if (!existsSync(target)) return '';
  return readFileSync(target, 'utf8');
}

function writeArtifact(
  cwd: string,
  relPath: string,
  body: string,
  created: string[],
  proposals: string[],
): void {
  const target = join(cwd, relPath);
  if (existsSync(target)) {
    const proposal = join(cwd, '.cladding', 'scan', `${basename(relPath)}.proposal`);
    mkdirSync(dirname(proposal), {recursive: true});
    writeFileSync(proposal, body);
    proposals.push(`${relPath} → .cladding/scan/${basename(relPath)}.proposal`);
    return;
  }
  mkdirSync(dirname(target), {recursive: true});
  writeFileSync(target, body);
  created.push(relPath);
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
