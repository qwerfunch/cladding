// Cladding · Spec 0.2 F6 · assurance obligation identity authority.

/** Cumulative assurance level selected by a schema 0.2 project. */
export type AssuranceLevel = 'L1' | 'L2' | 'L3' | 'L4';

/** Canonical profile names.  Aliases are decoded at the transport boundary. */
export type AssuranceProfileId = 'feedback' | 'checkpoint' | 'completion' | 'push' | 'release';

/** Upstream Ironclad reporting semantics. */
export type StandardStrictness = 'hard' | 'report';

/** Cladding's effective authority decision. */
export type BlockingPolicy = 'hard' | 'report';

/** Cache policy declared by an adapter, not a scheduler implementation. */
export type AssuranceCachePolicy = 'same-session' | 'same-commit' | 'never';

/** Compiler-only applicability result. */
export type ObligationApplicability = 'required' | 'na' | 'unresolved';

/** One resource claim used by a future scheduler. */
export type AssuranceResource = 'cpu-exclusive' | 'network' | 'display' | 'port' | 'workspace-write';

/** Deterministic repository controls declared by one obligation adapter. */
export type AssuranceControl = 'workspace' | 'type' | 'lint' | 'test' | 'python' | 'rust' | 'go' | 'jvm';

/** Descriptor-owned execution metadata. */
export interface ObligationDescriptor {
  /** Stable obligation and legacy-stage identity. */
  readonly id: string;
  /** Business label used by adapter projections. */
  readonly label: string;
  /** True for one of the 13 Ironclad obligations. */
  readonly ironclad: boolean;
  /** Cumulative level at which this obligation enters. */
  readonly assuranceLevel: AssuranceLevel;
  /** Legacy stage identity retained for all existing readers. */
  readonly legacyAliases: readonly string[];
  /** Prerequisite obligations; the reducer never infers these from stage order. */
  readonly dependencies: readonly string[];
  /** Adapter identity; runners remain outside this registry. */
  readonly adapter: {readonly id: string; readonly version: string};
  /** Declares why a compiler proof can mark the obligation NA. */
  readonly applicability: 'always' | 'coverage' | 'oracle' | 'deliverable' | 'quality' | 'human';
  /** Upstream standard strictness, independent from Cladding policy. */
  readonly sourceStrictness: StandardStrictness;
  /** Effective Cladding blocking policy. */
  readonly blocking: BlockingPolicy;
  /** Reuse policy and all scheduler-facing metadata are descriptor-owned. */
  readonly cachePolicy: AssuranceCachePolicy;
  /** Future scheduler lock classes. */
  readonly resources: readonly AssuranceResource[];
  /** Whether an F9 scheduler may ever consider this adapter. */
  readonly backgroundSafe: boolean;
  /** Runner/configuration byte families this adapter needs sealed. */
  readonly controls: readonly AssuranceControl[];
}

/** Minimal compiler facts used to prove, never infer, applicability. */
export interface ApplicabilityFacts {
  /** Compiler completed the requested scope and its policy inputs. */
  readonly complete: boolean;
  /** Project has executable test proof governed by Coverage. */
  readonly hasExecutableTests?: boolean;
  /** Compiler proof that an oracle obligation is declared by current policy. */
  readonly hasOracleProof?: boolean;
  /** Project declares a safe deliverable. */
  readonly hasDeliverable?: boolean;
  /** Project kind requires system-quality checks. */
  readonly requiresQuality?: boolean;
  /** Project policy requires human evidence. */
  readonly requiresHuman?: boolean;
}

/** Legacy tier aliases are versioned profile aliases, not a second policy table. */
export const PROFILE_ALIASES: Readonly<Record<string, AssuranceProfileId>> = Object.freeze({
  'pre-commit': 'checkpoint',
  'pre-push': 'push',
  all: 'release',
});

/** UTF-16 code-unit comparison used by all signed and canonical projections. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const descriptor = (
  id: string,
  label: string,
  assuranceLevel: AssuranceLevel,
  applicability: ObligationDescriptor['applicability'],
  options: Partial<Omit<ObligationDescriptor, 'id' | 'label' | 'assuranceLevel' | 'applicability' | 'legacyAliases'>> = {},
): ObligationDescriptor => Object.freeze({
  id,
  label,
  ironclad: options.ironclad ?? true,
  assuranceLevel,
  legacyAliases: Object.freeze([id]),
  dependencies: Object.freeze([...(options.dependencies ?? [])]),
  adapter: options.adapter ?? {id: `legacy-stage:${id}`, version: '1'},
  applicability,
  sourceStrictness: options.sourceStrictness ?? 'hard',
  blocking: options.blocking ?? 'hard',
  cachePolicy: options.cachePolicy ?? 'same-commit',
  resources: Object.freeze([...(options.resources ?? [])]),
  backgroundSafe: options.backgroundSafe ?? false,
  controls: Object.freeze([...(options.controls ?? ['workspace'])]),
});

/**
 * The only code-owned obligation identity registry.  Core Coverage and
 * Performance remain upstream `report` while the effective Cladding policy
 * stays hard, preserving existing completion blocking without redefining the
 * standard.
 *
 * @see docs/design/spec-0.2/assurance.md#d21--iron-law-assurance-kernel
 */
