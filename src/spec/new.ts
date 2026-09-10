// Cladding · spec · createFeature — internal feature creator (F-084).
//
// Issues a new sharded feature file at `spec/features/<slug>-<hash8>.yaml`
// with an automatically-generated content-hash id. Designed for
// multi-developer concurrency: two contributors can create features
// simultaneously on separate branches without git merge conflicts as
// long as their slugs differ — the hash id collision probability is
// < 1/4.3B per pair (8 hex chars; widened from 6 in 0.6.0 because the
// birthday bound at 6 hex reached ~50% near 5k features) and the hash
// input includes user + hostname + timestamp
// + hrtime.
//
// CLI surface: **none**. This function is invoked only from inside
// cladding (run loop, planner persona dispatch) or via the
// `clad_create_feature` MCP tool that `clad serve` exposes to host
// LLMs. A user never types a `clad spec new` command — they ask the
// host AI ("add a feature for login-flow"), the host LLM calls the
// MCP tool, the MCP tool calls this function.
//
// @see spec/features/spec-id-multi-dev-safety-67e33f.yaml AC-001 — this feature.

import {createHash} from 'node:crypto';
import {existsSync, readFileSync, readdirSync} from 'node:fs';
import {hostname, userInfo} from 'node:os';
import {join, relative} from 'node:path';

import yaml from 'yaml';

import {checkEarsShape} from './ears.js';
import {readSchema02AuthoringSnapshot} from './compiler/authoring-view.js';
import {newIdFromDigest, readableIdPattern} from './compiler/id-policy.js';
import {legacyStructuralReviewMatches} from './compiler/migration-baseline.js';
import {commitSchema01CompatibilityMutation, designArtifactDigest, editSpec, readSpecEditRevisions, type Schema01CompatibilityReplacement, type SpecEditOperation} from './edit.js';
import {requiredRootSchema} from './transaction.js';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * One acceptance criterion supplied at feature-creation time. `id` is
 * auto-assigned as an eight-hex hash (`AC-<hash8>`) for multi-dev merge safety — the
 * AC-tier analogue of the feature/scenario hash model; every other field is
 * optional but constrained to the schema's `acceptance_criterion` properties
 * (additionalProperties:false). Supplying these at creation is what stops a
 * `clad_create_feature` call from producing a hollow stub — the feature lands
 * with real, gate-checkable acceptance criteria, not an empty `[]`.
 */
export interface AcceptanceCriterionInput {
  /** Required schema 0.2 classification when this adapter targets a migrated workspace. */
  readonly kind?: 'behavior' | 'quality' | 'constraint';
  /** Required schema 0.2 strict statement when this adapter targets a migrated workspace. */
  readonly statement?: string;
  /** Why the criterion is needed (required for a schema 0.2 constraint unless resolving rule is supplied). */
  readonly rationale?: string;
  /** Explicit resolving rules for a schema 0.2 constraint. */
  readonly constraint_refs?: readonly string[];
  /** Declared proof-oracle references for schema 0.2. */
  readonly oracle_refs?: readonly string[];
  /** EARS pattern. */
  readonly ears?: 'ubiquitous' | 'event' | 'state' | 'optional' | 'unwanted' | 'complex';
  /** The "The system shall …" statement. */
  readonly text?: string;
  /** What the system does. */
  readonly action?: string;
  /** The observable response. */
  readonly response?: string;
  /** Trigger/precondition for event/state EARS. */
  readonly condition?: string;
  /** Paths to the tests that verify this AC (UNTESTED_AC gates these on done). */
  readonly test_refs?: readonly string[];
  /** Non-test evidence paths. */
  readonly evidence_refs?: readonly string[];
  /** Free-form note. */
  readonly notes?: string;
}

export interface CreateFeatureOptions {
  /**
   * Kebab-case slug. Becomes the human-readable filename prefix
   * (`<slug>-<hash8>.yaml`) and the
   * `slug` field inside the spec. Must match
   * `[a-z0-9][a-z0-9-]{0,62}[a-z0-9]` so it round-trips through git
   * paths on every supported platform.
   */
  readonly slug: string;
  /** Optional human-readable title. Defaults to the slug. */
  readonly title?: string;
  /** Required feature WHY statement for schema 0.2 workspaces. */
  readonly purpose?: string;
  /** Feature status at creation time. Defaults to `planned`. */
  readonly status?: 'planned' | 'in_progress' | 'done' | 'blocked' | 'archived';
  /** Module paths the feature binds to. Omitted → `modules: []`. */
  readonly modules?: readonly string[];
  /** Explicit schema 0.2 capability links; an empty list is a deliberate direct-to-project declaration. */
  readonly capability_refs?: readonly string[];
  /** Acceptance criteria authored at creation. Omitted → `acceptance_criteria: []`. */
  readonly acceptance_criteria?: readonly AcceptanceCriterionInput[];
  /** Optional durable Tier-B impact decision for hosts that support the richer authoring path. */
  readonly design_impact?: {
    readonly classification: 'none' | 'additive' | 'structural';
    readonly rationale: string;
    readonly artifacts?: readonly string[];
  };
  /** Project root. Defaults to `.`. */
  readonly cwd?: string;
}

export interface CreateFeatureResult {
  /** The newly-assigned feature id (e.g. `F-a3f9c2e1`). */
  readonly id: string;
  /** Absolute path to the newly-written yaml file. */
  readonly path: string;
  /** The slug as stored — same as the input, echoed for caller convenience. */
  readonly slug: string;
  /** Present when a requested status was downgraded (done is earned, not declared). */
  readonly note?: string;
}

