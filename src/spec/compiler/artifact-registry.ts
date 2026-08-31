// Cladding · Spec 0.2 F1 · executable artifact ownership registry.

/** Authority class for a logical artifact. */
export type ArtifactAuthority = 'canonical' | 'generated' | 'migration' | 'evidence' | 'transient';

/** Mutability rule enforced before a managed write is attempted. */
export type ArtifactMutability = 'mutable' | 'create-only' | 'immutable';

/** Persistence category for artifact bytes. */
export type ArtifactPersistence = 'committed' | 'workspace-cache' | 'external-receipt';

/** Path matcher used by a descriptor. */
export interface ArtifactPathMatcher {
  /** Exact repository-relative path or a regular expression over normalized paths. */
  readonly kind: 'exact' | 'pattern';
  /** Matching path value. */
  readonly value: string | RegExp;
}

/** One authoritative description of a managed artifact or byte region. */
export interface ArtifactDescriptor {
  /** Stable logical artifact or region ID. */
  readonly id: string;
  /** Current canonical location in the schema 0.1 workspace. */
  readonly currentPath: string;
  /** Later or legacy locations the reader recognizes without changing ownership. */
  readonly compatibilityAliases: readonly string[];
  /** Current-path matcher. */
  readonly matcher: ArtifactPathMatcher;
  /** Schema versions whose compiler may consume the artifact. */
  readonly supportedSchemaVersions: readonly ('0.1' | '0.2')[];
  /** Semantic area governed by the artifact. */
  readonly domain: string;
  /** Whether bytes are canonical, derived, migratory, evidentiary, or transient. */
  readonly authority: ArtifactAuthority;
  /** Whether a tool may replace existing bytes. */
  readonly mutability: ArtifactMutability;
  /** Whether an immutable/create-only receipt has an explicit transaction-owned revocation path. */
  readonly revocable?: boolean;
  /** Where the bytes live and whether they participate in source control. */
  readonly persistence: ArtifactPersistence;
  /** Component allowed to produce the artifact. */
  readonly producer: string;
  /** Components that consume the artifact. */
  readonly consumers: readonly string[];
  /** Inputs that determine a refresh or issuance. */
  readonly inputs: readonly string[];
  /** Refresh or issuance policy. */
  readonly refresh: string;
  /** File ownership or a named byte region within the file. */
  readonly ownership: {readonly kind: 'file' | 'region'; readonly region?: string};
}

/** A managed write request resolved against the registry. */
export interface ManagedWriteTarget {
  /** Repository-relative path to create or update. */
  readonly path: string;
  /** Named region when the target file has region-scoped ownership. */
  readonly region?: string;
  /** Intended write operation. */
  readonly operation: 'create' | 'update' | 'delete';
}

const exact = (value: string): ArtifactPathMatcher => ({kind: 'exact', value});
const pattern = (value: RegExp): ArtifactPathMatcher => ({kind: 'pattern', value});

/**
 * The sole F1 registry for Spec 0.2 artifact ownership.
 *
 * `spec.yaml#project` and `spec.yaml#inventory` are deliberately distinct so
 * generated inventory refreshes cannot claim project-purpose authority.
 *
 * @see docs/design/spec-0.2/model-and-migration.md#d10--artifact-registry-and-compiler-boundary
 */
