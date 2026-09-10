// Cladding · `clad init --scan` — LLM interpretation layer
//
// Takes the deterministic {@link ScanResult} from scan.ts and produces
// the human-readable `docs/conventions.md` + `spec/architecture.yaml` +
// per-scenario `flow` text that downstream specialist agents consume.
//
// The LLM call is abstracted as an injectable dispatcher so this module
// stays unit-testable without the MCP sampling stack. The production
// dispatcher (v0.3.25) will route through `src/adapters/host/sampling-
// context.ts` once it lands; v0.3.24 ships the contract + the
// {@link deterministicInterpret} fallback so `--no-llm` runs (and CI
// invocations without a sampling-capable host) still produce valid
// artifacts — just less polished prose.
//
// @see ironclad-design/07-ssot-init.md §3 B
// @see scan.ts — deterministic data source
// @see src/adapters/host/sampling-context.ts — dispatcher candidate

import {parse as parseYaml} from 'yaml';

import {appendEvent, newEvent} from '../../events/log.js';
import type {ProjectContext, ScanResult, Conventions, Layer} from './types.js';

/**
 * v0.3.39 — emit a `sentinel_miss` lifecycle event so adopters can
 * tune their host's sampling policy (model · max_tokens · temperature)
 * based on how often the LLM dispatcher misses a labelled sentinel.
 * Optional `cwd` keeps existing unit tests (which call the LLM helpers
 * directly without a workspace) telemetry-silent. Production callers
 * (`src/cli/init.ts`) always pass `cwd` so events land in
 * `<cwd>/.cladding/events.log.jsonl`.
 */
function emitSentinelMiss(cwd: string | undefined, payload: Record<string, unknown>): void {
  if (!cwd) return;
  try {
    appendEvent(cwd, newEvent('sentinel_miss', payload));
  } catch {
    // Telemetry must never break the init flow. A read-only workspace
    // or a transient fs error swallows here; the artifacts already
    // wrote successfully via writeArtifact.
  }
}

/** Single-prompt dispatcher injected by callers. */
export type ScanLlmDispatcher = (prompt: string) => Promise<string>;

/** Interpreted artifacts ready for file write. */
export interface InterpretedScan {
  /** Final `docs/conventions.md` body. Includes the auto-generated header. */
  readonly conventionsMd: string;
  /** Final `spec/architecture.yaml` body, schema-conformant. */
  readonly architectureYaml: string;
  /** Per-scenario `flow` text keyed by scenario slug. */
  readonly scenarioFlows: ReadonlyMap<string, string>;
  /**
   * Final `spec/capabilities.yaml` body — README ## headings rendered as
   * capability entries. v0.3.38 mirrors what `docs/project-context.md`
   * already surfaced into a first-class spec artifact so downstream
   * detectors can read the capability list directly.
   */
  readonly capabilitiesYaml: string;
  /** Identifies how the artifacts were produced — surfaces in commit notes. */
  readonly mode: 'llm' | 'deterministic';
  /**
   * Names of sentinels the LLM left blank in the parsed reply
   * (`CONVENTIONS_MD` / `ARCHITECTURE_YAML` / `SCENARIO_FLOWS` /
   * `CAPABILITIES_YAML`). Populated by {@link interpretWithLlm};
   * {@link interpretScanWithFallback} reads it to decide between a
   * per-artifact fallback (only capabilities or scenarios blank) and a
   * total fallback (conventions or architecture blank), and to emit
   * the corresponding `sentinel_miss` telemetry event. Empty array
   * means the LLM reply filled every sentinel.
   */
  readonly missedSections: readonly string[];
}

const HEADER =
  '<!-- Cladding · Tier C · derived from observed code · Refreshed by: clad init --scan -->';

/**
 * Packs the deterministic scan data into a single prompt the LLM can
 * turn into prose. The prompt asks for three labelled sections so
 * {@link parseLlmResponse} can split them by sentinel rather than
 * trying to parse free-form markdown.
 */
