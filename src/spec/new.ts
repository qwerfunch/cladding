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
 * Creates a new sharded feature file. Throws when the slug is
 * malformed, when the target file already exists, or when the
 * generated hash collides with an existing feature (1/16M probability;
 * the caller may retry — the second call uses a different timestamp).
 *
 * The hash input bundles the slug + user + hostname + millisecond
 * timestamp + high-resolution nanosecond counter, so simultaneous
 * invocations across two branches produce different hashes by
 * construction.
 *
 * @param opts - {@link CreateFeatureOptions}.
 * @returns The newly-assigned id, the file path, and the slug.
 * @throws Error when `slug` is invalid, the file already exists, or
 *         the hash collides with an existing feature in this cwd.
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

  const slugPath = join(featuresDir, `${slug}.yaml`);
  if (existsSync(slugPath)) {
    throw new Error(
      `cladding: spec/features/${slug}.yaml already exists — pick a different slug`,
    );
  }

  const id = generateFeatureId(slug);
  // Defensive: the same hash twice in one cladding tree would be a
  // 1/16M coincidence, but we still check — the caller can retry.
  const idPath = join(featuresDir, `${id}.yaml`);
  if (existsSync(idPath)) {
    throw new Error(
      `cladding: generated id '${id}' collides with an existing feature file — retry`,
    );
  }

  const title = opts.title ?? slug;
  const status = opts.status ?? 'planned';
  const yaml = renderYaml({id, slug, title, status});
  writeFileSync(slugPath, yaml, 'utf8');

  return {id, path: slugPath, slug};
}

/**
 * Renders the minimal feature yaml. Hand-written rather than going
 * through the yaml package because the layout is fixed and a tiny
 * deterministic emitter avoids the indentation / key-order ambiguity
 * a general yaml dumper would introduce.
 */
function renderYaml(args: {id: string; slug: string; title: string; status: string}): string {
  const lines = [
    `id: ${args.id}`,
    `slug: ${args.slug}`,
    `title: ${JSON.stringify(args.title)}`,
    `status: ${args.status}`,
    'modules: []',
    'acceptance_criteria: []',
    '',
  ];
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
