/**
 * Describes one deterministic mirror-policy diagnostic.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export interface MirrorIssue { readonly kind: string; readonly path: string; readonly detail: string; }

/**
 * Describes expected bytes for one managed mirror output.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export interface MirrorExpected { readonly path: string; readonly bytes: string; readonly source: string; readonly sha256: string; }

/**
 * Describes the observed state of one managed mirror output.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export interface MirrorOutput { readonly path: string; readonly source: string; readonly expected_sha256: string; readonly actual_sha256: string; readonly state: 'current' | 'missing' | 'stale'; }

/**
 * Carries the sealed byte census for the complete plugin mirror closure.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export interface MirrorCensus {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly inputAddresses: readonly string[];
  readonly inputSha256: string;
  readonly expected: readonly MirrorExpected[];
  readonly outputs: readonly MirrorOutput[];
  readonly issues: readonly MirrorIssue[];
  readonly complete: boolean;
  readonly clean: boolean;
}

/**
 * Describes one preflight-owned operation for a managed mirror output.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export interface MirrorOperation { readonly operation: 'update' | 'delete'; readonly path: string; readonly bytes?: string; }

/**
 * Lists the canonical persona inputs mirrored to plugin hosts.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-003
 */
export const PERSONAS: readonly string[];

/**
 * Lists the canonical skill inputs mirrored to plugin hosts.
 *
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-003
 */
export const SKILLS: readonly string[];

/**
 * Returns canonical and policy input paths that determine mirror generation.
 *
 * @returns Sorted canonical and policy input paths.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function mirrorInputPaths(): readonly string[];

/**
 * Returns exactly the generated paths managed by the mirror policy.
 *
 * @returns Sorted managed mirror output paths.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function mirrorOutputPaths(): readonly string[];

/**
 * Returns the complete artifact closure of mirror inputs and outputs.
 *
 * @returns Sorted unique paths that invalidate the mirror census.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function mirrorClosurePaths(): readonly string[];

/**
 * Returns the immutable identity for the mirror policy.
 *
 * @returns The current lane and transform manifest.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-003
 */
export function mirrorManifest(): Readonly<Record<string, unknown>>;

/**
 * Renders the Gemini command transform for canonical skill bytes.
 *
 * @param raw - Canonical SKILL.md bytes to transform.
 * @returns Gemini TOML bytes, or `undefined` for invalid frontmatter.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function renderGeminiToml(raw: string): string | undefined;

/**
 * Performs a deterministic read-only census for one workspace root.
 *
 * @param root - Workspace root containing canonical inputs and managed outputs.
 * @returns A sealed mirror census over the complete artifact closure.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function derivePluginMirror(root: string): MirrorCensus;

/**
 * Produces the exact preflight-owned operations for a complete mirror census.
 *
 * @param census - Complete read-only mirror census to reconcile.
 * @returns Sorted update and delete operations, or none when incomplete.
 * @see spec/features/persona-skill-md-cleanup-40327b.yaml AC-004
 */
export function mirrorOperationPlan(census: MirrorCensus): readonly MirrorOperation[];