/** Additive legacy records that a single schema-0.1 feature creation may attach. */
export interface Schema01FeatureCompositeAdditive {
  /** Capability to create or extend with the new feature. */
  readonly capability: string;
  /** Title used only if the legacy capability does not yet exist. */
  readonly capabilityTitle?: string;
  /** Summary used only if the legacy capability does not yet exist. */
  readonly capabilitySummary?: string;
  /** Existing legacy scenario selector to extend with the new feature. */
  readonly scenario?: string;
}

export interface ResolveDesignImpactResult {
  readonly feature: string;
  readonly changed: boolean;
  readonly path: string;
}

/** Adds a feature to an existing scenario without changing its authored prose. */
export function linkScenario(opts: {readonly scenario: string; readonly feature: string; readonly cwd?: string}): string {
  const cwd = opts.cwd ?? '.';
  if (requiredRootSchema(cwd) === '0.2') {
    const snapshot = readSchema02AuthoringSnapshot(cwd);
    const scenario = snapshot.scenarios.find((entry) => entry.id === opts.scenario || entry.slug === opts.scenario);
    if (!scenario) throw new Error(`cladding: unknown scenario '${opts.scenario}'`);
    const operation = {
      kind: 'scenario.upsert' as const,
      scenario: {
        id: scenario.id,
        slug: scenario.slug,
        title: scenario.title,
        actor: scenario.actor,
        goal: scenario.goal,
        success: scenario.success,
        steps: scenario.steps,
        featureRefs: [...new Set([...scenario.featureRefs, opts.feature])],
      },
    };
    const inputRevisions = readSpecEditRevisions(cwd, [operation]);
    if (inputRevisions[`scenario:${scenario.id}`] !== sourceRevision(scenario.sourceBytes)) {
      throw new Error('cladding: scenario changed while the link was being prepared; retry the link');
    }
    editSpec({cwd, operations: [operation], inputRevisions});
    return join(cwd, scenario.path);
  }

  const directory = join(cwd, 'spec', 'scenarios');
  if (!existsSync(directory)) throw new Error(`cladding: unknown scenario '${opts.scenario}'`);
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const path = join(directory, name);
    const body = readFileSync(path, 'utf8');
    const parsed = yaml.parse(body) as {id?: string; slug?: string; features?: string[]; title?: string; actor?: string; goal?: string; success?: string; steps?: string[]; feature_refs?: string[]};
    if (parsed?.id !== opts.scenario && parsed?.slug !== opts.scenario) continue;
    if (parsed.features?.includes(opts.feature)) return path;
    let next: string;
    if (/^features:\s*\[\]\s*$/m.test(body)) {
      next = body.replace(/^features:\s*\[\]\s*$/m, `features:\n  - ${opts.feature}`);
    } else if (/^features:\s*$/m.test(body)) {
      next = body.replace(/^(features:\s*\n(?:\s+-[^\n]*\n)*)/m, `$1  - ${opts.feature}\n`);
    } else {
      next = `${body.replace(/\n?$/, '\n')}features:\n  - ${opts.feature}\n`;
    }
    commitSchema01CompatibilityMutation(cwd, [{path: relative(cwd, path), before: body, after: next}]);
    return path;
  }
  throw new Error(`cladding: unknown scenario '${opts.scenario}'`);
}