export function buildPrompt(scan: ScanResult): string {
  const conv = scan.conventions;
  const examples = scan.examples
    .map(
      (e) =>
        `### ${e.layer} — ${e.modulePath}\n\n\`\`\`\n${e.moduleContent}\n\`\`\`` +
        (e.testContent ? `\n\n### ${e.layer} test — ${e.testPath}\n\n\`\`\`\n${e.testContent}\n\`\`\`` : ''),
    )
    .join('\n\n');
  const layers = scan.architecture.layers.map((l) => `- ${l.name} (${l.moduleCount} modules)`).join('\n');
  const importEdges = scan.architecture.importGraph
    .slice(0, 20)
    .map((e) => `- ${e.from} → ${e.to} (${e.count})`)
    .join('\n');
  const readmeHeadings = scan.projectContext?.readmeHeadings ?? [];
  const readmeHeadingsBlock = readmeHeadings.length > 0
    ? readmeHeadings.map((h) => `- ${h}`).join('\n')
    : '(none observed)';
  return [
    'You are the planner agent of a project that just adopted cladding.',
    'Four deliverables. Use the exact sentinels below so output is parsable.',
    '',
    '=== CONVENTIONS_MD ===',
    'Write a docs/conventions.md body documenting observed conventions',
    'plus a "Adding a new module" section that lets a future AI maintain',
    'this project in the same shape. Be concrete and quote the example.',
    '',
    '=== ARCHITECTURE_YAML ===',
    'Write spec/architecture.yaml. Schema:',
    '  layers: [{name, forbidden_imports:[<layer>]}, ...]',
    'Use the observed import graph to infer forbidden_imports (pairs',
    'never seen in the graph become candidates). Add a 1-line comment',
    'per layer summarising its responsibility.',
    '',
    '=== SCENARIO_FLOWS ===',
    'For each layer below, write one or two sentences describing the',
    'business flow that layer enables. Format: `<slug>: <prose>`.',
    '',
    '=== CAPABILITIES_YAML ===',
    'Write spec/capabilities.yaml. Schema:',
    '  schema: "0.1"',
    '  source: README.md',
    '  capabilities:',
    '    - id: <kebab-slug>',
    '      title: "<verbatim README heading>"',
    '      summary: "<one sentence — what this capability does>"',
    '      surface: feature | platform | tool | infrastructure',
    'Use the README headings below as the capability list. Do not invent',
    'capabilities not in the README. Preserve titles verbatim. Choose',
    '`surface` from README context: user-facing functionality → feature;',
    'runtime or build machinery → platform; CLI command → tool; library',
    'or infra plumbing → infrastructure. Quote titles containing `:` or',
    '`&`. If no headings are observed, emit `capabilities: []`.',
    '',
    '--- Observed conventions ---',
    JSON.stringify(conv, null, 2),
    '',
    '--- Layers ---',
    layers,
    '',
    '--- Import graph (top 20) ---',
    importEdges,
    '',
    '--- README headings (capability candidates) ---',
    readmeHeadingsBlock,
    '',
    '--- Example modules ---',
    examples,
  ].join('\n');
}

/**
 * Splits the LLM response into the three labelled sections. Returns
 * the parts verbatim; callers prepend the header and final wrapping.
 */
export function parseLlmResponse(text: string): {
  readonly conventions: string;
  readonly architecture: string;
  readonly scenarios: string;
  readonly capabilities: string;
} {
  const conv = extractSection(text, 'CONVENTIONS_MD');
  const arch = extractSection(text, 'ARCHITECTURE_YAML');
  const scen = extractSection(text, 'SCENARIO_FLOWS');
  const caps = extractSection(text, 'CAPABILITIES_YAML');
  return {conventions: conv, architecture: arch, scenarios: scen, capabilities: caps};
}

