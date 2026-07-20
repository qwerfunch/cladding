// Cladding · scan · onboarding-state — Q&A loop persistence
//
// `.cladding/onboarding/state.yaml` stores the in-progress onboarding
// session: the original user intent, the observed environment at init
// time, and the list of clarifying questions with their answers
// (null = pending). `clad init <intent>` writes the initial state,
// `clad clarify <answer>` advances it by marking the first pending
// question answered + adding any new questions the LLM produced.
//
// Why YAML on disk? Same surface as the rest of cladding (`spec.yaml`,
// `spec/architecture.yaml`, etc.) — adopters who edit the file by hand
// see the same shape. The state file is treated as authoritative
// during the onboarding window; once `qa[].every(answered)` AND no new
// questions emerge, the file is marked `status: done` (kept as audit).

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import yaml from 'yaml';

const STATE_DIR = '.cladding/onboarding';
const STATE_FILE = 'state.yaml';

/** One Q-A pair in the onboarding history. */
export interface OnboardingQa {
  /** Verbatim question text from the LLM's CLARIFYING_QUESTIONS section. */
  readonly question: string;
  /** User's answer; `null` while pending. */
  readonly answer: string | null;
}

/** Full state of an onboarding session. */
export interface OnboardingState {
  /** Original intent passed to `clad init`. */
  readonly intent: string;
  /** Detected toolchain language at init time. */
  readonly language: string;
  /** Project name surfaced at init time (cwd basename or `--name`). */
  readonly projectName: string;
  /** Mode the onboarding pass classified the project as. */
  readonly mode: 'greenfield' | 'existing-adoption' | 'mixed';
  /** ISO timestamp of `clad init`. */
  readonly startedAt: string;
  /**
   * Lifecycle marker. `active` during the Q&A loop, `done` once the
   * LLM emits no further questions AND every existing question has an
   * answer. The file stays on disk after `done` as an audit log.
   */
  readonly status: 'active' | 'needs_review' | 'done';
  /** Q-A history in arrival order; `answer: null` entries are still pending. */
  readonly qa: readonly OnboardingQa[];
  /** Digests of the generated design last accepted into the active SSoT. */
  readonly artifactDigests?: Readonly<Record<string, string>>;
  /** Authored targets whose generated refinements await explicit review. */
  readonly pendingReview?: readonly string[];
}

function statePath(cwd: string): string {
  return join(cwd, STATE_DIR, STATE_FILE);
}

/** Load the state file. Returns `null` when the file does not exist. */
export function loadState(cwd: string): OnboardingState | null {
  const path = statePath(cwd);
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, 'utf8');
  const parsed = yaml.parse(raw) as Partial<OnboardingState> | null;
  if (parsed === null || typeof parsed !== 'object') return null;
  // Defensive — coerce shape so a hand-edited file does not crash callers.
  return {
    intent: String(parsed.intent ?? ''),
    language: String(parsed.language ?? 'unknown'),
    projectName: String(parsed.projectName ?? ''),
    mode: (['greenfield', 'existing-adoption', 'mixed'] as const).includes(
      parsed.mode as OnboardingState['mode'],
    )
      ? (parsed.mode as OnboardingState['mode'])
      : 'greenfield',
    startedAt: String(parsed.startedAt ?? new Date().toISOString()),
    status: parsed.status === 'done' ? 'done' : parsed.status === 'needs_review' ? 'needs_review' : 'active',
    qa: Array.isArray(parsed.qa)
      ? parsed.qa.map((entry) => ({
          question: String((entry as OnboardingQa)?.question ?? ''),
          answer:
            (entry as OnboardingQa)?.answer === null ||
            (entry as OnboardingQa)?.answer === undefined
              ? null
              : String((entry as OnboardingQa).answer),
        }))
      : [],
    artifactDigests:
      parsed.artifactDigests && typeof parsed.artifactDigests === 'object'
        ? Object.fromEntries(Object.entries(parsed.artifactDigests).map(([path, digest]) => [path, String(digest)]))
        : undefined,
    pendingReview: Array.isArray(parsed.pendingReview) ? parsed.pendingReview.map(String) : undefined,
  };
}