/** Marks a reviewed structural design impact resolved without rewriting the shard. */
export function resolveDesignImpact(opts: {readonly feature: string; readonly cwd?: string}): ResolveDesignImpactResult {
  const cwd = opts.cwd ?? '.';
  if (requiredRootSchema(cwd) === '0.2') {
    const snapshot = readSchema02AuthoringSnapshot(cwd);
    const feature = snapshot.features.find((entry) => entry.id === opts.feature);
    if (!feature) throw new Error(`cladding: unknown feature '${opts.feature}'`);
    const impact = feature.designImpact;
    if (!impact || impact.classification !== 'structural') {
      throw new Error('cladding: only a structural design impact requires explicit resolution');
    }
    if (impact.status === 'resolved') return {feature: opts.feature, changed: false, path: join(cwd, feature.path)};
    if (typeof impact.rationale !== 'string' || !isStringArray(impact.artifacts)) {
      throw new Error('cladding: structural design impact is incomplete and cannot be resolved');
    }
    const inheritedStructuralReview = impact.baseline_digests === undefined
      && legacyStructuralReviewMatches(snapshot.compilation.migrationBaseline, opts.feature, impact);
    const baselineDigests = designImpactBaselines(impact.artifacts, impact.baseline_digests);
    if (baselineDigests === undefined && !inheritedStructuralReview) {
      throw new Error('cladding: schema 0.2 structural design impact requires complete baseline digests or an exact immutable migration baseline review');
    }
    const currentDigests = new Map(impact.artifacts.map((path) => [path, designArtifactDigest(cwd, path)]));
    const unchanged = baselineDigests === undefined
      ? []
      : impact.artifacts.filter((path) => currentDigests.get(path) === baselineDigests.get(path));
    if (unchanged.length > 0) {
      throw new Error(`cladding: design impact is not resolved — unchanged artifact(s): ${unchanged.join(', ')}`);
    }
    const operation = {
      kind: 'feature.set_design_impact' as const,
      featureId: opts.feature,
      designImpact: {
        classification: 'structural' as const,
        rationale: impact.rationale,
        artifacts: impact.artifacts,
        status: 'resolved' as const,
      },
    };
    const inputRevisions = readSpecEditRevisions(cwd, [operation]);
    if (inputRevisions[`feature:${opts.feature}`] !== sourceRevision(feature.sourceBytes)) {
      throw new Error('cladding: feature changed while design-impact resolution was being prepared; retry the resolution');
    }
    const result = editSpec({cwd, operations: [operation], inputRevisions});
    return {feature: opts.feature, changed: result.changed, path: join(cwd, feature.path)};
  }

  const directory = join(cwd, 'spec', 'features');
  if (!existsSync(directory)) throw new Error(`cladding: unknown feature '${opts.feature}'`);
  for (const name of readdirSync(directory)) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    const path = join(directory, name);
    const body = readFileSync(path, 'utf8');
    const parsed = yaml.parse(body) as {id?: string; design_impact?: {
      classification?: string;
      rationale?: string;
      status?: string;
      artifacts?: string[];
      baseline_digests?: Record<string, string>;
    }};
    if (parsed?.id !== opts.feature) continue;
    if (parsed.design_impact?.classification !== 'structural') {
      throw new Error('cladding: only a structural design impact requires explicit resolution');
    }
    if (parsed.design_impact.status === 'resolved') return {feature: opts.feature, changed: false, path};
    if (parsed.design_impact.status !== 'review_required'
      || typeof parsed.design_impact.rationale !== 'string'
      || !isStringArray(parsed.design_impact.artifacts)) {
      throw new Error('cladding: structural design impact is incomplete and cannot be resolved');
    }
    const baselineDigests = designImpactBaselines(parsed.design_impact.artifacts, parsed.design_impact.baseline_digests);
    const currentDigests = new Map(parsed.design_impact.artifacts.map((artifact) => [artifact, designArtifactDigest(cwd, artifact)]));
    const unchanged = baselineDigests === undefined
      ? []
      : parsed.design_impact.artifacts.filter((artifact) => currentDigests.get(artifact) === baselineDigests.get(artifact));
    if (unchanged.length > 0) {
      throw new Error(`cladding: design impact is not resolved — unchanged artifact(s): ${unchanged.join(', ')}`);
    }
    const next = body.replace(
      /(design_impact:\n(?:(?:  .*\n)*?)  status:\s*)review_required\b/,
      '$1resolved',
    );
    if (next === body) throw new Error('cladding: malformed structural design_impact block');
    commitSchema01CompatibilityMutation(
      cwd,
      [{path: relative(cwd, path), before: body, after: next}],
      [{type: 'design_impact_resolved', payload: {feature: opts.feature}}],
    );
    return {feature: opts.feature, changed: true, path};
  }
  throw new Error(`cladding: unknown feature '${opts.feature}'`);
}

/**
 * Creates a new sharded feature file at `spec/features/<slug>-<hash8>.yaml`
 * where `<hash8>` is the eight-character hexadecimal tail of the auto-generated id.
 *
 * Why the hash goes into the filename, not just the id: two
 * developers on separate branches calling `createFeature` with the
 * same slug must produce different file paths so a `git merge` does
 * not collide on a single filename. The hash is the entropy
 * that guarantees this — its input bundles slug + user + hostname +
 * ms timestamp + hrtime, so simultaneous invocations produce
 * different hashes by construction.
 *
 * The slug remains the human-readable anchor: `ls spec/features/auth*`
 * still groups all auth-related features because `<slug>-` is the
 * filename prefix.
 *
 * @param opts - {@link CreateFeatureOptions}.
 * @returns The newly-assigned id, the file path, and the slug.
 * @throws Error when `slug` is invalid or — extremely rarely — when
 *         the hash collides with an existing feature in this cwd
 *         (1/4.3B per-pair probability; the caller may retry).
 */
export function createFeature(opts: CreateFeatureOptions): CreateFeatureResult {
  assertFeatureCreateShape(opts);
  const slug = opts.slug;

  const cwd = opts.cwd ?? '.';
  if (requiredRootSchema(cwd) === '0.2') {
    if (!opts.purpose?.trim()) throw new Error('cladding: schema 0.2 feature creation requires a non-empty purpose');
    if (opts.capability_refs === undefined) throw new Error('cladding: schema 0.2 feature creation requires an explicit capability_refs list (use [] for direct project contribution)');
    if (opts.status !== undefined && opts.status !== 'planned') throw new Error('cladding: schema 0.2 feature creation starts planned; use a typed lifecycle operation afterwards');
    for (const [index, criterion] of (opts.acceptance_criteria ?? []).entries()) {
      if (!criterion.kind) throw new Error(`cladding: schema 0.2 criterion ${index + 1} requires an explicit kind`);
      if (!criterion.statement?.trim()) throw new Error(`cladding: schema 0.2 criterion ${index + 1} requires a strict statement`);
      if (criterion.text !== undefined || criterion.ears !== undefined || criterion.condition !== undefined || criterion.action !== undefined || criterion.response !== undefined || criterion.test_refs !== undefined) {
        throw new Error(`cladding: schema 0.2 criterion ${index + 1} does not accept legacy EARS or test-reference fields`);
      }
    }
    const id = generateFeatureId(slug);
    const operation: SpecEditOperation = {
      kind: 'feature.create' as const,
      id,
      slug,
      title: opts.title ?? slug,
      purpose: opts.purpose ?? '',
      modules: opts.modules,
      capabilityRefs: opts.capability_refs,
      criteria: (opts.acceptance_criteria ?? []).map((criterion, index) => ({
        id: newIdFromDigest('criterion', createHash('sha256').update(`${id}|${index}|${criterion.statement}|${process.hrtime.bigint()}`).digest('hex')),
        kind: criterion.kind!,
        statement: criterion.statement!,
        ...(criterion.rationale ? {rationale: criterion.rationale} : {}),
        ...(criterion.constraint_refs ? {constraintRefs: criterion.constraint_refs} : {}),
        ...(criterion.oracle_refs ? {oracleRefs: criterion.oracle_refs} : {}),
        ...(criterion.evidence_refs ? {evidenceRefs: criterion.evidence_refs} : {}),
        ...(criterion.notes ? {notes: criterion.notes} : {}),
      })),
    };
    const operations: SpecEditOperation[] = [operation, ...(opts.design_impact ? [{
      kind: 'feature.set_design_impact' as const,
      featureId: id,
      designImpact: {
        classification: opts.design_impact.classification,
        rationale: opts.design_impact.rationale,
        ...(opts.design_impact.classification === 'structural' ? {artifacts: opts.design_impact.artifacts ?? []} : {}),
      },
    }] : [])];
    const result = editSpec({cwd, operations, inputRevisions: readSpecEditRevisions(cwd, operations)});
    return {
      id,
      path: join(cwd, 'spec', 'features', `${slug}-${id.slice(2)}.yaml`),
      slug,
      ...(result.changed ? {} : {note: 'Feature already matched the requested specification.'}),
    };
  }
  const prepared = prepareSchema01FeatureCreate(opts);
  commitSchema01CompatibilityMutation(
    cwd,
    [prepared.replacement],
    [{type: 'feature_created', payload: {feature: prepared.result.id, slug: prepared.result.slug}}],
    {refreshDerived: true},
  );
  return prepared.result;
}