function extractSection(text: string, name: string): string {
  const re = new RegExp(`=== ${name} ===([\\s\\S]*?)(?:===\\s*[A-Z_]+\\s*===|$)`);
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Runs the LLM path: prompts, parses, and assembles the InterpretedScan.
 * Errors (transport, parse) flow up to the caller — fallback to
 * deterministic mode is the caller's policy decision, not this
 * function's.
 */
export async function interpretWithLlm(
  scan: ScanResult,
  dispatch: ScanLlmDispatcher,
): Promise<InterpretedScan> {
  const prompt = buildPrompt(scan);
  const raw = await dispatch(prompt);
  const sections = parseLlmResponse(raw);
  const scenarioFlows = new Map<string, string>();
  for (const line of sections.scenarios.split('\n')) {
    const m = line.match(/^([\w-]+):\s+(.+)$/);
    if (m) scenarioFlows.set(m[1], m[2]);
  }
  // Per-artifact fallback for capabilities — when the LLM omits the
  // section (no sentinel or blank between sentinels) the deterministic
  // renderer fills in from observed README headings so the file still
  // ships with real data instead of `capabilities: []`.
  const capabilitiesYaml = sections.capabilities.trim()
    ? ensureTrailingNewline(sections.capabilities)
    : renderCapabilitiesYaml(scan.projectContext?.readmeHeadings ?? []);
  // v0.3.39 — track every blank sentinel so the outer fallback wrapper
  // can decide whether the run was a per-artifact miss (only auxiliary
  // sections blank → keep mode=llm) or a total miss (conventions or
  // architecture blank → collapse to deterministic) and emit the
  // corresponding sentinel_miss telemetry event. The check inspects
  // the raw section strings, not the substituted bodies, so it sees
  // the LLM reply state rather than the post-fallback artifact.
  const missedSections: string[] = [];
  if (!sections.conventions.trim()) missedSections.push('CONVENTIONS_MD');
  if (!sections.architecture.trim()) missedSections.push('ARCHITECTURE_YAML');
  if (!sections.scenarios.trim()) missedSections.push('SCENARIO_FLOWS');
  if (!sections.capabilities.trim()) missedSections.push('CAPABILITIES_YAML');
  return {
    conventionsMd: `${HEADER}\n\n${sections.conventions}`,
    architectureYaml: sections.architecture,
    scenarioFlows,
    capabilitiesYaml,
    mode: 'llm',
    missedSections,
  };
}

function ensureTrailingNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Best-effort variant of {@link interpretWithLlm} that collapses to
 * {@link deterministicInterpret} when the dispatcher is null or
 * throws. Mirrors the {@link renderProjectContextMdWithLlm} contract
 * so init.ts can route both scan-artifact and project-context
 * refinement through the same dispatcher selection without
 * try/catch boilerplate.
 *
 * Why a separate helper rather than letting init.ts wrap
 * interpretWithLlm directly: parse failure (missing sentinels,
 * blank reply, malformed YAML in the architecture section) should
 * also collapse to deterministic so the user always gets a
 * loadable artifact. Centralising the policy here keeps the two
 * refinement paths symmetric.
 *
 * @param scan The deterministic scan output to refine.
 * @param dispatcher LLM dispatcher; pass `null` to force deterministic.
 */
export async function interpretScanWithFallback(
  scan: ScanResult,
  dispatcher: ScanLlmDispatcher | null,
  cwd?: string,
): Promise<InterpretedScan> {
  if (dispatcher === null) return deterministicInterpret(scan);
  let interp: InterpretedScan;
  try {
    interp = await interpretWithLlm(scan, dispatcher);
  } catch (e) {
    emitSentinelMiss(cwd, {
      phase: 'scan_artifacts',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: truncateError(e),
    });
    return deterministicInterpret(scan);
  }
  // A blank or syntactically invalid architecture section cannot become a
  // usable architecture artifact. Fall back to deterministic so reviewers
  // see the observed layer names instead of an unusable LLM reply.
  const totalMissed = interp.missedSections.filter(
    (s) => s === 'CONVENTIONS_MD' || s === 'ARCHITECTURE_YAML',
  );
  if (totalMissed.length > 0 || !hasArchitectureLayers(interp.architectureYaml)) {
    emitSentinelMiss(cwd, {
      phase: 'scan_artifacts',
      cause: totalMissed.length > 0 ? 'blank_section' : 'malformed_section',
      fallback: 'total',
      missed_sections: [...interp.missedSections],
    });
    return deterministicInterpret(scan);
  }
  const malformedScenarioFlows =
    scan.scenarios.length > 0 && interp.scenarioFlows.size === 0;
  const malformedCapabilities = !hasCapabilities(interp.capabilitiesYaml);
  if (interp.missedSections.length > 0 || malformedScenarioFlows || malformedCapabilities) {
    // Conventions + architecture passed, but an auxiliary artifact is blank or
    // malformed. Keep the valid LLM refinements while restoring only that
    // artifact from the deterministic interpretation.
    const deterministic = deterministicInterpret(scan);
    const malformedSections = [
      ...(malformedScenarioFlows ? ['SCENARIO_FLOWS'] : []),
      ...(malformedCapabilities ? ['CAPABILITIES_YAML'] : []),
    ];
    emitSentinelMiss(cwd, {
      phase: 'scan_artifacts',
      cause: malformedSections.length > 0 ? 'malformed_section' : 'blank_section',
      fallback: 'per_artifact',
      missed_sections: [...new Set([...interp.missedSections, ...malformedSections])],
    });
    return {
      ...interp,
      scenarioFlows: malformedScenarioFlows ? deterministic.scenarioFlows : interp.scenarioFlows,
      capabilitiesYaml: malformedCapabilities ? deterministic.capabilitiesYaml : interp.capabilitiesYaml,
    };
  }
  return interp;
}

/** Returns whether an LLM architecture section is a loadable layer document. */
function hasArchitectureLayers(text: string): boolean {
  try {
    const parsed: unknown = parseYaml(text);
    return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as {layers?: unknown}).layers);
  } catch {
    return false;
  }
}

