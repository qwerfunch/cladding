// Cladding · spec · createFeature — internal feature creator (F-084).
//
// Issues a new sharded feature file at `spec/features/<slug>.yaml`
// with an automatically-generated content-hash id. Designed for
// multi-developer concurrency: two contributors can create features
// simultaneously on separate branches without git merge conflicts as
// long as their slugs differ — the hash id collision probability is
// < 1/16M because the hash input includes user + hostname + timestamp
// + hrtime.
//
// CLI surface: **none**. This function is invoked only from inside
// cladding (drive loop, librarian persona dispatch) or via the
// `clad_create_feature` MCP tool that `clad serve` exposes to host
// LLMs. A user never types a `clad spec new` command — they ask the
// host AI ("add a feature for login-flow"), the host LLM calls the
// MCP tool, the MCP tool calls this function.
//
// @see spec/features/F-084.yaml — this feature.

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {hostname, userInfo} from 'node:os';
import {join} from 'node:path';

const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * One acceptance criterion supplied at feature-creation time. `id` is
 * auto-assigned (`AC-001`, `AC-002`, …); every other field is optional but
 * constrained to the schema's `acceptance_criterion` properties
 * (additionalProperties:false). Supplying these at creation is what stops a
 * `clad_create_feature` call from producing a hollow stub — the feature lands
 * with real, gate-checkable acceptance criteria, not an empty `[]`.
 */
export interface AcceptanceCriterionInput {
  /** EARS pattern. */
  readonly ears?: 'ubiquitous' | 'event' | 'state' | 'optional' | 'unwanted';
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
 *         (1/16M probability; the caller may retry).
 */
export function createFeature(opts: CreateFeatureOptions): CreateFeatureResult {
  const slug = opts.slug;
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `cladding: slug '${slug}' is invalid — must match ${SLUG_PATTERN.source}`,
    );
  }
  const cwd = opts.cwd ?? '.';
  const featuresDir = join(cwd, 'spec', 'features');
  mkdirSync(featuresDir, {recursive: true});

  const id = generateFeatureId(slug);
  const hash = id.slice(2); // strip 'F-' prefix
  const filePath = join(featuresDir, `${slug}-${hash}.yaml`);
  if (existsSync(filePath)) {
    // 1/16M coincidence — the caller can retry with a fresh timestamp.
    throw new Error(
      `cladding: ${slug}-${hash}.yaml already exists (1/16M hash collision) — retry`,
    );
  }

  const title = opts.title ?? slug;
  const status = opts.status ?? 'planned';
  const yaml = renderYaml({
    id,
    slug,
    title,
    status,
    modules: opts.modules,
    acceptance_criteria: opts.acceptance_criteria,
  });
  writeFileSync(filePath, yaml, 'utf8');

  return {id, path: filePath, slug};
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
      lines.push(`  - id: AC-${String(i + 1).padStart(3, '0')}`);
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
 * high-resolution nanosecond counter. Same hash twice = 1/16M
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
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 6);
  return `F-${hex}`;
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
      `cladding: ${slug}-${hash}.yaml already exists (1/16M hash collision) — retry`,
    );
  }

  const title = opts.title ?? slug;
  const yaml = renderScenarioYaml({id, slug, title, flow: opts.flow, features: opts.features ?? []});
  writeFileSync(filePath, yaml, 'utf8');

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
  const hex = createHash('sha256').update(input).digest('hex').slice(0, 6);
  return `S-${hex}`;
}