export const ARTIFACT_DESCRIPTORS: readonly ArtifactDescriptor[] = [
  {
    id: 'spec-schema-region', currentPath: 'spec.yaml', compatibilityAliases: [], matcher: exact('spec.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'schema', authority: 'migration', mutability: 'mutable', persistence: 'committed',
    producer: 'F4 migration transaction', consumers: ['spec compiler', 'legacy loader'], inputs: ['approved root-schema transition'], refresh: 'only during an approved transactional schema switch', ownership: {kind: 'region', region: 'schema'},
  },
  {
    id: 'spec-project-region', currentPath: 'spec.yaml', compatibilityAliases: [], matcher: exact('spec.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'project', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'authoring transaction', consumers: ['spec compiler', 'legacy loader'], inputs: ['project contract'], refresh: 'human or transactional edit', ownership: {kind: 'region', region: 'project'},
  },
  {
    id: 'spec-inventory-region', currentPath: 'spec.yaml', compatibilityAliases: [], matcher: exact('spec.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'inventory', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'clad sync', consumers: ['spec compiler', 'onboarding'], inputs: ['shard census'], refresh: 'after inventory-affecting sync', ownership: {kind: 'region', region: 'inventory'},
  },
  {
    id: 'feature-shard', currentPath: 'spec/features/<slug>-<hash8>.yaml', compatibilityAliases: ['spec/features/F-NNN.yaml'], matcher: pattern(/^spec\/features\/[^/]+\.ya?ml$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'feature', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'feature authoring transaction', consumers: ['spec compiler', 'legacy loader', 'detectors'], inputs: ['feature contract'], refresh: 'on feature authoring', ownership: {kind: 'file'},
  },
  {
    id: 'scenario-shard', currentPath: 'spec/scenarios/<slug>-<hash8>.yaml', compatibilityAliases: ['spec/scenarios/S-NNN.yaml'], matcher: pattern(/^spec\/scenarios\/[^/]+\.ya?ml$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'scenario', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'scenario authoring transaction', consumers: ['spec compiler', 'legacy loader'], inputs: ['scenario contract'], refresh: 'on scenario authoring', ownership: {kind: 'file'},
  },
  {
    id: 'architecture-contract', currentPath: 'spec/architecture.yaml', compatibilityAliases: [], matcher: exact('spec/architecture.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'architecture', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'authoring transaction', consumers: ['spec compiler', 'architecture detector'], inputs: ['architecture rules'], refresh: 'on architecture edit', ownership: {kind: 'file'},
  },
  {
    id: 'capability-catalog', currentPath: 'spec/capabilities.yaml', compatibilityAliases: [], matcher: exact('spec/capabilities.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'capability', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'capability authoring transaction', consumers: ['spec compiler', 'legacy loader'], inputs: ['capability catalog'], refresh: 'on capability edit', ownership: {kind: 'file'},
  },
  {
    id: 'conformance-fixture-registry', currentPath: 'conformance/fixtures.yaml', compatibilityAliases: [], matcher: exact('conformance/fixtures.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'fixture-registry', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'conformance fixture authors', consumers: ['spec compiler', 'fixture-reference detector'], inputs: ['fixture declarations'], refresh: 'on fixture registration edit', ownership: {kind: 'file'},
  },
  {
    id: 'package-scripts-region', currentPath: 'package.json', compatibilityAliases: [], matcher: exact('package.json'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'package-scripts', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'package authoring transaction', consumers: ['spec compiler', 'script runners'], inputs: ['package scripts'], refresh: 'on package-script edit', ownership: {kind: 'region', region: 'scripts'},
  },
  {
    id: 'evidence-receipt', currentPath: 'spec/evidence/<F-id>/<sha256>.yaml', compatibilityAliases: [], matcher: pattern(/^spec\/evidence\/F-[^/]+\/[a-f0-9]{64}\.yaml$/),
    supportedSchemaVersions: ['0.2'], domain: 'evidence', authority: 'evidence', mutability: 'create-only', persistence: 'committed',
    producer: 'registered evidence channel', consumers: ['proof compiler', 'attestation'], inputs: ['signed receipt digest and subject'], refresh: 'create once; revoke through an explicit future operation', revocable: true, ownership: {kind: 'file'},
  },
  {
    id: 'migration-baseline', currentPath: 'spec/generated/migration-baseline-0.1-to-0.2.yaml', compatibilityAliases: [], matcher: exact('spec/generated/migration-baseline-0.1-to-0.2.yaml'),
    supportedSchemaVersions: ['0.2'], domain: 'migration', authority: 'migration', mutability: 'create-only', persistence: 'committed',
    producer: 'F4 migration transaction', consumers: ['migration validator', 'spec compiler'], inputs: ['schema 0.1 source corpus'], refresh: 'one immutable upgrade receipt', ownership: {kind: 'file'},
  },
  {
    id: 'generated-index', currentPath: 'spec/index.yaml', compatibilityAliases: ['spec/generated/index.yaml'], matcher: exact('spec/index.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'index', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'clad sync', consumers: ['lookup tools'], inputs: ['sharded spec'], refresh: 'on sync', ownership: {kind: 'file'},
  },
  {
    id: 'generated-doc-links', currentPath: 'spec/_doc-links.yaml', compatibilityAliases: ['spec/generated/_doc-links.yaml'], matcher: exact('spec/_doc-links.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'documentation', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'document-link extractor', consumers: ['document integrity detector'], inputs: ['document declarations'], refresh: 'on sync', ownership: {kind: 'file'},
  },
  {
    id: 'project-context', currentPath: 'docs/project-context.md', compatibilityAliases: [], matcher: exact('docs/project-context.md'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'project-context', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'project maintainers', consumers: ['design-impact review', 'context readers'], inputs: ['project architecture context'], refresh: 'on reviewed project-context change', ownership: {kind: 'file'},
  },
  {
    id: 'spec-02-design-document', currentPath: 'docs/design/**/*.md', compatibilityAliases: [], matcher: pattern(/^docs\/design\/(?:[^/]+\/)*[^/]+\.md$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'design', authority: 'canonical', mutability: 'mutable', persistence: 'committed',
    producer: 'design maintainers', consumers: ['design-impact review', 'spec compiler'], inputs: ['accepted target-design decisions'], refresh: 'on reviewed design decision change', ownership: {kind: 'file'},
  },
  {
    id: 'generated-attestation', currentPath: 'spec/attestation.yaml', compatibilityAliases: ['spec/generated/attestation.yaml'], matcher: exact('spec/attestation.yaml'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'attestation', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'qualifying completion gate', consumers: ['attestation reader'], inputs: ['green verification closure'], refresh: 'only after a qualifying green gate', ownership: {kind: 'file'},
  },
  {
    id: 'generated-directory-notice', currentPath: 'spec/generated/README.md', compatibilityAliases: [], matcher: exact('spec/generated/README.md'),
    supportedSchemaVersions: ['0.2'], domain: 'generated-directory', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'artifact registry projection', consumers: ['repository readers'], inputs: ['ARTIFACT_DESCRIPTORS'], refresh: 'on artifact registry change', ownership: {kind: 'file'},
  },
  {
    id: 'plugin-persona-skill-mirrors', currentPath: 'plugins/<host>/managed-persona-skill-mirror', compatibilityAliases: [], matcher: pattern(/^plugins\/(?:claude-code\/(?:agents|commands|dist\/agents)|codex\/skills|antigravity\/skills|gemini-cli\/commands)(?:\/.*)?$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'plugin-mirror', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'scripts/build-plugin.mjs mirror policy', consumers: ['plugin hosts', 'criterion static adapter'], inputs: ['src/agents persona briefs', 'skills SKILL.md inputs', 'plugin mirror policy'], refresh: 'on canonical persona or skill change', ownership: {kind: 'file'},
  },
  {
    id: 'claude-bundled-engine', currentPath: 'plugins/claude-code/dist/<engine>', compatibilityAliases: [], matcher: pattern(/^plugins\/claude-code\/dist\/(?:clad\.js|schema\.json)$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'plugin-engine', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'scripts/build-plugin.mjs', consumers: ['Claude Code plugin host'], inputs: ['dist/clad.js', 'dist/schema.json'], refresh: 'after engine build', ownership: {kind: 'file'},
  },
  {
    id: 'claude-plugin-detector-region', currentPath: 'plugins/claude-code/.claude-plugin/plugin.json', compatibilityAliases: [], matcher: exact('plugins/claude-code/.claude-plugin/plugin.json'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'plugin-manifest', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'scripts/build-plugin.mjs', consumers: ['Claude Code plugin host', 'harness integrity detector'], inputs: ['src/stages/detectors filesystem'], refresh: 'on plugin build', ownership: {kind: 'region', region: 'ironclad.detectors'},
  },
  {
    id: 'claude-plugin-stages-region', currentPath: 'plugins/claude-code/.claude-plugin/plugin.json', compatibilityAliases: [], matcher: exact('plugins/claude-code/.claude-plugin/plugin.json'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'plugin-manifest', authority: 'generated', mutability: 'mutable', persistence: 'committed',
    producer: 'scripts/build-plugin.mjs', consumers: ['Claude Code plugin host', 'harness integrity detector'], inputs: ['src/cli/clad.ts TIER_STAGES.all'], refresh: 'on plugin build', ownership: {kind: 'region', region: 'stages-implemented'},
  },
  {
    id: 'compiler-cache', currentPath: '.cladding/cache/spec-compiler', compatibilityAliases: [], matcher: pattern(/^\.cladding\/cache\/spec-compiler(?:\/[^/]+)*$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'compiler', authority: 'transient', mutability: 'mutable', persistence: 'workspace-cache',
    producer: 'spec compiler', consumers: ['spec compiler'], inputs: ['disposable input digests'], refresh: 'disposable cache refresh', ownership: {kind: 'file'},
  },
  {
    id: 'workspace-audit', currentPath: '.cladding/audit', compatibilityAliases: [], matcher: pattern(/^\.cladding\/audit(?:\/[^/]+)*$/),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'workspace-audit', authority: 'transient', mutability: 'mutable', persistence: 'workspace-cache',
    producer: 'local audit commands', consumers: ['local audit readers'], inputs: ['local command output'], refresh: 'replaceable local diagnostics', ownership: {kind: 'file'},
  },
  {
    id: 'event-ledger', currentPath: '.cladding/events.log.jsonl', compatibilityAliases: [], matcher: exact('.cladding/events.log.jsonl'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'event-ledger', authority: 'transient', mutability: 'mutable', persistence: 'workspace-cache',
    producer: 'event ledger and F4 transaction', consumers: ['MCP event reader', 'lifecycle reports'], inputs: ['committed lifecycle transitions'], refresh: 'append under the workspace transaction lock', ownership: {kind: 'file'},
  },
  {
    id: 'asserted-audit-ledger', currentPath: '.cladding/audit.log.jsonl', compatibilityAliases: [], matcher: exact('.cladding/audit.log.jsonl'),
    supportedSchemaVersions: ['0.1', '0.2'], domain: 'evidence-history', authority: 'transient', mutability: 'mutable', persistence: 'workspace-cache',
    producer: 'asserted signoff and legacy audit commands', consumers: ['HITL readers', 'MCP audit resource'], inputs: ['asserted evidence entries'], refresh: 'append under the F4 workspace transaction lock', ownership: {kind: 'file'},
  },
];

/** Normalizes a repository-relative artifact path before descriptor matching. */
export function normalizeArtifactPath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((part) => part === '..')) {
    throw new Error(`managed artifact path must be repository-relative: ${path}`);
  }
  return normalized;
}

/** Resolves every descriptor matching a path and optional region. */
export function resolveArtifactDescriptors(path: string, region?: string): readonly ArtifactDescriptor[] {
  const normalized = normalizeArtifactPath(path);
  return ARTIFACT_DESCRIPTORS.filter((descriptor) => {
    const pathMatches = descriptor.matcher.kind === 'exact'
      ? descriptor.matcher.value === normalized
      : (descriptor.matcher.value as RegExp).test(normalized);
    if (!pathMatches) return false;
    return region === undefined || descriptor.ownership.region === region;
  });
}

/**
 * Resolves a write target to its one authoritative descriptor.
 *
 * @throws Error for unmanaged targets, ambiguous root-file regions, and writes that violate mutability.
 */
export function resolveManagedWrite(target: ManagedWriteTarget): ArtifactDescriptor {
  const matches = resolveArtifactDescriptors(target.path, target.region);
  if (target.region === undefined && matches.some((descriptor) => descriptor.ownership.kind === 'region')) {
    throw new Error(`managed region write for ${target.path} requires an explicit region`);
  }
  if (matches.length !== 1) {
    const detail = matches.length === 0 ? 'no descriptor' : matches.map((descriptor) => descriptor.id).join(', ');
    throw new Error(`managed write ownership for ${target.path}${target.region ? `#${target.region}` : ''} is not unique: ${detail}`);
  }
  const descriptor = matches[0];
  if (target.operation === 'delete') {
    if (descriptor.mutability !== 'mutable' && !descriptor.revocable) throw new Error(`${descriptor.id} does not permit delete writes`);
    return descriptor;
  }
  if (descriptor.mutability === 'immutable' || (descriptor.mutability === 'create-only' && target.operation !== 'create')) {
    throw new Error(`${descriptor.id} does not permit ${target.operation} writes`);
  }
  return descriptor;
}

/** Renders the registry's single-source artifact table for prose projections. */
export function renderArtifactRegistryTable(): string {
  const rows = [...ARTIFACT_DESCRIPTORS]
    .filter((descriptor) => descriptor.authority !== 'transient')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((descriptor) => `| ${descriptor.id} | \`${descriptor.currentPath}\` | ${descriptor.authority} | ${descriptor.refresh} |`);
  return ['| Artifact | Current path | Authority | Refresh |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

/** Renders the prospective generated-directory notice from registry metadata. */
export function renderGeneratedDirectoryNotice(): string {
  const rows = ARTIFACT_DESCRIPTORS
    .filter((descriptor) => descriptor.authority === 'generated' || descriptor.authority === 'migration')
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((descriptor) => `- \`${descriptor.compatibilityAliases[0] ?? descriptor.currentPath}\` — ${descriptor.id}; ${descriptor.refresh}.`);
  return ['# Generated artifacts', '', 'This notice is projected from the executable artifact registry.', '', ...rows, ''].join('\n');
}