/** Returns whether an LLM capabilities section has the required list shape. */
function hasCapabilities(text: string): boolean {
  try {
    const parsed: unknown = parseYaml(text);
    return typeof parsed === 'object' && parsed !== null && Array.isArray((parsed as {capabilities?: unknown}).capabilities);
  } catch {
    return false;
  }
}

function truncateError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

/**
 * `--no-llm` fallback. Builds artifacts straight from the scan data
 * with no LLM call. The conventions doc becomes a structured table
 * (less prose, same facts); architecture.yaml carries the observed
 * layers with placeholder responsibilities; scenario flows fall back
 * to a one-liner per layer that names the directory.
 *
 * The header explicitly notes the deterministic mode so reviewers
 * know the file lacks LLM polish.
 */
export function deterministicInterpret(scan: ScanResult): InterpretedScan {
  const conventionsMd = `${HEADER}\n\n` + renderConventionsTable(scan.conventions, scan.examples);
  const architectureYaml = renderArchitectureYaml(
    scan.architecture.layers,
    scan.architecture.forbiddenImportCandidates,
  );
  const scenarioFlows = new Map<string, string>();
  for (const s of scan.scenarios) {
    scenarioFlows.set(s.slug, `Flow through ${s.dir}/ (${s.moduleCount} modules) — describe the business behaviour this layer enables.`);
  }
  const capabilitiesYaml = renderCapabilitiesYaml(scan.projectContext?.readmeHeadings ?? []);
  // Deterministic mode never inspects an LLM reply, so it has no
  // sentinels to miss — the field stays empty.
  return {
    conventionsMd,
    architectureYaml,
    scenarioFlows,
    capabilitiesYaml,
    mode: 'deterministic',
    missedSections: [],
  };
}

