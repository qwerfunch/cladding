// Cladding · spec · createFeature — internal feature creator (F-084).
//
// Issues a new sharded feature file at `spec/features/<slug>.yaml`
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
// @see spec/features/F-084.yaml — this feature.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';

import {recordEvent} from '../events/log.js';
import {hostname, userInfo} from 'node:os';
import {join} from 'node:path';

import yaml from 'yaml';

import {checkEarsShape} from './ears.js';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * One acceptance criterion supplied at feature-creation time. `id` is
 * auto-assigned as a hash (`AC-<hash6>`) for multi-dev merge safety — the
 * AC-tier analogue of the feature/scenario hash model; every other field is
 * optional but constrained to the schema's `acceptance_criterion` properties
 * (additionalProperties:false). Supplying these at creation is what stops a
 * `clad_create_feature` call from producing a hollow stub — the feature lands
 * with real, gate-checkable acceptance criteria, not an empty `[]`.
 */
export interface AcceptanceCriterionInput {
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
   * Kebab-case slug. Becomes the filename (`<slug>.yaml`) and the
   * `slug` field inside the spec. Must match
   * `[a-z0-9][a-z0-9-]{0,62}[a-z0-9]` so it round-trips through git
   * paths on every supported platform.
   */
  readonly slug: string;
  /** Optional human-readable title. Defaults to the slug. */
  readonly title?: string;
  /** Feature status at creation time. Defaults to `planned`. */
  readonly status?: 'planned' | 'in_progress' | 'done' | 'blocked' | 'archived';
  /** Module paths the feature binds to. Omitted → `modules: []`. */
  readonly modules?: readonly string[];
  /** Acceptance criteria authored at creation. Omitted → `acceptance_criteria: []`. */
  readonly acceptance_criteria?: readonly AcceptanceCriterionInput[];
  /** Project root. Defaults to `.`. */
  readonly cwd?: string;
}

export interface CreateFeatureResult {
  /** The newly-assigned feature id (e.g. `F-a3f9c2`). */
  readonly id: string;
  /** Absolute path to the newly-written yaml file. */
  readonly path: string;
  /** The slug as stored — same as the input, echoed for caller convenience. */
  readonly slug: string;
  /** Present when a requested status was downgraded (done is earned, not declared). */
  readonly note?: string;
}

/**
 * Creates a new sharded feature file at `spec/features/<slug>-<hash>.yaml`
 * where `<hash>` is the 6-char hex tail of the auto-generated id.
 *
 * Why the hash goes into the filename, not just the id: two
 * developers on separate branches calling `createFeature` with the
 * same slug must produce different file paths so a `git merge` does
 * not collide on a single `<slug>.yaml`. The hash is the entropy
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
  const slug = opts.slug;
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `cladding: slug '${slug}' is invalid — must match ${SLUG_PATTERN.source}`,
    );
  }
  // Shift-left EARS validation: reject a malformed AC shape AT CREATION with a
  // precise fix, instead of letting the agent discover it turns later via the
  // AC_DRIFT gate (create→sync→error→fix→sync). Same rule as the gate
  // (spec/ears.ts checkAc), applied here on the proposed inputs.
  const earsIssues: string[] = [];
  (opts.acceptance_criteria ?? []).forEach((ac, i) => {
    const message = checkEarsShape(ac.ears, ac.condition);
    if (message) earsIssues.push(`acceptance_criteria[${i}] (ears=${ac.ears ?? 'unspecified'}): ${message}`);
  });
  if (earsIssues.length > 0) {
    throw new Error(
      `cladding: feature '${slug}' has EARS-shape issue(s) — fix the AC(s) and retry create:\n  - ${earsIssues.join('\n  - ')}`,
    );
  }

  const cwd = opts.cwd ?? '.';
  const featuresDir = join(cwd, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});

  const id = generateFeatureId(slug);
  const hash = id.slice(2); // strip 'F-' prefix
  const filePath = join(featuresDir, `${slug}-${hash}.yaml`);
  if (existsSync(filePath)) {
    // 1/4.3B coincidence — the caller can retry with a fresh timestamp.
    throw new Error(
      `cladding: ${slug}-${hash}.yaml already exists (hash collision) — retry`,
    );
  }

  const title = opts.title ?? slug;
  // F-?: 'done' is EARNED through the gate (flip→gate→revert in clad done),
  // never declared at birth — the mid-scale A/B caught an agent creating
  // shards as status:'done' through this MCP path, skipping the earn ritual
  // and the PreToolUse hand-flip hook entirely. Downgrade with a visible note.
  const requestedDone = opts.status === 'done';
  const status = requestedDone ? 'in_progress' : (opts.status ?? 'planned');
  const yaml = renderYaml({
    id,
    slug,
    title,
    status,
    modules: opts.modules,
    acceptance_criteria: opts.acceptance_criteria,
  });
  writeFileSync(filePath, yaml, 'utf8');
  // F-b84c38 — spec authorship lands in the ledger (best-effort).
  recordEvent(cwd, 'feature_created', {feature: id, slug});

  return {
    id,
    path: filePath,
    slug,
    ...(requestedDone
      ? {
          note:
            "status 'done' is earned, not declared — created as in_progress; run `clad done " +
            id +
            '` once the strict gate is GREEN.',
        }
      : {}),
  };
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

  lines.push('');
  return lines.join('\n');
}

/**
 * Generates a 6-character hex hash id. Inputs that distinguish two
 * concurrent invocations: slug, OS user, hostname, ms timestamp,
 * high-resolution nanosecond counter. Same hash twice = 1/4.3B
 * coincidence; collision detection in the caller handles that.
 */