export const OBLIGATION_DESCRIPTORS: readonly ObligationDescriptor[] = Object.freeze([
  descriptor('stage_1.1', 'Type', 'L1', 'always', {controls: ['workspace', 'type', 'python', 'rust', 'go', 'jvm']}),
  descriptor('stage_1.2', 'Lint', 'L1', 'always', {controls: ['workspace', 'lint', 'python', 'rust', 'go', 'jvm']}),
  descriptor('stage_1.3', 'Drift', 'L1', 'always', {backgroundSafe: true}),
  descriptor('stage_1.4', 'Commit', 'L1', 'always', {dependencies: ['stage_1.1', 'stage_1.2', 'stage_1.3'], cachePolicy: 'never', resources: ['workspace-write']}),
  descriptor('stage_1.5', 'Architecture', 'L1', 'always', {backgroundSafe: true}),
  descriptor('stage_1.6', 'Secret', 'L1', 'always', {backgroundSafe: true}),
  descriptor('stage_2.1', 'Unit', 'L2', 'coverage', {dependencies: ['stage_1.1', 'stage_1.2'], resources: ['cpu-exclusive'], controls: ['workspace', 'test', 'python', 'rust', 'go', 'jvm']}),
  descriptor('stage_2.2', 'Coverage', 'L2', 'coverage', {dependencies: ['stage_2.1'], sourceStrictness: 'report', blocking: 'hard', resources: ['cpu-exclusive'], controls: ['workspace', 'test', 'python', 'rust', 'go', 'jvm']}),
  descriptor('stage_2.3', 'Spec Conformance', 'L2', 'oracle', {dependencies: ['stage_2.1'], ironclad: false}),
  descriptor('stage_2.4', 'Deliverable Smoke', 'L2', 'deliverable', {dependencies: ['stage_2.1'], ironclad: false}),
  descriptor('stage_3.1', 'Smoke', 'L3', 'quality', {dependencies: ['stage_2.1'], resources: ['port']}),
  descriptor('stage_3.2', 'Performance', 'L3', 'quality', {dependencies: ['stage_3.1'], sourceStrictness: 'report', blocking: 'hard', cachePolicy: 'never', resources: ['cpu-exclusive']}),
  descriptor('stage_3.3', 'Visual', 'L3', 'quality', {dependencies: ['stage_3.1'], resources: ['display']}),
  descriptor('stage_4.1', 'Audit', 'L4', 'human', {dependencies: ['stage_2.1'], cachePolicy: 'never'}),
  descriptor('stage_4.2', 'UAT', 'L4', 'human', {dependencies: ['stage_4.1'], cachePolicy: 'never'}),
]);

const descriptorById = new Map(OBLIGATION_DESCRIPTORS.map((entry) => [entry.id, entry]));

/** Returns one registry-owned descriptor or fails rather than guessing an alias. */
export function obligationDescriptor(id: string): ObligationDescriptor | undefined {
  return descriptorById.get(id);
}

/** Returns the official 13 and extensions in deterministic legacy-stage order. */
export function descriptorsForLevel(level: AssuranceLevel): readonly ObligationDescriptor[] {
  const max = levelNumber(level);
  return OBLIGATION_DESCRIPTORS.filter((entry) => levelNumber(entry.assuranceLevel) <= max);
}

/** Compiler facts are the only route to NA; missing runners never qualify. */
export function deriveApplicability(
  descriptorEntry: ObligationDescriptor,
  facts: ApplicabilityFacts,
): ObligationApplicability {
  if (!facts.complete) return 'unresolved';
  switch (descriptorEntry.applicability) {
    case 'always': return 'required';
    case 'coverage': return facts.hasExecutableTests === true ? 'required' : 'na';
    case 'oracle': return facts.hasOracleProof === true ? 'required' : 'na';
    case 'deliverable': return facts.hasDeliverable === true ? 'required' : 'na';
    case 'quality': return facts.requiresQuality === true ? 'required' : 'na';
    case 'human': return facts.requiresHuman === true ? 'required' : 'na';
  }
}

/** Numeric ordering exists only to express the cumulative public ladder. */
export function levelNumber(level: AssuranceLevel): number {
  return Number(level.slice(1));
}

/** Decodes canonical names and read-compatible tier aliases. */
export function normalizeProfile(profile: string): AssuranceProfileId | undefined {
  if (profile === 'feedback' || profile === 'checkpoint' || profile === 'completion' || profile === 'push' || profile === 'release') return profile;
  return PROFILE_ALIASES[profile];
}