function renderConventionsTable(c: Conventions, examples: ScanResult['examples']): string {
  const lines: string[] = [
    '# Project conventions',
    '',
    '_Mode: deterministic (no LLM polish). Re-run `clad scan` without `--no-llm` for prose._',
    '',
    '## Observed style',
    '',
    '| key | value |',
    '|---|---|',
    `| indent | ${c.indent} |`,
    `| quote | ${c.quote} |`,
    `| semicolon | ${c.semicolon} |`,
    `| naming (exports) | ${c.namingExports} |`,
    `| naming (constants) | ${c.namingConstants} |`,
    `| docblock ratio | ${c.docBlockRatio.toFixed(2)} |`,
    `| import order | ${c.importOrder} |`,
    `| export pattern | ${c.exportPattern} |`,
    `| error handling | ${c.errorHandling} |`,
    `| type def location | ${c.typeDefLocation} |`,
    `| test location | ${c.testLocation} |`,
    `| file header | ${c.fileHeaderPattern ?? '(none)'} |`,
    '',
    '## Doc tag frequency',
    '',
  ];
  for (const [tag, count] of Object.entries(c.docTagCounts)) {
    lines.push(`- \`${tag}\`: ${count}`);
  }
  lines.push('', '## Module boilerplate (smallest exported module observed)', '');
  if (c.moduleBoilerplate) {
    lines.push('```', c.moduleBoilerplate, '```');
  } else {
    lines.push('(none observed yet)');
  }
  if (examples.length > 0) {
    lines.push('', '## Representative modules');
    for (const e of examples) {
      lines.push('', `### ${e.layer} · ${e.modulePath}`, '', '```', e.moduleContent, '```');
      if (e.testContent && e.testPath) {
        lines.push('', `### ${e.layer} test · ${e.testPath}`, '', '```', e.testContent, '```');
      }
    }
  }
  return lines.join('\n');
}

function renderArchitectureYaml(
  layers: readonly Layer[],
  forbiddenCandidates: Readonly<Record<string, readonly string[]>>,
): string {
  const lines: string[] = [
    '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init --scan',
    '# `forbidden_imports` lists layer pairs the scan never observed in',
    '# your import graph — they are candidates, not enforced rules.',
    '# Prune the list to the ones you actually want to forbid before committing.',
    // A bare `layers:` with no entries parses to YAML null and fails the
    // schema's `type: array` check, so the whole spec fails to load — a flat
    // 3–4 file project (or any `--scan` run) that yields zero layers would
    // brick the adopter's first `clad init`. Render the empty case as an
    // explicit empty array, mirroring greenfield-seeds.ts.
    layers.length === 0 ? 'layers: []' : 'layers:',
  ];
  for (const l of layers) {
    const candidates = forbiddenCandidates[l.name] ?? [];
    const forbiddenList = candidates.length === 0 ? '[]' : `[${candidates.map((c) => `"${c}"`).join(', ')}]`;
    lines.push(`  - name: ${l.name}`);
    lines.push(`    modules: ["${l.dir}/**"]`);
    lines.push(`    forbidden_imports: ${forbiddenList}`);
  }
  return lines.join('\n') + '\n';
}

/**
 * Renders `spec/capabilities.yaml` deterministically from observed
 * README ## headings. Each heading becomes one capability entry with
 * a kebab-case `id` slug and the verbatim `title`. LLM-refined runs
 * replace this body with one that also carries `summary` + `surface`
 * fields per entry — the schema is forward-compatible so deterministic
 * and LLM modes load through the same reader.
 */
export function renderCapabilitiesYaml(headings: readonly string[]): string {
  const lines: string[] = [
    '# Cladding · Tier B · SSoT — editable, cross-validated · Refreshed by: clad init --scan',
    '# README ## headings are interpreted as capability candidates.',
    '# Each entry carries the verbatim title; LLM-refined runs add a',
    '# one-sentence summary, surface classification, and optional features[]',
    '# binding (consumed by the CAPABILITIES_FEATURE_MAPPING detector).',
    'schema: "0.1"',
    'source: README.md',
  ];
  if (headings.length === 0) {
    lines.push('capabilities: []');
  } else {
    lines.push('capabilities:');
    for (const h of headings) {
      const id = slugifyCapability(h);
      lines.push(`  - id: ${id}`);
      lines.push(`    title: ${quoteYamlString(h)}`);
    }
  }
  return lines.join('\n') + '\n';
}

