// Cladding · Spec 0.2 F11 · generated-artifact layout probe.
//
// Schema 0.2 declares `spec/generated/` as the final home of the three
// generated projections, but 0.10.0 forces no adopter to move: relocation is
// opt-in (`clad relocate-generated`). Every reader and writer therefore asks
// this probe where an artifact actually lives instead of hard-coding a path.
//
// Resolution is per artifact for every artifact that exists:
//   new only  → the relocated path
//   old only  → the pre-relocation path
//   both      → a conflict; writers refuse, readers keep reading the old path
//               while the detectors report the conflict loudly.
//
// An artifact present at neither location has no location of its own, so it
// borrows the layout its siblings prove: when at least one relocatable
// projection exists and every existing one is relocated, an absent projection
// resolves to its relocated path; otherwise — including a workspace where none
// of the three exists — it resolves to its pre-relocation path, so fresh
// workspaces keep the 0.10.0 default layout. Without that rule a relocated
// workspace whose receipt has not been written yet would recreate
// `spec/attestation.yaml` on its first green gate.

import {lstatSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {ARTIFACT_DESCRIPTORS} from './compiler/artifact-registry.js';
import {SpecEditError} from './transaction.js';

/** Logical ids of the three generated projections schema 0.2 relocates. */
export const RELOCATABLE_ARTIFACT_IDS = ['generated-index', 'generated-doc-links', 'generated-attestation'] as const;

/** One relocatable generated projection. */
export type RelocatableArtifactId = (typeof RELOCATABLE_ARTIFACT_IDS)[number];

/** Which of an artifact's two known locations currently hold regular bytes. */
export type GeneratedArtifactPresence = 'old' | 'new' | 'both' | 'none';

/** What occupies a known location that does not hold a regular file. */
export type IrregularEntryKind = 'directory' | 'symlink' | 'other';

/** A known location occupied by something other than a regular file. */
export interface IrregularLocation {
  /** The occupied known location. */
  readonly path: string;
  /** What occupies it. */
  readonly kind: IrregularEntryKind;
}

/** Where one generated projection lives right now. */
export interface GeneratedArtifactLocation {
  /** Registry id of the projection. */
  readonly id: RelocatableArtifactId;
  /** Pre-relocation path — the registry's current path. */
  readonly oldPath: string;
  /** Relocated path — the registry's first compatibility alias. */
  readonly newPath: string;
  /** Which locations hold regular files. */
  readonly presence: GeneratedArtifactPresence;
  /** Resolved location, absent only while the two locations conflict. */
  readonly resolvedPath?: string;
  /** Known locations occupied by something other than a regular file. */
  readonly irregular: readonly IrregularLocation[];
}

/**
 * Reported layout of the whole workspace; never an input to path resolution.
 *
 * The summary reads the resolved location of every projection, so an artifact
 * present at neither path counts under the layout its siblings prove rather
 * than as a layout of its own: `mixed` names a genuine split between existing
 * projections, not a workspace whose receipt has simply not been written yet.
 */
export type GeneratedLayoutState = 'old' | 'new' | 'mixed' | 'conflict';

/** The probe's whole-workspace answer. */
export interface GeneratedArtifactLayout {
  /** Reporting summary of the three projections. */
  readonly state: GeneratedLayoutState;
  /** Every relocatable projection in registry order. */
  readonly artifacts: readonly GeneratedArtifactLocation[];
  /** Projections that exist at the pre-relocation path and can still move. */
  readonly pendingMoves: readonly GeneratedArtifactLocation[];
}

interface RelocatablePaths {
  readonly oldPath: string;
  readonly newPath: string;
}

const RELOCATABLE_PATHS: ReadonlyMap<RelocatableArtifactId, RelocatablePaths> = new Map(
  RELOCATABLE_ARTIFACT_IDS.map((id) => {
    const descriptor = ARTIFACT_DESCRIPTORS.find((candidate) => candidate.id === id);
    if (descriptor === undefined) throw new Error(`relocatable artifact ${id} is missing from the registry`);
    const alias = descriptor.compatibilityAliases[0];
    if (alias === undefined) throw new Error(`relocatable artifact ${id} declares no relocated alias`);
    return [id, {oldPath: descriptor.currentPath, newPath: alias}] as const;
  }),
);

/** Returns the two known locations of a relocatable projection. */
export function relocatableArtifactPaths(id: RelocatableArtifactId): RelocatablePaths {
  return RELOCATABLE_PATHS.get(id)!;
}

/** Reports what currently occupies a known location. */
function probe(cwd: string, path: string): 'file' | 'absent' | IrregularEntryKind {
  try {
    const stat = lstatSync(join(cwd, path));
    if (stat.isSymbolicLink()) return 'symlink';
    if (stat.isDirectory()) return 'directory';
    return stat.isFile() ? 'file' : 'other';
  } catch {
    return 'absent';
  }
}

/** One artifact's two probes, taken in a single sweep of the workspace. */
interface ArtifactProbe {
  readonly id: RelocatableArtifactId;
  readonly oldPath: string;
  readonly newPath: string;
  readonly presence: GeneratedArtifactPresence;
  readonly irregular: readonly IrregularLocation[];
}

/** Probes all three projections at once so their answers stay consistent. */
function probeAll(root: string): readonly ArtifactProbe[] {
  return RELOCATABLE_ARTIFACT_IDS.map((id) => {
    const {oldPath, newPath} = relocatableArtifactPaths(id);
    const oldProbe = probe(root, oldPath);
    const newProbe = probe(root, newPath);
    const irregular = [
      ...(oldProbe === 'file' || oldProbe === 'absent' ? [] : [{path: oldPath, kind: oldProbe}]),
      ...(newProbe === 'file' || newProbe === 'absent' ? [] : [{path: newPath, kind: newProbe}]),
    ];
    const presence: GeneratedArtifactPresence = oldProbe === 'file' && newProbe === 'file'
      ? 'both'
      : newProbe === 'file'
        ? 'new'
        : oldProbe === 'file'
          ? 'old'
          : 'none';
    return {id, oldPath, newPath, presence, irregular};
  });
}

/**
 * Decides which layout an artifact present at neither location belongs to.
 *
 * The workspace's own projections are the only evidence: a relocated sibling
 * proves the adopter has moved, and nothing at all proves nothing.
 */
function absentArtifactLayout(probes: readonly ArtifactProbe[]): 'old' | 'new' {
  const existing = probes.filter((entry) => entry.presence !== 'none');
  return existing.length > 0 && existing.every((entry) => entry.presence === 'new') ? 'new' : 'old';
}

/** Turns one probe into the location a reader or writer consults. */
function locate(entry: ArtifactProbe, absentLayout: 'old' | 'new'): GeneratedArtifactLocation {
  const resolvedPath = entry.presence === 'both'
    ? undefined
    : entry.presence === 'new' || (entry.presence === 'none' && absentLayout === 'new')
      ? entry.newPath
      : entry.oldPath;
  return {
    id: entry.id,
    oldPath: entry.oldPath,
    newPath: entry.newPath,
    presence: entry.presence,
    ...(resolvedPath === undefined ? {} : {resolvedPath}),
    irregular: entry.irregular,
  };
}

/**
 * Resolves one generated projection without ever throwing.
 *
 * Readers use this: a SessionStart card or a drift detector must degrade into
 * information, never a stack trace, when a workspace is mid-relocation.
 *
 * @param cwd - Workspace root.
 * @param id - Relocatable projection to locate.
 * @returns Its two known locations, their presence, and the resolved path.
 * @see spec/features/spec-02-relocate-generated-0dafcf9d.yaml AC-60f36f9c
 * @since 0.10.0
 */
export function resolveGeneratedArtifact(cwd: string, id: RelocatableArtifactId): GeneratedArtifactLocation {
  const probes = probeAll(resolve(cwd));
  const absentLayout = absentArtifactLayout(probes);
  return locate(probes.find((entry) => entry.id === id)!, absentLayout);
}

/**
 * Resolves the path a reader should consult for one generated projection.
 *
 * A conflict keeps the pre-relocation path readable so no reader crashes; the
 * inventory-drift and stale-attestation detectors report the conflict.
 */
export function generatedArtifactReadPath(cwd: string, id: RelocatableArtifactId): string {
  const location = resolveGeneratedArtifact(cwd, id);
  return location.resolvedPath ?? location.oldPath;
}

/**
 * Resolves the path a writer must use for one generated projection.
 *
 * @throws SpecEditError when both known locations hold bytes, or when one of
 *     them is occupied by something other than a regular file.
 * @see spec/features/spec-02-relocate-generated-0dafcf9d.yaml AC-e45228ec
 * @since 0.10.0
 */
export function generatedArtifactPath(cwd: string, id: RelocatableArtifactId): string {
  const location = resolveGeneratedArtifact(cwd, id);
  if (location.irregular.length > 0) {
    throw new SpecEditError(
      'INVALID_OPERATION',
      `A generated projection may not be a directory or a symbolic link: ${renderIrregular(location.irregular)}.`,
    );
  }
  if (location.resolvedPath === undefined) {
    throw new SpecEditError(
      'INVALID_OPERATION',
      `${location.id} exists at both ${location.oldPath} and ${location.newPath}; remove one copy before writing (see \`clad relocate-generated\`).`,
    );
  }
  return location.resolvedPath;
}

/** Names each obstructed location together with what occupies it. */
export function renderIrregular(entries: readonly IrregularLocation[]): string {
  return entries.map((entry) => `${entry.path} (${entry.kind})`).join(', ');
}

/**
 * Probes where all three generated projections currently live.
 *
 * @param cwd - Workspace root.
 * @returns Per-artifact locations plus a reporting-only workspace state.
 * @see spec/features/spec-02-relocate-generated-0dafcf9d.yaml AC-d119310e
 * @since 0.10.0
 */
export function generatedArtifactLayout(cwd: string): GeneratedArtifactLayout {
  const probes = probeAll(resolve(cwd));
  const absentLayout = absentArtifactLayout(probes);
  const artifacts = probes.map((entry) => locate(entry, absentLayout));
  // The summary is derived from resolved locations, so an absent projection is
  // attributed to the layout its siblings prove instead of counting as `old`.
  const relocated = artifacts.filter((artifact) => artifact.resolvedPath === artifact.newPath).length;
  const state: GeneratedLayoutState = artifacts.some((artifact) => artifact.presence === 'both')
    ? 'conflict'
    : relocated === artifacts.length
      ? 'new'
      : relocated === 0
        ? 'old'
        : 'mixed';
  return {state, artifacts, pendingMoves: artifacts.filter((artifact) => artifact.presence === 'old')};
}

/**
 * Maps each generated artifact id to the path a projection should name.
 *
 * The generated-directory notice renders from this map alone, so the bytes it
 * produces depend on nothing but where the projections live.
 */
export function generatedArtifactPathMap(layout: GeneratedArtifactLayout): ReadonlyMap<string, string> {
  return new Map(layout.artifacts.map((artifact) => [artifact.id, artifact.resolvedPath ?? artifact.oldPath]));
}

/**
 * Builds the map a probe would return once every pending move has been made.
 *
 * Relocation leaves every present projection at its relocated path, so an
 * absent projection borrows that same layout — unless the workspace holds none
 * of the three, where nothing has moved and the pre-relocation path stands.
 * The notice therefore matches a post-move probe byte for byte and a second
 * apply stays a zero-diff no-op.
 */
export function postRelocationArtifactPathMap(layout: GeneratedArtifactLayout): ReadonlyMap<string, string> {
  const anyPresent = layout.artifacts.some((artifact) => artifact.presence !== 'none');
  return new Map(layout.artifacts.map((artifact) => [
    artifact.id as string,
    artifact.presence === 'none' && !anyPresent ? artifact.oldPath : artifact.newPath,
  ]));
}
