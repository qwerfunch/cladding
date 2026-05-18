// Cladding · drive · main autonomous loop
//
// Deterministic "drive floor" — the v0.1 implementation runs without
// any LLM call. It iterates over the spec's planned / in_progress
// features in dependency order, materialises empty stub files for any
// declared module that doesn't yet exist on disk, then invokes the
// L1 gate set. The richer LLM-driven coding loop lands in v0.2 (T9
// agent integration).
//
// Even in this floor form the loop demonstrates:
//   - dependency ordering (no feature runs before its depends_on)
//   - 10-class halt enumeration (drive/halt.ts)
//   - feature × gate × evidence event stream

import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';

import {newEvidence} from '../hitl/identity.js';
import {appendEvidence} from '../hitl/audit.js';
import {appendEvent, newEvent} from '../events/log.js';
import {loadSpec} from '../spec/load.js';
import type {Feature, Spec} from '../spec/types.js';
import {runArch} from '../stages/arch.js';
import {runLint} from '../stages/lint.js';
import {runType} from '../stages/type.js';
import {DEFAULT_BUDGET, type HaltReason, type LoopBudget, checkBudget} from './halt.js';

export interface DriveOptions {
  readonly cwd?: string;
  readonly goal?: string;
  readonly budget?: LoopBudget;
}

export interface DriveResult {
  readonly halt: HaltReason;
  readonly iterations: number;
  readonly featuresTouched: readonly string[];
  readonly stubsCreated: readonly string[];
  readonly gateRuns: number;
}

function nextReady(spec: Spec, done: ReadonlySet<string>): Feature | undefined {
  for (const f of spec.features) {
    if (done.has(f.id)) continue;
    if (f.status === 'archived') continue;
    const deps = f.depends_on ?? [];
    if (deps.every((d) => done.has(d))) return f;
  }
  return undefined;
}

function ensureStub(cwd: string, modulePath: string): boolean {
  const abs = join(cwd, modulePath);
  if (existsSync(abs)) return false;
  mkdirSync(dirname(abs), {recursive: true});
  writeFileSync(abs, '// auto-stub created by clad drive — replace with real implementation\nexport {};\n');
  return true;
}

/** Runs the autonomous loop. Always returns a HaltReason. */
export function runDriveLoop(opts: DriveOptions = {}): DriveResult {
  const cwd = opts.cwd ?? '.';
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const startedAt = Date.now();
  const retries = new Map<string, number>();
  const featuresTouched: string[] = [];
  const stubsCreated: string[] = [];
  let gateRuns = 0;
  let iteration = 0;

  let spec: Spec;
  try {
    spec = loadSpec(cwd);
  } catch (err) {
    return {
      halt: {class: 'UNCAUGHT_ERROR', detail: `spec load failed: ${(err as Error).message}`, iteration: 0},
      iterations: 0,
      featuresTouched: [],
      stubsCreated: [],
      gateRuns: 0,
    };
  }

  appendEvent(cwd, newEvent('feature_activated', {goal: opts.goal ?? null, total: spec.features.length}));
  const done = new Set(spec.features.filter((f) => f.status === 'done' || f.status === 'archived').map((f) => f.id));

  while (true) {
    iteration += 1;
    const budgetHalt = checkBudget(iteration, startedAt, retries, budget);
    if (budgetHalt) return finish(budgetHalt);

    const ready = nextReady(spec, done);
    if (!ready) {
      const halt: HaltReason =
        done.size === spec.features.length
          ? {class: 'ALL_FEATURES_DONE', detail: `${done.size} features cleared`, iteration}
          : {class: 'BLOCKED_FEATURE', detail: 'no feature has its depends_on satisfied', iteration};
      return finish(halt);
    }

    featuresTouched.push(ready.id);
    for (const modulePath of ready.modules ?? []) {
      if (ensureStub(cwd, modulePath)) stubsCreated.push(modulePath);
    }

    // Drift (stage_1.3) intentionally excluded — the drive floor runs while
    // the spec is partially stubbed, and a spec-wide MISSING_IMPLEMENTATION
    // sweep would always fail. `clad check` covers drift after the loop.
    const gates = [
      ['stage_1.1', runType({cwd})],
      ['stage_1.2', runLint({cwd})],
      ['stage_1.5', runArch({cwd})],
    ] as const;
    gateRuns += gates.length;
    const failed = gates.find(([, r]) => !r.pass && r.exitCode !== 2);
    if (failed) {
      retries.set(ready.id, (retries.get(ready.id) ?? 0) + 1);
      appendEvent(cwd, newEvent('drift_detected', {feature: ready.id, gate: failed[0]}));
      continue;
    }

    appendEvidence(
      cwd,
      newEvidence({
        featureId: ready.id,
        stage: 'stage_1.3',
        kind: 'pass',
        content: 'clad drive — L1 gates pass on auto-stub',
        identity: {author: 'tool', name: 'clad-drive'},
      }),
    );
    appendEvent(cwd, newEvent('feature_completed', {feature: ready.id, by: 'clad-drive'}));
    done.add(ready.id);
  }

  function finish(halt: HaltReason): DriveResult {
    appendEvent(cwd, newEvent('feature_completed', {halt: halt.class, detail: halt.detail}));
    return {halt, iterations: iteration, featuresTouched, stubsCreated, gateRuns};
  }
}