function slugifyCapability(heading: string): string {
  const slug = heading
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'capability';
}

function quoteYamlString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const PROJECT_CONTEXT_HEADER =
  '<!-- Cladding · Tier B · SSoT — intent + Why/What/Purpose · Refreshed by: clad init / clad clarify -->\n' +
  '<!-- Observed when README is present, template otherwise. Review and edit. -->';

const PROJECT_CONTEXT_HEADER_LLM =
  '<!-- Cladding · Tier B · SSoT — intent + Why/What/Purpose (LLM-refined) · Refreshed by: clad init / clad clarify -->\n' +
  '<!-- Review the Why and Purpose sections — they were inferred from README + docs. -->';

/**
 * Builds the LLM prompt that turns observed README/doc snippets
 * into polished Why / What / Purpose prose. Three labelled
 * sections so {@link parseProjectContextResponse} can split the
 * reply deterministically.
 */
export function buildProjectContextPrompt(ctx: ProjectContext, projectName: string): string {
  const headings = ctx.readmeHeadings.length > 0
    ? ctx.readmeHeadings.map((h) => `- ${h}`).join('\n')
    : '(none observed)';
  const docs = ctx.docLinks.length > 0
    ? ctx.docLinks.map((d) => `- ${d.path}: ${d.firstLine}`).join('\n')
    : '(none found)';
  const ifaces = ctx.interfaceSignatures.length > 0
    ? ctx.interfaceSignatures
        .map((entry) => `### ${entry.layer}\n${entry.signatures.join('\n')}`)
        .join('\n\n')
    : '(none extracted)';
  return [
    `You are the planner agent for the project "${projectName}".`,
    'You will turn observed README + docs into the Why / What / Purpose',
    'sections of docs/project-context.md. Use the exact sentinels below',
    'so the output is parsable.',
    '',
    'Constraints:',
    '- Be specific. Avoid generic phrases like "modern", "powerful", "robust"',
    '  unless they are clearly the project\'s own framing.',
    '- Three sentences max per section.',
    '- Prose, not bullet lists. No headings inside sections.',
    '',
    '=== WHY ===',
    'Why does this project exist? What gap or pain led to it?',
    '',
    '=== WHAT ===',
    'What problem does it solve, in concrete terms? Who feels the pain?',
    '',
    '=== PURPOSE ===',
    'The vision in one or two sentences. What does success look like?',
    '',
    '--- Observed input ---',
    '',
    `README first paragraph:\n> ${ctx.readmeFirstParagraph ?? '(none observed)'}`,
    '',
    'README headings (potential capabilities):',
    headings,
    '',
    'Sibling docs (with first content line):',
    docs,
    '',
    'Representative interfaces:',
    ifaces,
  ].join('\n');
}

/** Splits the LLM response into the three labelled sections. */
export function parseProjectContextResponse(text: string): {
  readonly why: string;
  readonly what: string;
  readonly purpose: string;
} {
  return {
    why: extractSection(text, 'WHY'),
    what: extractSection(text, 'WHAT'),
    purpose: extractSection(text, 'PURPOSE'),
  };
}

/**
 * Async variant of {@link renderProjectContextMd}. When a
 * dispatcher is provided and the observed context is non-null,
 * the LLM is asked to write Why / What / Purpose prose; on any
 * failure the deterministic body is returned instead. Greenfield
 * (`ctx === null`) always uses the template — no LLM call.
 *
 * @param ctx Observed context or null (greenfield).
 * @param projectName Title heading.
 * @param dispatcher LLM dispatcher; pass `null` to force deterministic.
 */
