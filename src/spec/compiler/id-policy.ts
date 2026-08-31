// Cladding · Spec 0.2 F1 · executable identifier policy.

/** Identifier domains that have stable addresses in the specification. */
export type SpecIdKind = 'feature' | 'criterion' | 'scenario' | 'architecture_rule';

/** Policy for one stable identifier namespace. */
export interface IdPolicy {
  /** Stable registry key used by writers and validators. */
  readonly kind: SpecIdKind;
  /** Address prefix before the hyphen. */
  readonly prefix: 'F' | 'AC' | 'S' | 'AR';
  /** Minimum digit count accepted for historical sequential records. */
  readonly legacySequentialMinimumDigits: number;
  /** Minimum hexadecimal length accepted by schema 0.1 compatibility readers. */
  readonly legacyHashMinimumLength: number;
  /** Exact lowercase hexadecimal length every new writer must emit. */
  readonly emittedHashLength: number;
  /** Whether a new shard filename must end with the identifier's hash. */
  readonly shardFilename: boolean;
}

/**
 * Canonical policy for legacy readers and new writers.
 *
 * Readers deliberately remain more permissive than writers: old 0.1 data is
 * durable audit history, whereas every newly-authored hash uses eight lowercase
 * hexadecimal characters.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d04--identity-and-sharding
 */
export const ID_POLICIES: Readonly<Record<SpecIdKind, IdPolicy>> = {
  feature: {
    kind: 'feature',
    prefix: 'F',
    legacySequentialMinimumDigits: 3,
    legacyHashMinimumLength: 6,
    emittedHashLength: 8,
    shardFilename: true,
  },
  criterion: {
    kind: 'criterion',
    prefix: 'AC',
    legacySequentialMinimumDigits: 3,
    legacyHashMinimumLength: 6,
    emittedHashLength: 8,
    shardFilename: false,
  },
  scenario: {
    kind: 'scenario',
    prefix: 'S',
    legacySequentialMinimumDigits: 3,
    legacyHashMinimumLength: 6,
    emittedHashLength: 8,
    shardFilename: true,
  },
  architecture_rule: {
    kind: 'architecture_rule',
    prefix: 'AR',
    legacySequentialMinimumDigits: 3,
    legacyHashMinimumLength: 6,
    emittedHashLength: 8,
    shardFilename: false,
  },
};

/** Returns the policy for a specification identifier namespace. */
export function idPolicy(kind: SpecIdKind): IdPolicy {
  return ID_POLICIES[kind];
}

/** Returns the anchored compatibility-reader regular-expression source. */
export function readableIdPatternSource(kind: SpecIdKind): string {
  const policy = idPolicy(kind);
  return `^${policy.prefix}-(\\d{${policy.legacySequentialMinimumDigits},}|[a-f0-9]{${policy.legacyHashMinimumLength},})$`;
}

/** Returns a fresh compatibility-reader regular expression. */
export function readableIdPattern(kind: SpecIdKind): RegExp {
  return new RegExp(readableIdPatternSource(kind));
}

/** Returns the embedded source used when scanning prose for an identifier. */
export function embeddedReadableIdSource(kind: SpecIdKind): string {
  const policy = idPolicy(kind);
  return String.raw`\b${policy.prefix}-(?:\d{${policy.legacySequentialMinimumDigits},}|[0-9a-f]{${policy.legacyHashMinimumLength},})\b`;
}

/** Returns whether an identifier is accepted by a schema 0.1 compatibility reader. */
export function isReadableId(kind: SpecIdKind, value: string): boolean {
  return readableIdPattern(kind).test(value);
}

/** Returns whether an identifier is in the exact form emitted by a new writer. */
export function isNewId(kind: SpecIdKind, value: string): boolean {
  const policy = idPolicy(kind);
  return new RegExp(`^${policy.prefix}-[a-f0-9]{${policy.emittedHashLength}}$`).test(value);
}

/**
 * Converts a hexadecimal digest into a new identifier.
 *
 * @throws Error when the supplied digest cannot prove the exact emitted form.
 */
export function newIdFromDigest(kind: SpecIdKind, digest: string): string {
  const policy = idPolicy(kind);
  const normalized = digest.toLowerCase();
  if (!/^[a-f0-9]+$/.test(normalized) || normalized.length < policy.emittedHashLength) {
    throw new Error(`${policy.prefix} identifier digest must contain at least ${policy.emittedHashLength} lowercase hexadecimal characters`);
  }
  return `${policy.prefix}-${normalized.slice(0, policy.emittedHashLength)}`;
}

/**
 * Validates a new feature or scenario shard filename against its generated ID.
 *
 * @throws Error when the namespace does not own shard filenames or the name is not a checksum.
 */
