// Cladding · Spec 0.2 F5 · exact testcase observation reduction.

import type {BindingObservation, TestBinding, TestCaseObservation} from './types.js';

/** Reduces only testcase observations named by each declared binding. The report
 *  is structural — any carrier ledger with `cases` reduces identically, so this
 *  layer never depends on a stage's parser type. */
export function reduceTestBindings(
  bindings: readonly TestBinding[],
  report: {readonly cases?: readonly TestCaseObservation[]},
): readonly BindingObservation[] {
  const byCriterion = new Map<string, TestBinding[]>();
  for (const binding of bindings) {
    const entries = byCriterion.get(binding.criterion) ?? [];
    entries.push(binding);
    byCriterion.set(binding.criterion, entries);
  }
  return [...byCriterion.entries()].map(([criterion, entries]) => reduceOne(criterion, entries, report.cases ?? []))
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
}

function reduceOne(criterion: string, bindings: readonly TestBinding[], observations: readonly TestCaseObservation[]): BindingObservation {
  const matching = observations.filter((observation) => bindings.some((binding) => exactMatch(binding, observation, observations)));
  const pass = matching.filter((observation) => observation.status === 'pass').length;
  const fail = matching.filter((observation) => observation.status === 'fail').length;
  const error = matching.filter((observation) => observation.status === 'error').length;
  const skip = matching.filter((observation) => observation.status === 'skip').length;
  return {
    criterion,
    state: fail + error > 0 ? 'failed' : pass > 0 ? 'verified' : 'unverified',
    matched: matching.length, pass, fail, skip, error,
  };
}

function exactMatch(
  binding: TestBinding,
  observation: TestCaseObservation,
  observations: readonly TestCaseObservation[],
): boolean {
  const file = normalizePath(binding.file);
  if (!observation.files.some((candidate) => normalizePath(candidate) === file)) return false;
  // A runner's full testcase name is always authoritative. A source title is
  // only an explicit Vitest fallback and is unusable when its file repeats it.
  if (binding.selector === observation.name) return true;
  if (observations.some((candidate) => candidate.name === binding.selector
    && candidate.files.some((candidateFile) => normalizePath(candidateFile) === file))) return false;
  if (binding.selector !== observation.sourceTitle) return false;
  return observations.filter((candidate) => candidate.sourceTitle === binding.selector
    && candidate.files.some((candidateFile) => normalizePath(candidateFile) === file)).length === 1;
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