/**
 * Creates a legacy feature plus its optional additive design links in one byte-bound journal.
 *
 * This is intentionally a schema-0.1 compatibility adapter, not a second writer: every
 * source byte is included as a before-image and inventory/index/event projections join the
 * same transaction.  It prevents the old create → link → sync rollback from deleting a
 * concurrent writer's successor state.
 */
export function createSchema01FeatureComposite(
  opts: CreateFeatureOptions & {readonly additive?: Schema01FeatureCompositeAdditive},
): CreateFeatureResult {
  const cwd = opts.cwd ?? '.';
  assertFeatureCreateShape(opts);
  if (requiredRootSchema(cwd) === '0.2') {
    throw new Error('cladding: the workspace migrated to schema 0.2; use the typed feature edit boundary');
  }
  const prepared = prepareSchema01FeatureCreate(opts);
  const replacements: Schema01CompatibilityReplacement[] = [prepared.replacement];
  if (opts.additive) {
    replacements.push(prepareSchema01CapabilityLink(cwd, opts.additive, prepared.result.id));
    if (opts.additive.scenario) replacements.push(prepareSchema01ScenarioLink(cwd, opts.additive.scenario, prepared.result.id));
  }
  commitSchema01CompatibilityMutation(
    cwd,
    replacements,
    [{type: 'feature_created', payload: {feature: prepared.result.id, slug: prepared.result.slug}}],
    {refreshDerived: true},
  );
  return prepared.result;
}

/** Validates the common, schema-independent create request before any planned file is built. */
function assertFeatureCreateShape(opts: CreateFeatureOptions): void {
  if (!SLUG_PATTERN.test(opts.slug)) throw new Error(`cladding: slug '${opts.slug}' is invalid — must match ${SLUG_PATTERN.source}`);
  const earsIssues: string[] = [];
  (opts.acceptance_criteria ?? []).forEach((criterion, index) => {
    const message = checkEarsShape(criterion.ears, criterion.condition);
    if (message) earsIssues.push(`acceptance_criteria[${index}] (ears=${criterion.ears ?? 'unspecified'}): ${message}`);
  });
  if (earsIssues.length > 0) {
    throw new Error(`cladding: feature '${opts.slug}' has EARS-shape issue(s) — fix the AC(s) and retry create:\n  - ${earsIssues.join('\n  - ')}`);
  }
}

function prepareSchema01FeatureCreate(opts: CreateFeatureOptions): {
  readonly replacement: {readonly path: string; readonly before: null; readonly after: string};
  readonly result: CreateFeatureResult;
} {
  const cwd = opts.cwd ?? '.';
  const slug = opts.slug;
  const featuresDir = join(cwd, 'spec', 'features');
  const id = generateFeatureId(slug);
  const hash = id.slice(2);
  const filePath = join(featuresDir, `${slug}-${hash}.yaml`);
  if (existsSync(filePath)) throw new Error(`cladding: ${slug}-${hash}.yaml already exists (hash collision) — retry`);
  const requestedDone = opts.status === 'done';
  const structuralArtifacts = opts.design_impact?.classification === 'structural'
    ? opts.design_impact.artifacts ?? []
    : undefined;
  if (structuralArtifacts && new Set(structuralArtifacts).size !== structuralArtifacts.length) {
    throw new Error('cladding: structural design impact artifacts must be an exact unique set');
  }
  const designImpact = opts.design_impact?.classification === 'structural'
    ? {
        ...opts.design_impact,
        artifacts: structuralArtifacts,
        baseline_digests: Object.fromEntries(structuralArtifacts!
          .map((artifactPath) => [artifactPath, designArtifactDigest(cwd, artifactPath)])),
      }
    : opts.design_impact;
  const after = renderYaml({
    id, slug, title: opts.title ?? slug, status: requestedDone ? 'in_progress' : (opts.status ?? 'planned'),
    modules: opts.modules, acceptance_criteria: opts.acceptance_criteria, design_impact: designImpact,
  });
  return {
    replacement: {path: relative(cwd, filePath), before: null, after},
    result: {
      id, path: filePath, slug,
      ...(requestedDone ? {note: `status 'done' is earned, not declared — created as in_progress; run \`clad done ${id}\` once the strict gate is GREEN.`} : {}),
    },
  };
}