export function assertNewShardFilename(kind: 'feature' | 'scenario', filename: string, identifier: string): void {
  const policy = idPolicy(kind);
  if (!policy.shardFilename || !isNewId(kind, identifier)) {
    throw new Error(`${policy.prefix} shard filenames require an eight-hex generated identifier`);
  }
  const suffix = identifier.slice(policy.prefix.length + 1);
  if (!new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-${suffix}\\.ya?ml$`).test(filename)) {
    throw new Error(`${filename} does not carry the ${identifier} filename checksum`);
  }
}

/**
 * Returns whether a canonical feature or scenario shard path is safe for a compatibility reader.
 *
 * New writers use the eight-hex suffix; readers retain legacy six-or-more-hex
 * slugged suffixes and direct sequential shard names without accepting
 * traversal or an unrelated directory as an onboarding write target.
 */
export function isReadableShardFilename(kind: 'feature' | 'scenario', path: string): boolean {
  const policy = idPolicy(kind);
  const directory = kind === 'feature' ? 'spec/features/' : 'spec/scenarios/';
  if (!path.startsWith(directory) || path.includes('\\') || path.includes('..')) return false;
  const filename = path.slice(directory.length);
  if (filename.includes('/')) return false;
  const direct = new RegExp(`^${policy.prefix}-(\\d{${policy.legacySequentialMinimumDigits},}|[a-f0-9]{${policy.legacyHashMinimumLength},})\\.ya?ml$`).exec(filename);
  if (direct) return isReadableId(kind, `${policy.prefix}-${direct[1]}`);
  const slugged = new RegExp(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?-([a-f0-9]{${policy.legacyHashMinimumLength},})\\.ya?ml$`).exec(filename);
  return slugged !== null && isReadableId(kind, `${policy.prefix}-${slugged[1]}`);
}

/**
 * Derives the legacy-consumer slug from an authoritative shard path.
 *
 * A direct compatibility shard such as `F-001.yaml` retains its identifier as
 * the usable lookup key; a checksum-carrying shard removes only the exact id
 * suffix.  The filename policy remains here so writers, indexes, and consumer
 * projections cannot create competing slug rules.
 *
 * @param path - Repository-relative feature or scenario shard path.
 * @param identifier - Stable shard body identifier.
 * @returns The legacy-compatible slug or direct-id fallback.
 * @see docs/design/spec-0.2/model-and-migration.md#d04--identity-and-sharding
 */
export function shardFilenameSlug(path: string, identifier: string): string {
  const stem = path.split('/').pop()?.replace(/\.ya?ml$/i, '') ?? identifier;
  if (stem === identifier) return stem;
  const separator = identifier.indexOf('-');
  const suffix = separator < 0 ? '' : `-${identifier.slice(separator + 1)}`;
  return suffix && stem.endsWith(suffix) ? stem.slice(0, -suffix.length) : stem;
}

/** Returns concise wording for schema descriptions and transport metadata. */
export function idPolicyDescription(kind: SpecIdKind): string {
  const policy = idPolicy(kind);
  return `${policy.prefix}-<8 lowercase hex> for new records; legacy ${policy.prefix}-<${policy.legacySequentialMinimumDigits}+ digits> and ${policy.prefix}-<${policy.legacyHashMinimumLength}+ lowercase hex> remain readable.`;
}

/**
 * Verifies the static JSON Schema mirror against the executable policy.
 *
 * JSON Schema is a public data artifact, so it cannot import this module at
 * runtime; this guard prevents it becoming a second hand-maintained policy.
 */
export function idPolicySchemaIssues(schema: unknown): readonly string[] {
  if (!schema || typeof schema !== 'object') return ['schema is not an object'];
  const root = schema as {definitions?: Record<string, {properties?: Record<string, {pattern?: unknown; description?: unknown}>}>};
  const definitions = root.definitions;
  const fields: readonly [SpecIdKind, string, string][] = [
    ['feature', 'feature', 'id'],
    ['criterion', 'acceptance_criterion', 'id'],
    ['scenario', 'scenario', 'id'],
  ];
  const issues: string[] = [];
  for (const [kind, definition, field] of fields) {
    const actual = definitions?.[definition]?.properties?.[field]?.pattern;
    const expected = readableIdPatternSource(kind);
    if (actual !== expected) issues.push(`${definition}.${field} must use ${expected}`);
    const description = definitions?.[definition]?.properties?.[field]?.description;
    if (description !== idPolicyDescription(kind)) issues.push(`${definition}.${field} must use the executable policy description`);
  }
  const featureReferenceFields: readonly [string, string][] = [
    ['feature', 'depends_on'],
    ['feature', 'superseded_by'],
    ['scenario', 'features'],
    ['capability', 'features'],
  ];
  const expectedFeature = readableIdPatternSource('feature');
  for (const [definition, field] of featureReferenceFields) {
    const properties = definitions?.[definition]?.properties;
    const property = properties?.[field] as {items?: {pattern?: unknown}; pattern?: unknown} | undefined;
    const actual = property?.items?.pattern ?? property?.pattern;
    if (actual !== expectedFeature) issues.push(`${definition}.${field} must use ${expectedFeature}`);
  }
  return issues;
}