export async function renderProjectContextMdWithLlm(
  ctx: ProjectContext | null,
  projectName: string,
  dispatcher: ScanLlmDispatcher | null,
  cwd?: string,
): Promise<string> {
  if (ctx === null || dispatcher === null) {
    return renderProjectContextMd(ctx, projectName);
  }
  let sections: {readonly why: string; readonly what: string; readonly purpose: string};
  try {
    const prompt = buildProjectContextPrompt(ctx, projectName);
    const reply = await dispatcher(prompt);
    sections = parseProjectContextResponse(reply);
  } catch (e) {
    // Any error path (transport, parsing) collapses to deterministic
    // so the user always gets a usable artifact. The miss is recorded
    // so adopters can correlate it with host or network issues.
    emitSentinelMiss(cwd, {
      phase: 'project_context',
      cause: 'dispatcher_error',
      fallback: 'total',
      error: truncateError(e),
    });
    return renderProjectContextMd(ctx, projectName);
  }
  // v0.3.39 — the refined renderer happily substitutes placeholder
  // text per blank section, so a sentinel miss never collapses the
  // whole artifact. Record the miss so adopters can see which
  // sections their host consistently struggles to fill.
  const missed: string[] = [];
  if (!sections.why.trim()) missed.push('WHY');
  if (!sections.what.trim()) missed.push('WHAT');
  if (!sections.purpose.trim()) missed.push('PURPOSE');
  if (missed.length > 0) {
    emitSentinelMiss(cwd, {
      phase: 'project_context',
      cause: 'blank_section',
      fallback: 'per_artifact',
      missed_sections: missed,
    });
  }
  return renderProjectContextRefined(ctx, projectName, sections);
}

function renderProjectContextRefined(
  ctx: ProjectContext,
  projectName: string,
  sections: {readonly why: string; readonly what: string; readonly purpose: string},
): string {
  const lines: string[] = [
    PROJECT_CONTEXT_HEADER_LLM,
    '',
    `# ${projectName} — Project Context`,
    '',
    '## 1. Why does this project exist?',
    '',
    sections.why || '_LLM did not return WHY — see README quote below._',
    '',
    '## 2. What problem does it solve?',
    '',
    sections.what || '_LLM did not return WHAT — see README quote below._',
    '',
    '## 3. What is its purpose?',
    '',
    sections.purpose || '_LLM did not return PURPOSE — see README quote below._',
    '',
  ];

  // Observed README quote (raw) under refined prose — keep the
  // ground truth visible so reviewers can audit the inference.
  if (ctx.readmeFirstParagraph) {
    lines.push(
      '## 4. README first paragraph (observed)',
      '',
      `> ${ctx.readmeFirstParagraph}`,
      '',
    );
  }
  if (ctx.docLinks.length > 0) {
    lines.push('## 5. Documented context', '');
    for (const link of ctx.docLinks) {
      lines.push(`- \`${link.path}\` — ${link.firstLine}`);
    }
    lines.push('');
  }
  if (ctx.readmeHeadings.length > 0) {
    lines.push(
      '## 6. Top-level sections (from README headings)',
      '',
      '_Mirrored into `spec/capabilities.yaml`; LLM-refined when a dispatcher is available._',
      '',
    );
    for (const h of ctx.readmeHeadings) lines.push(`- ${h}`);
    lines.push('');
  }
  if (ctx.interfaceSignatures.length > 0) {
    lines.push('## 7. Representative interfaces', '');
    for (const entry of ctx.interfaceSignatures) {
      lines.push(`### ${entry.layer}`, '', '```ts');
      for (const sig of entry.signatures) lines.push(sig);
      lines.push('```', '');
    }
  }
  lines.push(
    '## See also',
    '',
    '- `docs/conventions.md` — observed code conventions',
    '- `spec/architecture.yaml` — observed layers',
    '- `spec/capabilities.yaml` — README-derived capability inventory',
    '- `spec.yaml` — feature registry',
    '',
  );
  return lines.join('\n');
}

