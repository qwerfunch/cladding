// Cladding · `clad refine <answer>` — Q&A onboarding loop driver
//
// After `clad init <intent>` writes `.cladding/onboarding/state.yaml`
// with the LLM's clarifying questions, the orchestrator persona asks
// the user each pending question one at a time. The user's reply is
// forwarded as `clad refine <answer>` — this handler:
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

/** Wire format for `clad refine --json`. */
export interface RefineReport {
  readonly cwd: string;
  readonly answered: {readonly question: string; readonly answer: string} | null;
  readonly newQuestions: readonly string[];
  readonly mode: OnboardingResult['mode'] | null;
  readonly status: OnboardingState['status'];
}

/**
 * Handler for `clad refine [answer...]`. The positional argument is
 * joined with spaces so users can pass natural-language answers
 * without quoting: `clad refine 법인 사업자만 (개인사업자 제외)`.
 *
 * Exit codes:
 *   0 — answer accepted (or no-op when state is already `status: done`)
 *   1 — fatal error (corrupt state file)
 *   2 — usage error (no state file present, or no answer provided
 *       while a pending question exists)
 */
export async function runRefineCommand(
  answerTokens: readonly string[] | undefined,
  opts: RefineCommandOptions = {},
): Promise<void> {
  const cwd = opts.cwd ?? '.';
  let state: OnboardingState | null;
  try {
    state = loadState(cwd);
  } catch (err) {
    pulse('fail', 'refine', (err as Error).message);
    process.exit(1);
    return;
  }
  if (state === null) {
    pulse(
      'fail',
      'refine',
      'no onboarding session — run `clad init <intent>` first to start the Q&A loop',
    );
    process.exit(2);
    return;
  }

  if (state.status === 'done') {
    pulse('note', 'refine', 'onboarding already complete (state.yaml status: done)');
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
    pulse('pass', 'refine', 'onboarding complete · state.yaml marked done');
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
      'refine',
      `provide an answer for: "${state.qa[pendingIdx].question}" (usage: \`clad refine <answer>\`)`,
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
  // pattern is inlined here so `refine` does not depend on `init.ts`;
  // refresh on a populated file lands the new body in
  // `.cladding/scan/<basename>.proposal` instead of overwriting hand
  // edits.
  const proposals: string[] = [];
  const created: string[] = [];
  writeArtifact(cwd, 'docs/project-context.md', refined.projectContextMd, created, proposals);
  writeArtifact(cwd, 'spec/architecture.yaml', refined.architectureYaml, created, proposals);
  writeArtifact(cwd, 'spec/capabilities.yaml', refined.capabilitiesYaml, created, proposals);

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

  pulse('pass', 'refine', `answered · mode: ${refined.mode} · source: ${refined.source}`);
  for (const c of created) pulse('pass', `created ${c}`);
  for (const p of proposals) pulse('note', 'proposal', p);

  if (refined.clarifyingQuestions.length > 0) {
    process.stdout.write('\n💡 다음 질문:\n');
    for (const [i, q] of refined.clarifyingQuestions.entries()) {
      process.stdout.write(`   ${i + 1}. ${q}\n`);
    }
    const remaining = updated.qa.filter((q) => q.answer === null);
    if (remaining.length > 0) {
      process.stdout.write(`\n남은 질문: ${remaining.length} 개 · \`clad refine <답변>\` 으로 계속 진행.\n\n`);
    }
  } else if (updated.status === 'done') {
    process.stdout.write('\n✓ 모든 질문에 답변 완료 — 온보딩 종료. state.yaml status: done.\n\n');
  } else {
    const remaining = updated.qa.filter((q) => q.answer === null);
    if (remaining.length > 0) {
      process.stdout.write(`\n남은 질문: ${remaining.length} 개. \`clad refine <답변>\` 으로 계속 진행.\n\n`);
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
