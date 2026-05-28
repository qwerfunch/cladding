// Cladding · 0.5.0 dogfood harness
//
// Walks the full 0.5.0 transaction flow against /tmp/dogfood-cladding/
// (a project created by `clad init`). Simulates what a 0.5.0 MCP host
// would do: enter_work / complete_work / execute_drive / audit. Logs
// each step and every error so the dogfood report can cite real
// reproduction.
//
// Usage:
//   npx tsx scripts/dogfood-0.5.0.ts [<step>]
//
// Steps:
//   features  — create 4 tasktrack features
//   scenario  — bind them into a scenario
//   work      — enter_work each feature, write stub, complete_work
//   drive     — executeDrive end-to-end with parallel groups
//   audit     — auditWorkCompliance
//   all       — every step in order (default)

import {execSync} from 'node:child_process';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

import {createFeature, createScenario} from '../src/spec/new.js';
import {auditWorkCompliance} from '../src/work/audit.js';
import {completeDrive, executeDrive} from '../src/work/drive-transaction.js';
import {
  abandonWork,
  completeWork,
  enterWork,
  type EnterWorkResult,
} from '../src/work/transaction.js';
import {detectHost} from '../src/agents/host-detect.js';
import {translateCapabilities} from '../src/agents/capabilities.js';
import {loadPersona} from '../src/agents/loader.js';

const PROJECT = '/tmp/dogfood-cladding';

interface Step {
  name: string;
  run: () => Promise<void> | void;
}

const log = (msg: string): void => {
  // Force ANSI-free for clean dogfood report paste.
  process.stdout.write(`[dogfood] ${msg}\n`);
};

const features: Array<{slug: string; id: string; depends_on?: string[]}> = [];

function pickFeatureIdBySlug(slug: string): string {
  const dir = join(PROJECT, 'spec', 'features');
  const files = readdirSync(dir);
  const match = files.find((f) => f.startsWith(`${slug}-`) && f.endsWith('.yaml'));
  if (!match) throw new Error(`feature shard not found for slug=${slug}`);
  const raw = readFileSync(join(dir, match), 'utf8');
  const idMatch = raw.match(/^id:\s*(F-[a-f0-9]+|F-\d+)/m);
  if (!idMatch) throw new Error(`id not found in ${match}`);
  return idMatch[1];
}

function patchFeatureShard(slug: string, mutator: (body: string) => string): void {
  const dir = join(PROJECT, 'spec', 'features');
  const files = readdirSync(dir);
  const match = files.find((f) => f.startsWith(`${slug}-`) && f.endsWith('.yaml'));
  if (!match) throw new Error(`shard not found: ${slug}`);
  const path = join(dir, match);
  const body = readFileSync(path, 'utf8');
  const next = mutator(body);
  if (next === body) {
    throw new Error(`patchFeatureShard: mutator produced no change for slug=${slug} — anchor pattern probably missed.`);
  }
  writeFileSync(path, next);
}

const stepFeatures: Step = {
  name: 'features',
  run: () => {
    log('Creating 4 features via createFeature() (MCP-equivalent)…');
    const seeds = [
      {slug: 'add-task', title: 'Add a task'},
      {slug: 'list-tasks', title: 'List all tasks'},
      {slug: 'done-task', title: 'Mark task done'},
      {slug: 'search-tasks', title: 'Search tasks by text'},
    ];
    for (const seed of seeds) {
      const result = createFeature({slug: seed.slug, title: seed.title, cwd: PROJECT});
      const fid = (result as {id: string}).id;
      features.push({slug: seed.slug, id: fid});
      log(`  + ${fid} ${seed.slug}`);
    }
    // Add modules + depends_on edits (cladding's createFeature emits a
    // minimal shard; the dogfood specifies dependency structure).
    patchFeatureShard('add-task', (body) =>
      body.replace('modules: []', 'modules:\n  - src/cli/add.ts\n  - src/store/json.ts'),
    );
    // createFeature emits a minimal shard with no `depends_on:` line at
    // all (empty arrays are omitted), so append the block manually
    // before the body separator.
    const injectDependsOn = (body: string, depIds: readonly string[]): string => {
      const block = `depends_on:\n${depIds.map((d) => `  - ${d}`).join('\n')}\n`;
      // Insert the block right after `acceptance_criteria: []` line.
      return body.replace(/(acceptance_criteria: \[\]\n)/, `$1${block}`);
    };
    // Inject a single AC-001 per shard so appendEvidence has a target
    // (cladding's appendEvidence asserts the AC id exists on the shard).
    const injectAc1 = (body: string): string =>
      body.replace(
        'acceptance_criteria: []',
        'acceptance_criteria:\n  - id: AC-001\n    text: "Ubiquitous: the feature behaves as described in the title."',
      );
    patchFeatureShard('add-task', injectAc1);
    patchFeatureShard('list-tasks', (body) =>
      injectAc1(injectDependsOn(body.replace('modules: []', 'modules:\n  - src/cli/list.ts'), [features[0].id])),
    );
    patchFeatureShard('done-task', (body) =>
      injectAc1(injectDependsOn(body.replace('modules: []', 'modules:\n  - src/cli/done.ts'), [features[0].id])),
    );
    patchFeatureShard('search-tasks', (body) =>
      injectAc1(injectDependsOn(body.replace('modules: []', 'modules:\n  - src/cli/search.ts'), [features[1].id])),
    );

    // 0.4.x note: the injectAc1 function is defined alongside injectDependsOn.
    void injectDependsOn;
    log(`  ✓ 4 features with depends_on graph: [${features[0].id}] → [${features[1].id}, ${features[2].id}] → [${features[3].id}]`);
  },
};