function prepareSchema01CapabilityLink(
  cwd: string,
  additive: Schema01FeatureCompositeAdditive,
  feature: string,
): {readonly path: string; readonly before: string | null; readonly after: string} {
  if (!SLUG_PATTERN.test(additive.capability)) throw new Error(`cladding: capability id '${additive.capability}' is invalid — must match ${SLUG_PATTERN.source}`);
  const path = join(cwd, 'spec', 'capabilities.yaml');
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const parsed = before === null ? null : yaml.parse(before) as {capabilities?: unknown} | null;
  const capabilities = Array.isArray(parsed?.capabilities)
    ? parsed.capabilities.filter((entry): entry is CapabilityRecord => typeof entry === 'object' && entry !== null).map((entry) => ({...entry, features: [...(entry.features ?? [])]}))
    : [];
  const existing = capabilities.find((entry) => entry.id === additive.capability);
  if (existing) {
    if (!existing.features?.includes(feature)) existing.features = [...(existing.features ?? []), feature];
  } else {
    capabilities.push({id: additive.capability, ...(additive.capabilityTitle ? {title: additive.capabilityTitle} : {}), ...(additive.capabilitySummary ? {summary: additive.capabilitySummary} : {}), features: [feature]});
  }
  const prefix = before === null ? DEFAULT_CAPABILITIES_HEADER : (() => {
    const offset = before.search(/^capabilities:/m);
    return offset >= 0 ? before.slice(0, offset) : (before.endsWith('\n') ? before : `${before}\n`);
  })();
  return {path: relative(cwd, path), before, after: `${prefix}${renderCapabilitiesBlock(capabilities)}`};
}

function prepareSchema01ScenarioLink(
  cwd: string,
  selector: string,
  feature: string,
): {readonly path: string; readonly before: string; readonly after: string} {
  const directory = join(cwd, 'spec', 'scenarios');
  if (!existsSync(directory)) throw new Error(`cladding: unknown scenario '${selector}'`);
  for (const name of readdirSync(directory)) {
    if (!/\.ya?ml$/.test(name)) continue;
    const absolute = join(directory, name);
    const before = readFileSync(absolute, 'utf8');
    const scenario = yaml.parse(before) as {id?: string; slug?: string; features?: unknown};
    if (scenario?.id !== selector && scenario?.slug !== selector) continue;
    if (Array.isArray(scenario.features) && scenario.features.includes(feature)) return {path: relative(cwd, absolute), before, after: before};
    const after = /^features:\s*\[\]\s*$/m.test(before)
      ? before.replace(/^features:\s*\[\]\s*$/m, `features:\n  - ${feature}`)
      : /^features:\s*$/m.test(before)
        ? before.replace(/^(features:\s*\n(?:\s+-[^\n]*\n)*)/m, `$1  - ${feature}\n`)
        : `${before.replace(/\n?$/, '\n')}features:\n  - ${feature}\n`;
    return {path: relative(cwd, absolute), before, after};
  }
  throw new Error(`cladding: unknown scenario '${selector}'`);
}

/**
 * Renders the feature yaml. Hand-written rather than going through the yaml
 * package because the layout is fixed and a tiny deterministic emitter avoids
 * the indentation / key-order ambiguity a general yaml dumper would introduce.
 *
 * Omitted `modules` / `acceptance_criteria` render as the empty `[]` stub
 * (backward-compatible). When supplied, the feature lands with real, schema-
 * valid content so a create call is not forced to produce a hollow stub.
 * String scalars go through JSON.stringify — a JSON string is a valid YAML
 * double-quoted scalar, so arbitrary text/EARS prose can't break the YAML.
 */