/**
 * Renders `docs/project-context.md` from an observed
 * {@link ProjectContext} or, when null, a fresh template. The
 * caller (init.ts) writes the result to disk and the template
 * route is what greenfield projects see.
 *
 * @param ctx Observed context, or null when no README + no docs +
 *   no source-side signatures surfaced.
 * @param projectName Used as the title heading.
 */
export function renderProjectContextMd(ctx: ProjectContext | null, projectName: string): string {
  if (ctx === null) return renderProjectContextTemplate(projectName);
  return renderProjectContextObserved(ctx, projectName);
}

function renderProjectContextTemplate(projectName: string): string {
  return [
    PROJECT_CONTEXT_HEADER,
    '',
    `# ${projectName} — Project Context`,
    '',
    'Entry document for any AI maintainer joining this codebase. Fill',
    'in the sections before requesting features so the spec stays',
    'honest about *why* the project exists.',
    '',
    '## 1. Why does this project exist?',
    '',
    '_Motivation. What gap or pain led to this project being started?_',
    '',
    '## 2. What problem does it solve?',
    '',
    '_Concrete problem statement. Who feels the pain? When?_',
    '',
    '## 3. What is its purpose?',
    '',
    '_Vision in one or two sentences. What does success look like?_',
    '',
    '## 4. Top-level capabilities',
    '',
    '_High-level functions this project provides. Sub-features register',
    'through `clad_create_feature` as work proceeds._',
    '',
    '- [ ] Capability 1 — short description',
    '- [ ] Capability 2 — short description',
    '',
    '## See also',
    '',
    '- `spec.yaml` — feature registry (grown by `clad_create_feature`)',
    '- `docs/code-style.md` — recommended code conventions for new code',
    '',
  ].join('\n');
}

function renderProjectContextObserved(ctx: ProjectContext, projectName: string): string {
  const lines: string[] = [
    PROJECT_CONTEXT_HEADER,
    '',
    `# ${projectName} — Project Context`,
    '',
  ];

  // 1. What this project is — README first paragraph (raw).
  lines.push('## 1. What this project is (observed)', '');
  if (ctx.readmeFirstParagraph) {
    lines.push(`> ${ctx.readmeFirstParagraph}`);
  } else {
    lines.push('_README first paragraph not found — please describe._');
  }
  lines.push('');

  // 2. Documented context — sibling docs inventory.
  if (ctx.docLinks.length > 0) {
    lines.push('## 2. Documented context', '');
    for (const link of ctx.docLinks) {
      lines.push(`- \`${link.path}\` — ${link.firstLine}`);
    }
    lines.push('');
  }

  // 3. Top-level sections — README headings.
  if (ctx.readmeHeadings.length > 0) {
    lines.push(
      '## 3. Top-level sections (from README headings)',
      '',
      '_Mirrored into `spec/capabilities.yaml`; LLM-refined when a dispatcher is available._',
      '',
    );
    for (const h of ctx.readmeHeadings) lines.push(`- ${h}`);
    lines.push('');
  }

  // 4. Representative interfaces — TS signatures from top layers.
  if (ctx.interfaceSignatures.length > 0) {
    lines.push('## 4. Representative interfaces', '');
    for (const entry of ctx.interfaceSignatures) {
      lines.push(`### ${entry.layer}`, '', '```ts');
      for (const sig of entry.signatures) lines.push(sig);
      lines.push('```', '');
    }
  }

  // 5. Why / Purpose — review needed (LLM refinement queued).
  lines.push(
    '## 5. Why / Purpose (review needed)',
    '',
    'The scan inferred raw text from your README — please refine the',
    'Why and Purpose sections by hand. Cladding cannot guess intent',
    'from observed code alone; the LLM-assisted v0.3.33+ pass will',
    'help refine these.',
    '',
    '## See also',
    '',
    '- `docs/conventions.md` — observed code conventions',
    '- `spec/architecture.yaml` — observed layers',
    '- `spec/capabilities.yaml` — README-derived capability inventory',
    '- `spec.yaml` — feature registry',
    '',
  );
  return lines.join('\n');
}
