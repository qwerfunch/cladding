// Cladding · plugin asset builder.
//
// The managed persona/skill lanes are planned by the shared pure census. This
// script is the writer only: it validates the complete byte/region plan against
// D10 before its first mutation and then applies that already-validated plan.

import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {derivePluginMirror, mirrorOperationPlan} from './plugin-mirror-policy.mjs';

const CLAUDE_PLUGIN_DIR = 'plugins/claude-code';
const CLAUDE_PLUGIN_JSON = `${CLAUDE_PLUGIN_DIR}/.claude-plugin/plugin.json`;

const census = derivePluginMirror('.');
if (!census.complete) {
  throw new Error(`plugin mirror canonical inputs are incomplete: ${census.issues.map((entry) => `${entry.kind}:${entry.path}`).join(', ')}`);
}

const operations = [...mirrorOperationPlan(census)];
const detectorPlan = detectorManifestPlan();
operations.push(...detectorPlan.operations);
const bundledPlan = bundledEnginePlan();
operations.push(...bundledPlan.operations);

preflight(operations);
applyOperations(operations);

const finalCensus = derivePluginMirror('.');
if (!finalCensus.clean) {
  throw new Error(`plugin mirror reconciliation failed: ${finalCensus.issues.map((entry) => `${entry.kind}:${entry.path}`).join(', ')}`);
}
validateHooksConfig();

console.log(`cladding plugin · mirror: reconciled ${census.expected.length} managed outputs across six lanes`);
if (bundledPlan.present) {
  console.log('cladding plugin · claude-code: bundled engine (clad.js + schema.json) → plugins/claude-code/dist/');
} else {
  console.warn('cladding plugin · claude-code: dist/clad.js absent — run npm run build before plugin packaging');
}
console.log(detectorPlan.detectorChanged
  ? `cladding plugin · detectors: recomputed → ${detectorPlan.count}/${detectorPlan.count} (updated ${CLAUDE_PLUGIN_JSON})`
  : `cladding plugin · detectors: ${detectorPlan.count}/${detectorPlan.count} (already in sync)`);
if (detectorPlan.stageCount === undefined) {
  console.warn('cladding plugin · stages: could not parse TIER_STAGES.all from src/cli/clad.ts — array left as-is');
} else {
  console.log(detectorPlan.stageChanged
    ? `cladding plugin · stages: re-derived → ${detectorPlan.stageCount} stages (updated ${CLAUDE_PLUGIN_JSON})`
    : `cladding plugin · stages: ${detectorPlan.stageCount} stages (already in sync)`);
}

function bundledEnginePlan() {
  const operations = [];
  if (!isRegularFile('dist/clad.js') || !isRegularFile('dist/schema.json')) return {operations, present: false};
  for (const [source, destination, executable] of [
    ['dist/clad.js', 'plugins/claude-code/dist/clad.js', true],
    ['dist/schema.json', 'plugins/claude-code/dist/schema.json', false],
  ]) {
    const bytes = readFileSync(source, 'utf8');
    if (readExisting(destination) !== bytes || executable) {
      operations.push({operation: 'update', path: destination, bytes, ...(executable ? {executable: true} : {})});
    }
  }
  return {operations, present: true};
}

function detectorManifestPlan() {
  const count = readdirSync('src/stages/detectors').filter((name) =>
    name.endsWith('.ts') && name !== 'index.ts' && name !== 'with-spec.ts' && name !== 'spec-first-window.ts').length;
  const original = readFileSync(CLAUDE_PLUGIN_JSON, 'utf8');
  const detectors = replaceDetectorCount(original, count);
  const stages = existsSync('src/cli/clad.ts')
    ? deriveStageList(readFileSync('src/cli/clad.ts', 'utf8'))
    : undefined;
  const finalBytes = stages === undefined ? detectors.bytes : replaceStageList(detectors.bytes, stages).bytes;
  const operations = [];
  if (detectors.changed) operations.push({
    operation: 'update', path: CLAUDE_PLUGIN_JSON, region: 'ironclad.detectors', bytes: detectors.bytes,
  });
  const stageChanged = stages !== undefined && finalBytes !== detectors.bytes;
  if (stageChanged) operations.push({
    operation: 'update', path: CLAUDE_PLUGIN_JSON, region: 'stages-implemented', bytes: finalBytes,
  });
  return {
    operations,
    count,
    detectorChanged: detectors.changed,
    stageChanged,
    ...(stages === undefined ? {} : {stageCount: stages.length}),
  };
}

function replaceDetectorCount(bytes, count) {
  const expected = `"${count}/${count}"`;
  let updated = bytes.replace(/("target":\s*\{[\s\S]*?"detectors":\s*)"\d+\/\d+"/, `$1${expected}`);
  updated = updated.replace(/("current":\s*\{[\s\S]*?"detectors":\s*)"\d+\/\d+"/, `$1${expected}`);
  return {bytes: updated, changed: updated !== bytes};
}

function deriveStageList(source) {
  const match = source.match(/TIER_STAGES[\s\S]*?\ball:\s*\[([^\]]*)\]/);
  return match ? [...match[1].matchAll(/['"]([^'"]+)['"]/g)].map((entry) => entry[1]) : undefined;
}

function replaceStageList(bytes, stages) {
  const expected = `[${stages.map((stage) => `"${stage}"`).join(', ')}]`;
  const updated = bytes.replace(/("stages-implemented":\s*)\[[^\]]*\]/, `$1${expected}`);
  return {bytes: updated, changed: updated !== bytes};
}

function preflight(plan) {
  const helper = fileURLToPath(new URL('./plugin-write-preflight.ts', import.meta.url));
  const tsx = fileURLToPath(import.meta.resolve('tsx'));
  execFileSync(process.execPath, ['--import', tsx, helper], {
    input: JSON.stringify(plan.map(({operation, path, region}) => ({operation, path, ...(region === undefined ? {} : {region})}))),
    stdio: 'pipe',
  });
}

function applyOperations(plan) {
  for (const operation of plan) {
    if (operation.operation === 'delete') {
      rmSync(operation.path, {recursive: true, force: true});
      continue;
    }
    mkdirSync(dirname(operation.path), {recursive: true});
    writeFileSync(operation.path, operation.bytes);
    if (operation.executable) chmodSync(operation.path, 0o755);
  }
}

function readExisting(path) {
  try {
    return isRegularFile(path) ? readFileSync(path, 'utf8') : undefined;
  } catch {
    return undefined;
  }
}

function isRegularFile(path) {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function validateHooksConfig() {
  const path = 'plugins/claude-code/hooks/hooks.json';
  try {
    const hooks = JSON.parse(readFileSync(path, 'utf8'));
    if (Object.keys(hooks.hooks ?? {}).length === 0) throw new Error('no events wired under hooks');
    console.log(`cladding plugin · claude-code: hooks wiring OK (${Object.keys(hooks.hooks ?? {}).length} events) — ${path}`);
  } catch (error) {
    console.warn(`cladding plugin · claude-code: WARN ${path} missing/invalid (${error.message}) — lifecycle hooks will not fire`);
  }
}