function generateFeatureId(slug: string): string {
  const input = [
    slug,
    safeUserInfo(),
    hostname(),
    String(Date.now()),
    process.hrtime.bigint().toString(),
  ].join('|');
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `F-${hex}`;
}

/**
 * Hash-model acceptance-criterion id, the AC-tier analogue of the feature/scenario
 * hash. Sequential `AC-001`/`AC-002` collide when two developers add an AC to the
 * same shard on separate branches (both pick the next ordinal); a per-AC hash —
 * seeded with the slug, the AC index, its prose, and the same machine/clock
 * entropy as `generateFeatureId` — makes independent additions merge-safe. The
 * schema accepts both `AC-<hash6>` and the legacy `AC-NNN` (dual pattern).
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
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `AC-${hex}`;
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
  /** Optional list of feature ids the scenario touches. */
  readonly features?: readonly string[];
  /** Project root. Defaults to `.`. */
  readonly cwd?: string;
}

export interface CreateScenarioResult {
  /** The newly-assigned scenario id (e.g. `S-a3f9c2`). */
  readonly id: string;
  /** Absolute path to the newly-written yaml file. */
  readonly path: string;
  /** The slug as stored. */
  readonly slug: string;
}

/**
 * Creates a new sharded scenario file at
 * `spec/scenarios/<slug>-<hash6>.yaml` with `id: S-<hash6>`.
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
  const scenariosDir = join(cwd, 'spec', 'scenarios');
  mkdirSync(scenariosDir, {recursive: true});

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
  writeFileSync(filePath, yaml, 'utf8');
  recordEvent(cwd, 'scenario_created', {scenario: id, slug});

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
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 8);
  return `S-${hex}`;
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

const FEATURE_ID_PATTERN = /^F-(\d{3,}|[a-f0-9]{6,})$/;
type CapabilitySurfaceValue = 'feature' | 'platform' | 'tool' | 'infrastructure';

interface CapabilityRecord {
  id: string;
  title?: string;
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

  const path = join(cwd, 'spec', 'capabilities.yaml');
  let capabilities: CapabilityRecord[] = [];
  let prefix = DEFAULT_CAPABILITIES_HEADER;

  if (existsSync(path)) {
    const raw = readFileSync(path, 'utf8');
    const parsed = yaml.parse(raw) as {capabilities?: unknown} | null;
    if (parsed && Array.isArray(parsed.capabilities)) {
      capabilities = parsed.capabilities.filter(
        (c): c is CapabilityRecord => typeof c === 'object' && c !== null,
      ) as CapabilityRecord[];
    }
    // Preserve everything before the top-level `capabilities:` key; re-emit the rest.
    const match = raw.search(/^capabilities:/m);
    prefix = match >= 0 ? raw.slice(0, match) : raw.endsWith('\n') ? raw : `${raw}\n`;
  } else {
    mkdirSync(join(cwd, 'spec'), {recursive: true});
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

  writeFileSync(path, prefix + renderCapabilitiesBlock(capabilities), 'utf8');
  return {capability: capId, feature, created, alreadyLinked, path};
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
