/** Host-model prepare/apply bridge for onboarding (F-0f4dd6). */

import {basename, join, resolve} from 'node:path';
import {existsSync, readFileSync} from 'node:fs';

import yaml from 'yaml';

import {detectToolchain} from '../stages/toolchain/detect.js';
import {scanRoot} from './scan/index.js';
import {loadState} from './scan/onboarding-state.js';

export interface HostOnboardingDraft {
  readonly mode: 'greenfield' | 'existing-adoption' | 'mixed';
  readonly project_context: {
    readonly why: string;
    readonly problem: string;
    readonly purpose: string;
  };
  readonly capabilities: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly summary: string;
    readonly surface: 'feature' | 'platform' | 'tool' | 'infrastructure';
  }>;
  readonly architecture: {
    readonly layers: ReadonlyArray<{readonly name: string; readonly forbidden_imports: readonly string[]}>;
  };
  readonly scenarios: ReadonlyArray<{
    readonly slug: string;
    readonly title: string;
    readonly flow: string;
  }>;
  readonly questions: readonly string[];
  readonly ai_hints?: Record<string, unknown>;
}

export interface HostPreparation {
  readonly prompt: string;
  readonly request: {readonly mode: string; readonly intent: string};
  readonly observation: Record<string, unknown>;
}

function compactScan(cwd: string): Record<string, unknown> {
  const scan = scanRoot({cwd});
  return {
    project_name: basename(resolve(cwd)),
    language: scan.stats.dominantLanguage === 'unknown' ? detectToolchain(cwd) : scan.stats.dominantLanguage,
    source_file_count: scan.stats.filesScanned,
    readme_first_paragraph: scan.projectContext?.readmeFirstParagraph ?? null,
    readme_headings: (scan.projectContext?.readmeHeadings ?? []).slice(0, 10),
    layers: scan.architecture.layers.slice(0, 12).map((layer) => ({name: layer.name, modules: layer.moduleCount})),
    import_edges: scan.architecture.importGraph.slice(0, 12),
    conventions: scan.conventions,
    public_signatures: scan.examples.slice(0, 6).map((example) => ({
      layer: example.layer,
      module: example.modulePath,
      signature: example.moduleContent.split('\n').filter((line) => /\b(export|class|interface|function)\b/.test(line)).slice(0, 3),
    })),
  };
}

/** Builds a bounded, read-only briefing for the current host model. */
export function prepareHostInit(cwd: string, mode: string, intent: string): HostPreparation {
  const observation = compactScan(cwd);
  const prompt = [
    'Draft Cladding onboarding data from the user request and observations below.',
    'Return one object matching the supplied MCP draft schema; do not edit files or run shell commands.',
    'Use the user language. Infer useful domain practices, but keep questions at product/business level.',
    'Produce 3-8 capabilities and 1-3 user-journey scenarios.',
    'Ask 0-3 product questions only for material decisions that the intent and observations do not already resolve.',
    'A complete planning document must produce zero questions; record deferrable uncertainty in the draft instead of blocking development.',
    'Architecture layers must be lean and use kebab-case capability/scenario identifiers.',
    '',
    `Starting mode: ${mode}`,
    'User intent:',
    intent,
    '',
    'Observed project:',
    JSON.stringify(observation, null, 2),
  ].join('\n');
  return {prompt, request: {mode, intent}, observation};
}

/** Builds a read-only refinement briefing without consuming the answer. */
export function prepareHostClarify(cwd: string, answer: string): HostPreparation | {readonly error: string} {
  const state = loadState(cwd);
  if (!state) return {error: 'no onboarding session'};
  const pending = state.qa.find((qa) => qa.answer === null);
  if (!pending) return {error: 'onboarding is already complete'};
  const current = {
    project_context: readOptional(join(cwd, 'docs/project-context.md')),
    capabilities: readOptional(join(cwd, 'spec/capabilities.yaml')),
    architecture: readOptional(join(cwd, 'spec/architecture.yaml')),
  };
  const observation = {state, current};
  const prompt = [
    'Refine the Cladding onboarding draft using the user answer below.',
    'Return one object matching the supplied MCP draft schema; preserve decisions that the answer does not change.',
    'Do not edit files or run shell commands. Ask 0-3 new product-level questions only when needed.',
    '',
    `Pending question: ${pending.question}`,
    `User answer (verbatim): ${answer}`,
    '',
    'Current onboarding state and artifacts:',
    JSON.stringify(observation, null, 2),
  ].join('\n');
  return {prompt, request: {mode: state.mode, intent: state.intent}, observation};
}

function readOptional(path: string): string {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/**
 * Reads the schema a workspace declares, without loading or compiling it.
 *
 * A directory with no `spec.yaml` is about to be scaffolded, and a fresh
 * scaffold is schema 0.2 — so an absent root reads as 0.2 rather than legacy.
 *
 * @param cwd - Workspace root to inspect.
 * @returns The declared schema, defaulting to `0.2`.
 */
function workspaceSchema(cwd: string): '0.1' | '0.2' {
  const path = join(cwd, 'spec.yaml');
  if (!existsSync(path)) return '0.2';
  try {
    const root = yaml.parse(readFileSync(path, 'utf8')) as {schema?: unknown} | null;
    return root && root.schema === '0.1' ? '0.1' : '0.2';
  } catch {
    return '0.2';
  }
}

/**
 * Converts validated host data into the existing sentinel interpreter input.
 *
 * The capability catalog carries the legacy `schema` and `source` markers only
 * for a schema 0.1 workspace. Neither belongs in a schema 0.2 catalog, and the
 * interpreter reads the block with or without them.
 *
 * @param draft - Host-validated onboarding data.
 * @param cwd - Workspace the draft will be applied to.
 * @returns The sentinel-delimited interpreter input.
 * @see spec/features/spec-02-native-onboarding-c4df5fb4.yaml AC-44fd1b7d
 */
export function renderHostDraft(draft: HostOnboardingDraft, cwd: string = '.'): string {
  const context = [
    '## 1. Why does this project exist?', '', draft.project_context.why,
    '', '## 2. What problem does it solve?', '', draft.project_context.problem,
    '', '## 3. What is its purpose?', '', draft.project_context.purpose,
  ].join('\n');
  const capabilities = yaml.stringify(
    workspaceSchema(cwd) === '0.1'
      ? {schema: '0.1', source: 'intent', capabilities: draft.capabilities}
      : {capabilities: draft.capabilities},
    {lineWidth: 0},
  ).trim();
  const architecture = yaml.stringify({layers: draft.architecture.layers}, {lineWidth: 0}).trim();
  const scenarios = yaml.stringify(draft.scenarios.map((scenario) => ({...scenario, features: []})), {lineWidth: 0}).trim();
  const metadata = draft.ai_hints ? yaml.stringify(draft.ai_hints, {lineWidth: 0}).trim() : '';
  return [
    '=== ONBOARDING_MODE ===', draft.mode,
    '=== PROJECT_CONTEXT_MD ===', context,
    '=== CAPABILITIES_YAML ===', capabilities,
    '=== ARCHITECTURE_YAML ===', architecture,
    '=== SPEC_SEED_TITLE ===', draft.project_context.purpose,
    '=== SCENARIOS_YAML ===', scenarios,
    '=== PROJECT_METADATA ===', metadata,
    '=== CLARIFYING_QUESTIONS ===', ...draft.questions.map((question) => `- ${question}`),
  ].join('\n');
}