function renderYaml(args: {
  id: string;
  slug: string;
  title: string;
  status: string;
  modules?: readonly string[];
  acceptance_criteria?: readonly AcceptanceCriterionInput[];
  design_impact?: CreateFeatureOptions['design_impact'] & {
    readonly baseline_digests?: Readonly<Record<string, string>>;
  };
}): string {
  const lines = [
    `id: ${args.id}`,
    `slug: ${args.slug}`,
    `title: ${JSON.stringify(args.title)}`,
    `status: ${args.status}`,
  ];

  const modules = args.modules ?? [];
  if (modules.length === 0) {
    lines.push('modules: []');
  } else {
    lines.push('modules:');
    for (const m of modules) lines.push(`  - ${m}`);
  }

  const acs = args.acceptance_criteria ?? [];
  if (acs.length === 0) {
    lines.push('acceptance_criteria: []');
  } else {
    lines.push('acceptance_criteria:');
    acs.forEach((ac, i) => {
      lines.push(`  - id: ${generateAcId(args.slug, i, ac)}`);
      if (ac.ears) lines.push(`    ears: ${ac.ears}`);
      if (ac.condition) lines.push(`    condition: ${JSON.stringify(ac.condition)}`);
      if (ac.action) lines.push(`    action: ${JSON.stringify(ac.action)}`);
      if (ac.response) lines.push(`    response: ${JSON.stringify(ac.response)}`);
      if (ac.text) lines.push(`    text: ${JSON.stringify(ac.text)}`);
      if (ac.test_refs && ac.test_refs.length > 0) {
        lines.push(`    test_refs: [${ac.test_refs.map((r) => JSON.stringify(r)).join(', ')}]`);
      }
      if (ac.evidence_refs && ac.evidence_refs.length > 0) {
        lines.push(`    evidence_refs: [${ac.evidence_refs.map((r) => JSON.stringify(r)).join(', ')}]`);
      }
      if (ac.notes) lines.push(`    notes: ${JSON.stringify(ac.notes)}`);
    });
  }

  if (args.design_impact) {
    lines.push('design_impact:');
    lines.push(`  classification: ${args.design_impact.classification}`);
    lines.push(`  rationale: ${JSON.stringify(args.design_impact.rationale)}`);
    lines.push(`  status: ${args.design_impact.classification === 'structural' ? 'review_required' : 'resolved'}`);
    const artifacts = args.design_impact.artifacts ?? [];
    if (artifacts.length === 0) lines.push('  artifacts: []');
    else lines.push(`  artifacts: [${artifacts.map((path) => JSON.stringify(path)).join(', ')}]`);
    if (args.design_impact.baseline_digests && Object.keys(args.design_impact.baseline_digests).length > 0) {
      lines.push('  baseline_digests:');
      for (const [path, digest] of Object.entries(args.design_impact.baseline_digests)) {
        lines.push(`    ${JSON.stringify(path)}: ${JSON.stringify(digest)}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Generates an eight-character hexadecimal hash id. Inputs that distinguish two
 * concurrent invocations: slug, OS user, hostname, ms timestamp,
 * high-resolution nanosecond counter. Same hash twice = 1/4.3B
 * coincidence; collision detection in the caller handles that.
 */
/** Generates a collision-resistant schema-0.2 feature identifier without writing a shard. */
export function generateFeatureId(slug: string): string {
  const input = [
    slug,
    safeUserInfo(),
    hostname(),
    String(Date.now()),
    process.hrtime.bigint().toString(),
  ].join('|');
  return newIdFromDigest('feature', createHash('sha256').update(input).digest('hex'));
}

/**
 * Hash-model acceptance-criterion id, the AC-tier analogue of the feature/scenario
 * hash. Sequential `AC-001`/`AC-002` collide when two developers add an AC to the
 * same shard on separate branches (both pick the next ordinal); a per-AC hash —
 * seeded with the slug, the AC index, its prose, and the same machine/clock
 * entropy as `generateFeatureId` — makes independent additions merge-safe. The
 * schema accepts both `AC-<six-or-more-hex>` and the legacy `AC-NNN` (dual pattern).
 */
function generateAcId(slug: string, index: number, ac: AcceptanceCriterionInput): string {
  const input = [
    slug,
    'AC',
    String(index),
    ac.text ?? ac.action ?? ac.response ?? '',
    safeUserInfo(),
    hostname(),
    String(Date.now()),
    process.hrtime.bigint().toString(),
  ].join('|');
  return newIdFromDigest('criterion', createHash('sha256').update(input).digest('hex'));
}

function safeUserInfo(): string {
  try {
    return userInfo().username ?? 'anonymous';
  } catch {
    return 'anonymous';
  }
}

// === Scenario creation (v0.3.12, F-087) ===
//
// Mirror of createFeature for scenarios. Scenarios sit at the same
// concurrency-collision risk as features — sequential `S-NNN` ids +
// manual filename means two contributors on separate branches racing
// to add `S-003.yaml`. Same hash-id model applies; the only
// scenario-specific bit is the `S-` prefix and the schema layout.

export interface CreateScenarioOptions {
  /** Kebab-case slug; same constraints as feature slugs. */
  readonly slug: string;
  /** Optional title. Defaults to the slug. */
  readonly title?: string;
  /** Optional prose flow (the user-journey narrative). Omitted → no `flow` line. */
  readonly flow?: string;
  /** Required actor for schema 0.2 scenario creation. */
  readonly actor?: string;
  /** Required goal for schema 0.2 scenario creation. */
  readonly goal?: string;
  /** Required observable success state for schema 0.2 scenario creation. */
  readonly success?: string;
  /** Required ordered steps for schema 0.2 scenario creation. */
  readonly steps?: readonly string[];
  /** Optional list of feature ids the scenario touches. */
  readonly features?: readonly string[];
  /** Project root. Defaults to `.`. */
  readonly cwd?: string;
}

export interface CreateScenarioResult {
  /** The newly-assigned scenario id (e.g. `S-a3f9c2e1`). */
  readonly id: string;
  /** Absolute path to the newly-written yaml file. */
  readonly path: string;
  /** The slug as stored. */
  readonly slug: string;
}

/**
 * Creates a new sharded scenario file at
 * `spec/scenarios/<slug>-<hash8>.yaml` with `id: S-<hash8>`.
 * Same multi-developer safety property as createFeature — two
 * simultaneous calls with the same slug across branches produce
 * different hashes and therefore different file paths.
 *
 * @throws Error when `slug` is invalid or — extremely rarely — when
 *         the hash collides with an existing scenario in this cwd.
 */
export function createScenario(opts: CreateScenarioOptions): CreateScenarioResult {
  const slug = opts.slug;
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `cladding: slug '${slug}' is invalid — must match ${SLUG_PATTERN.source}`,
    );
  }
  const cwd = opts.cwd ?? '.';
  if (requiredRootSchema(cwd) === '0.2') {
    if (!opts.actor?.trim() || !opts.goal?.trim() || !opts.success?.trim() || !opts.steps?.length || !opts.features?.length) {
      throw new Error('cladding: schema 0.2 scenario creation requires actor, goal, success, steps, and at least one feature');
    }
    const id = generateScenarioId(slug);
    const operation = {
      kind: 'scenario.upsert' as const,
      scenario: {id, slug, title: opts.title ?? slug, actor: opts.actor, goal: opts.goal, success: opts.success, steps: opts.steps, featureRefs: opts.features ?? []},
    };
    editSpec({cwd, operations: [operation], inputRevisions: readSpecEditRevisions(cwd, [operation])});
    return {id, path: join(cwd, 'spec', 'scenarios', `${slug}-${id.slice(2)}.yaml`), slug};
  }
  const scenariosDir = join(cwd, 'spec', 'scenarios');
  const id = generateScenarioId(slug);
  const hash = id.slice(2);
  const filePath = join(scenariosDir, `${slug}-${hash}.yaml`);
  if (existsSync(filePath)) {
    throw new Error(
      `cladding: ${slug}-${hash}.yaml already exists (hash collision) — retry`,
    );
  }

  const title = opts.title ?? slug;
  const yaml = renderScenarioYaml({id, slug, title, flow: opts.flow, features: opts.features ?? []});
  commitSchema01CompatibilityMutation(
    cwd,
    [{path: relative(cwd, filePath), before: null, after: yaml}],
    [{type: 'scenario_created', payload: {scenario: id, slug}}],
    {refreshDerived: true},
  );

  return {id, path: filePath, slug};
}

function renderScenarioYaml(args: {
  id: string;
  slug: string;
  title: string;
  flow?: string;
  features: readonly string[];
}): string {
  const lines = [
    `id: ${args.id}`,
    `slug: ${args.slug}`,
    `title: ${JSON.stringify(args.title)}`,
  ];
  if (args.flow) lines.push(`flow: ${JSON.stringify(args.flow)}`);
  if (args.features.length === 0) {
    lines.push('features: []');
  } else {
    lines.push('features:');
    for (const f of args.features) lines.push(`  - ${f}`);
  }
  lines.push('');
  return lines.join('\n');
}

function generateScenarioId(slug: string): string {
  const input = [
    'scenario', // namespace separator so a feature and scenario with the
    // same slug + timestamp don't share the same hash input
    slug,
    safeUserInfo(),
    hostname(),
    String(Date.now()),
    process.hrtime.bigint().toString(),
  ].join('|');
  return newIdFromDigest('scenario', createHash('sha256').update(input).digest('hex'));
}

// === Capability linking (v0.4.x) ===
//
// A capability is ACCUMULATIVE — created once, then features are added over time
// as they land. So the authoring verb is NOT `create` (which mints a new distinct
// entity, like a feature or scenario) but `link`: "ensure capability X exists and
// includes feature F" (an upsert). This is the deterministic development-time
// firing path for the Tier-B design SSoT — features grow the capability map as
// they're built, instead of capabilities being written once at onboarding and
// then orphaned (the gap HOLLOW_GOVERNANCE flags).
//
// It UPDATES the single `spec/capabilities.yaml` (unlike create_feature/scenario,
// which write new shard files): everything before the top-level `capabilities:`
// key is preserved verbatim (header comments + schema/source), and only the
// capabilities block is re-emitted deterministically — so the output stays
// schema-valid (J2) and human-authored header prose survives.

const FEATURE_ID_PATTERN = readableIdPattern('feature');
type CapabilitySurfaceValue = 'feature' | 'platform' | 'tool' | 'infrastructure';

interface CapabilityRecord {
  id: string;
  title?: string;
  outcome?: string;
  summary?: string;
  surface?: CapabilitySurfaceValue;
  features?: string[];
}

export interface LinkCapabilityOptions {
  /** Capability id (kebab-slug). Created if it does not exist yet. */
  readonly capability: string;
  /** Feature id (F-…) to add to the capability's `features[]`. */
  readonly feature: string;
  /** Title used only when the capability is newly created. */
  readonly title?: string;
  /** Summary used only when newly created. */
  readonly summary?: string;
  /** Surface used only when newly created. */
  readonly surface?: CapabilitySurfaceValue;
  /** Project root. Defaults to `.`. */
  readonly cwd?: string;
}

export interface LinkCapabilityResult {
  readonly capability: string;
  readonly feature: string;
  /** True when the capability did not exist and was created by this call. */
  readonly created: boolean;
  /** True when the feature was already in the capability's `features[]`. */
  readonly alreadyLinked: boolean;
  readonly path: string;
}

const DEFAULT_CAPABILITIES_HEADER =
  '# Cladding · Tier B · SSoT — Design (editable) · Refreshed by: clad_link_capability / clad clarify\n' +
  '#\n' +
  '# `features[]` lists the F-* ids that implement the capability. The\n' +
  '# CAPABILITIES_FEATURE_MAPPING detector validates that every id resolves\n' +
  '# to a real feature shard, and warns on orphan capabilities.\n' +
  'schema: "0.1"\n' +
  'source: spec.yaml\n';

/**
 * Upserts a feature↔capability link into `spec/capabilities.yaml`. If the
 * capability id is unknown it is created (with the optional title/summary/surface);
 * otherwise the feature is appended to its `features[]` (deduped). The file's
 * header + `schema`/`source` are preserved; only the `capabilities:` block is
 * re-rendered. Idempotent: linking an already-linked feature is a no-op write.
 *
 * @throws Error when `capability` is not a kebab-slug or `feature` is not an F-id.
 */
export function linkCapability(opts: LinkCapabilityOptions): LinkCapabilityResult {
  const cwd = opts.cwd ?? '.';
  const capId = opts.capability;
  const feature = opts.feature;
  if (!SLUG_PATTERN.test(capId)) {
    throw new Error(`cladding: capability id '${capId}' is invalid — must match ${SLUG_PATTERN.source}`);
  }
  if (!FEATURE_ID_PATTERN.test(feature)) {
    throw new Error(`cladding: feature id '${feature}' is invalid — must match ${FEATURE_ID_PATTERN.source}`);
  }

  if (requiredRootSchema(cwd) === '0.2') {
    const snapshot = readSchema02AuthoringSnapshot(cwd);
    const existingFeature = snapshot.features.find((entry) => entry.id === feature);
    if (!existingFeature) throw new Error(`cladding: unknown feature '${feature}'`);
    const existingRefs = existingFeature.capabilityRefs;
    const existing = snapshot.capabilities.find((entry) => entry.id === capId);
    if (!existing && (!opts.title?.trim() || !opts.summary?.trim())) {
      throw new Error('cladding: schema 0.2 capability creation requires a non-empty outcome');
    }
    if (existing && ((opts.title !== undefined && opts.title !== existing.title) || (opts.summary !== undefined && opts.summary !== existing.outcome))) {
      throw new Error(`cladding: existing schema 0.2 capability '${capId}' must not be redefined while linking it`);
    }
    const operations: SpecEditOperation[] = [
      {kind: 'capability.upsert' as const, capability: {id: capId, title: existing?.title ?? opts.title!, outcome: existing?.outcome ?? opts.summary!}},
      {kind: 'feature.set_links' as const, featureId: feature, capabilityRefs: [...new Set([...existingRefs, capId])]},
    ];
    const inputRevisions = readSpecEditRevisions(cwd, operations);
    if (inputRevisions.capabilities !== sourceRevision(snapshot.capabilityCatalog.sourceBytes)
      || inputRevisions[`feature:${feature}`] !== sourceRevision(existingFeature.sourceBytes)) {
      throw new Error('cladding: capability or feature changed while the link was being prepared; retry the link');
    }
    editSpec({cwd, operations, inputRevisions});
    return {capability: capId, feature, created: !existing, alreadyLinked: existingRefs.includes(capId), path: join(cwd, snapshot.capabilityCatalog.path)};
  }

  const path = join(cwd, 'spec', 'capabilities.yaml');
  let capabilities: CapabilityRecord[] = [];
  let prefix = DEFAULT_CAPABILITIES_HEADER;
  let sourceBytes: string | null = null;

  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    sourceBytes = raw;
    const parsed = yaml.parse(raw) as {capabilities?: unknown} | null;
    if (parsed && Array.isArray(parsed.capabilities)) {
      capabilities = parsed.capabilities.filter(
        (c): c is CapabilityRecord => typeof c === 'object' && c !== null,
      ) as CapabilityRecord[];
    }
    // Preserve everything before the top-level `capabilities:` key; re-emit the rest.
    const match = raw.search(/^capabilities:/m);
    prefix = match >= 0 ? raw.slice(0, match) : raw.endsWith('\n') ? raw : `${raw}\n`;
  }

  let created = false;
  let alreadyLinked = false;
  const existing = capabilities.find((c) => c.id === capId);
  if (!existing) {
    capabilities.push({
      id: capId,
      ...(opts.title ? {title: opts.title} : {}),
      ...(opts.summary ? {summary: opts.summary} : {}),
      ...(opts.surface ? {surface: opts.surface} : {}),
      features: [feature],
    });
    created = true;
  } else {
    const feats = Array.isArray(existing.features) ? existing.features : [];
    if (feats.includes(feature)) {
      alreadyLinked = true;
    } else {
      existing.features = [...feats, feature];
    }
  }

  commitSchema01CompatibilityMutation(
    cwd,
    [{path: relative(cwd, path), before: sourceBytes, after: prefix + renderCapabilitiesBlock(capabilities)}],
    [],
    {refreshDerived: true},
  );
  return {capability: capId, feature, created, alreadyLinked, path};
}

function sourceRevision(sourceBytes: string): string {
  return createHash('sha256').update(sourceBytes).digest('hex');
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Validates the immutable artifact set a structural review is allowed to resolve. */
function designImpactBaselines(
  artifacts: readonly string[],
  raw: unknown,
): ReadonlyMap<string, string> | undefined {
  if (new Set(artifacts).size !== artifacts.length) {
    throw new Error('cladding: structural design impact artifacts must be an exact unique set');
  }
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('cladding: structural design impact baseline digests are invalid');
  }
  const entries = Object.entries(raw);
  if (entries.length !== artifacts.length
    || entries.some(([path, digest]) => !artifacts.includes(path) || typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest))) {
    throw new Error('cladding: structural design impact baseline digests must exactly match its design artifacts');
  }
  return new Map(entries as [string, string][]);
}

/** Deterministically emits the `capabilities:` block (schema-valid order). */
function renderCapabilitiesBlock(capabilities: readonly CapabilityRecord[]): string {
  if (capabilities.length === 0) return 'capabilities: []\n';
  const lines = ['capabilities:'];
  for (const cap of capabilities) {
    lines.push(`  - id: ${cap.id}`);
    if (cap.title) lines.push(`    title: ${JSON.stringify(cap.title)}`);
    if (cap.summary) lines.push(`    summary: ${JSON.stringify(cap.summary)}`);
    if (cap.surface) lines.push(`    surface: ${cap.surface}`);
    const feats = cap.features ?? [];
    if (feats.length === 0) {
      lines.push('    features: []');
    } else {
      lines.push(`    features: [${feats.join(', ')}]`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