const stepScenario: Step = {
  name: 'scenario',
  run: () => {
    log('Creating scenario tasktrack-mvp binding all 4 features…');
    const ids = features.map((f) => f.id);
    const result = createScenario({slug: 'tasktrack-mvp', title: 'Tasktrack MVP', features: ids, cwd: PROJECT});
    log(`  + ${(result as {id: string}).id} tasktrack-mvp (${ids.length} features)`);
  },
};

function writeAllSources(): void {
  mkdirSync(join(PROJECT, 'src/cli'), {recursive: true});
  mkdirSync(join(PROJECT, 'src/store'), {recursive: true});
  writeFileSync(
    join(PROJECT, 'src/store/json.ts'),
    [
      'import {existsSync, mkdirSync, readFileSync, writeFileSync} from \'node:fs\';',
      'import {homedir} from \'node:os\';',
      'import {dirname, join} from \'node:path\';',
      '',
      'export const STORE_PATH = join(homedir(), \'.tasktrack\', \'tasks.json\');',
      '',
      'export interface Task {',
      '  readonly id: string;',
      '  readonly text: string;',
      '  readonly done: boolean;',
      '  readonly createdAt: string;',
      '}',
      '',
      'export function loadTasks(path = STORE_PATH): Task[] {',
      '  if (!existsSync(path)) return [];',
      '  return JSON.parse(readFileSync(path, \'utf8\')) as Task[];',
      '}',
      '',
      'export function saveTasks(tasks: Task[], path = STORE_PATH): void {',
      '  mkdirSync(dirname(path), {recursive: true});',
      '  writeFileSync(path, JSON.stringify(tasks, null, 2) + \'\\n\');',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(PROJECT, 'src/cli/add.ts'),
    [
      'import {randomBytes} from \'node:crypto\';',
      'import {loadTasks, saveTasks, type Task} from \'../store/json.js\';',
      '',
      'export function addTask(text: string): Task {',
      '  if (!text || text.trim().length === 0) throw new Error(\'tasktrack: text required\');',
      '  const task: Task = {id: randomBytes(3).toString(\'hex\'), text: text.trim(), done: false, createdAt: new Date().toISOString()};',
      '  const tasks = loadTasks();',
      '  tasks.push(task);',
      '  saveTasks(tasks);',
      '  return task;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(PROJECT, 'src/cli/list.ts'),
    [
      'import {loadTasks, type Task} from \'../store/json.js\';',
      'export function listTasks(): readonly Task[] { return loadTasks(); }',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(PROJECT, 'src/cli/done.ts'),
    [
      'import {loadTasks, saveTasks} from \'../store/json.js\';',
      'export function doneTask(id: string): boolean {',
      '  const tasks = loadTasks();',
      '  const t = tasks.find((x) => x.id === id);',
      '  if (!t) return false;',
      '  const updated = tasks.map((x) => (x.id === id ? {...x, done: true} : x));',
      '  saveTasks(updated);',
      '  return true;',
      '}',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(PROJECT, 'src/cli/search.ts'),
    [
      'import {listTasks} from \'./list.js\';',
      'import type {Task} from \'../store/json.js\';',
      'export function searchTasks(query: string): readonly Task[] {',
      '  const q = query.toLowerCase();',
      '  return listTasks().filter((t) => t.text.toLowerCase().includes(q));',
      '}',
      '',
    ].join('\n'),
  );
}

const stepWork: Step = {
  name: 'work',
  run: () => {
    log('Resetting any open work + writing all 4 source files…');
    writeAllSources();
    for (const slug of ['add-task', 'list-tasks', 'done-task', 'search-tasks']) {
      try {
        abandonWork({featureId: pickFeatureIdBySlug(slug), cwd: PROJECT, reason: 'dogfood reset'});
      } catch {
        // no active work — fine.
      }
    }
    log('Walking enter_work → complete_work for each feature…');
    const det = detectHost();
    log(`  detectHost → host=${det.host} tier=${det.tier} signals=[${det.signals.join(',')}]`);
    for (const slug of ['add-task', 'list-tasks', 'done-task', 'search-tasks']) {
      const fid = pickFeatureIdBySlug(slug);
      log(`--- ${slug} (${fid}) ---`);
      const entered = enterWork({featureId: fid, intent: `${slug} implementation`, cwd: PROJECT});
      summarizeEnterResult(entered);
      const completed = completeWork({
        featureId: fid,
        cwd: PROJECT,
        evidence: [{acId: 'AC-001', ref: `src/cli/${slug.split('-')[0]}.ts`}],
      });
      log(`  complete_work status=${completed.status}`);
      for (const g of completed.gates) {
        const tag = g.skipped ? 'skipped' : g.pass ? 'pass' : 'FAIL';
        log(`    [${tag}] ${g.name} exitCode=${g.exitCode ?? 'n/a'}${g.findingsCount !== undefined ? ` findings=${g.findingsCount}` : ''}`);
      }
      log(`  driftFindings=${completed.driftFindings.length} evidenceAppended=${completed.evidenceAppended}`);
      if (completed.driftFindings.length > 0) {
        const errOrWarn = completed.driftFindings.filter((f) => f.severity !== 'info').slice(0, 3);
        for (const f of errOrWarn) log(`    drift[${f.detector}] ${f.severity}: ${f.message.slice(0, 100)}`);
      }
    }
    log('Forcing a dispatch_drift trip: enter_work with explicit host-self-inject on Tier 1…');
    // Create an ephemeral feature shard so we don't need to re-enter
    // an already-`done` feature (cladding forbids done → in_progress).
    const ephemeral = createFeature({slug: 'dispatch-drift-probe', title: 'dispatch_drift probe', cwd: PROJECT});
    const driftFeatureId = (ephemeral as {id: string}).id;
    const drifted = enterWork({
      featureId: driftFeatureId,
      cwd: PROJECT,
      hostOverride: 'claude-code',
      dispatchMode: 'host-self-inject',
    });
    log(`  enter_work dispatchMode=${drifted.dispatchMode} (should trigger dispatch_drift on audit)`);
    abandonWork({featureId: driftFeatureId, cwd: PROJECT, reason: 'dispatch_drift teardown'});

  },
};

function summarizeEnterResult(r: EnterWorkResult): void {
  log(`  enter_work → status=${r.status} personaId=${r.personaId} routing=${r.routing?.matchedRule ?? 'n/a'}`);
  log(`  dispatchMode=${r.dispatchMode}`);
  if (r.subAgentDispatchHint) {
    log(
      `  subAgentDispatchHint: host=${r.subAgentDispatchHint.host} tool=${r.subAgentDispatchHint.tool} subagent_type=${r.subAgentDispatchHint.subagent_type}${
        r.subAgentDispatchHint.advisory ? ' advisory=true' : ''
      }`,
    );
  } else {
    log('  subAgentDispatchHint: (absent — Tier 3 or generic)');
  }
  log(`  capabilityEnvelope.host=${r.capabilityEnvelope.host}`);
  if (r.capabilityEnvelope.host === 'claude-code') {
    log(`  capabilityEnvelope.tools=[${r.capabilityEnvelope.tools.join(', ')}]`);
  }
}

const stepDrive: Step = {
  name: 'drive',
  run: () => {
    log('Calling executeDrive on tasktrack-mvp scenario…');
    // The scenario id was assigned in stepScenario; rediscover from disk.
    const scnDir = join(PROJECT, 'spec', 'scenarios');
    const files = readdirSync(scnDir).filter((f) => f.startsWith('tasktrack-mvp-'));
    if (files.length === 0) throw new Error('scenario shard missing');
    const raw = readFileSync(join(scnDir, files[0]), 'utf8');
    const idMatch = raw.match(/^id:\s*(S-[a-f0-9]+)/m);
    if (!idMatch) throw new Error('scenario id not parseable');
    const scenarioId = idMatch[1];

    const r = executeDrive({scenarioId, cwd: PROJECT});
    log(`  scenarioTitle=${r.scenarioTitle}`);
    log(`  plan: [${r.plan.join(' → ')}]`);
    log(`  groups: ${r.groups.length}`);
    for (const g of r.groups) {
      log(`    [group ${g.ordinal}] ${g.featureIds.join(', ')}`);
    }
    if (r.firstWork) {
      log(`  firstWork: featureId=${r.firstWork.featureId} status=${r.firstWork.status} dispatchMode=${r.firstWork.dispatchMode}`);
    }

    // Tidy up: abandon any open transactions so subsequent steps run clean.
    for (const f of features) {
      try {
        abandonWork({featureId: f.id, cwd: PROJECT, reason: 'dogfood cleanup'});
      } catch {
        // already closed or never entered — fine.
      }
    }

    completeDrive({scenarioId, cwd: PROJECT});
    log('  ✓ executeDrive + completeDrive flow OK');
  },
};

const stepAudit: Step = {
  name: 'audit',
  run: () => {
    log('Calling auditWorkCompliance({includeFileDiff: true})…');
    const r = auditWorkCompliance({cwd: PROJECT, includeFileDiff: true});
    log(`  summary: entered=${r.summary.totalEntered} completed=${r.summary.totalCompleted} abandoned=${r.summary.totalAbandoned} stillOpen=${r.summary.stillOpen}`);
    log(`  dispatchDrifts: ${r.summary.dispatchDriftCount}`);
    if (r.fileDiffs) {
      log(`  fileDiffs: ${r.fileDiffs.length} entries`);
      for (const d of r.fileDiffs) {
        log(`    [${d.featureId}] inScope=${d.inScope.length} unmapped=${d.unmapped.length}`);
        if (d.unmapped.length > 0) log(`      unmapped sample: ${d.unmapped.slice(0, 3).join(', ')}`);
      }
    }

    // Persona × host envelope spot-check using the loaded reviewer persona.
    const reviewer = loadPersona('reviewer');
    const env = translateCapabilities(reviewer, 'codex');
    log(`  translateCapabilities(reviewer, codex) → ${JSON.stringify(env)}`);
  },
};

const stepCheck: Step = {
  name: 'check',
  run: () => {
    log('Running clad check against the project…');
    try {
      const out = execSync(`node /Users/qwerfunch/Developer/work/cladding/bin/clad check`, {
        cwd: PROJECT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      log(out.split('\n').slice(-40).join('\n'));
    } catch (err) {
      const e = err as {stdout?: string; stderr?: string};
      log(`  ✗ check exited non-zero`);
      log(`  --- stdout ---\n${(e.stdout ?? '').split('\n').slice(-40).join('\n')}`);
      log(`  --- stderr ---\n${(e.stderr ?? '').slice(-2000)}`);
    }
  },
};

const STEPS: Step[] = [stepFeatures, stepScenario, stepWork, stepDrive, stepAudit, stepCheck];

async function main(): Promise<void> {
  const want = process.argv[2] ?? 'all';
  const steps =
    want === 'all' ? STEPS : STEPS.filter((s) => s.name === want);
  if (steps.length === 0) {
    log(`unknown step: ${want}. Available: all, ${STEPS.map((s) => s.name).join(', ')}`);
    process.exit(1);
  }
  for (const s of steps) {
    log(`=== step: ${s.name} ===`);
    try {
      await s.run();
    } catch (err) {
      log(`✗ step ${s.name} failed: ${(err as Error).message}`);
      log((err as Error).stack ?? '');
      process.exit(1);
    }
  }
  log('=== all steps complete ===');
}

main();