/** Persist the state file atomically (best-effort — same as writeArtifact pattern). */
export function saveState(cwd: string, state: OnboardingState): void {
  const path = statePath(cwd);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, {recursive: true});
  const body = yaml.stringify(state, {lineWidth: 0});
  const banner = '# Cladding · Tier D · transient — Q&A audit · Refreshed by: clad init / clad clarify\n';
  const withBanner = body.startsWith('# Cladding · ') ? body : `${banner}${body}`;
  writeFileSync(path, `${withBanner.endsWith('\n') ? withBanner : `${withBanner}\n`}`, 'utf8');
}

/**
 * Returns the index of the first pending question (`answer === null`),
 * or `-1` when every existing question is answered.
 */
export function firstPendingIndex(state: OnboardingState): number {
  return state.qa.findIndex((qa) => qa.answer === null);
}

/**
 * Returns a new state with the first pending question marked
 * answered. Throws when no pending question exists — callers should
 * check {@link firstPendingIndex} first.
 */
export function markFirstPendingAnswered(
  state: OnboardingState,
  answer: string,
): OnboardingState {
  const idx = firstPendingIndex(state);
  if (idx === -1) {
    throw new Error('onboarding-state: no pending question — every QA entry already has an answer');
  }
  return {
    ...state,
    qa: state.qa.map((entry, i) => (i === idx ? {question: entry.question, answer} : entry)),
  };
}

/**
 * Appends new questions emitted by the LLM after a refinement pass.
 * Duplicates (by exact question text) are skipped so a follow-up
 * iteration that re-emits the same question does not pile entries.
 */
export function appendNewQuestions(
  state: OnboardingState,
  newQuestions: readonly string[],
): OnboardingState {
  if (newQuestions.length === 0) return state;
  const seen = new Set(state.qa.map((q) => q.question));
  const additions: OnboardingQa[] = [];
  for (const q of newQuestions) {
    if (!seen.has(q)) {
      additions.push({question: q, answer: null});
      seen.add(q);
    }
  }
  if (additions.length === 0) return state;
  return {...state, qa: [...state.qa, ...additions]};
}

/** True when every question has a non-null answer AND no new questions are pending. */
export function isComplete(state: OnboardingState): boolean {
  return state.qa.length > 0 && state.qa.every((q) => q.answer !== null);
}

/** Returns a `status: 'done'` copy of the state. */
export function markDone(state: OnboardingState): OnboardingState {
  return {...state, status: 'done'};
}

/** Tier-A/B artifacts whose accepted contents must include every onboarding answer. */
export const ONBOARDING_DESIGN_ARTIFACTS = [
  'docs/project-context.md',
  'spec/architecture.yaml',
  'spec/capabilities.yaml',
] as const;

/** Captures byte digests used to distinguish untouched generated design from user edits. */
export function captureArtifactDigests(cwd: string): Readonly<Record<string, string>> {
  const scenarioDir = join(cwd, 'spec', 'scenarios');
  const scenarios = existsSync(scenarioDir)
    ? readdirSync(scenarioDir)
        .filter((name) => name.endsWith('.yaml'))
        .map((name) => `spec/scenarios/${name}`)
    : [];
  return Object.fromEntries([...ONBOARDING_DESIGN_ARTIFACTS, ...scenarios].flatMap((relativePath) => {
    const path = join(cwd, relativePath);
    if (!existsSync(path)) return [];
    return [[relativePath, createHash('sha256').update(readFileSync(path)).digest('hex')]];
  }));
}

/** True only when every previously accepted design artifact is still byte-identical. */
export function artifactsAreUntouched(cwd: string, state: OnboardingState): boolean {
  const expected = state.artifactDigests;
  if (!expected || Object.keys(expected).length === 0) return false;
  const current = captureArtifactDigests(cwd);
  return Object.entries(expected).every(([path, digest]) => current[path] === digest);
}
