// Cladding · Spec 0.2 F11 · generated-artifact layout probe.

import {mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {afterEach, describe, expect, test} from 'vitest';

import {
  generatedArtifactLayout,
  generatedArtifactPath,
  generatedArtifactReadPath,
  postRelocationArtifactPathMap,
  relocatableArtifactPaths,
  resolveGeneratedArtifact,
  RELOCATABLE_ARTIFACT_IDS,
} from '../../src/spec/layout.js';

const temporary: string[] = [];

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'clad-layout-'));
  temporary.push(root);
  mkdirSync(join(root, 'spec', 'generated'), {recursive: true});
  return root;
}

function seed(root: string, path: string, bytes = 'features: {}\n'): void {
  mkdirSync(join(root, path, '..'), {recursive: true});
  writeFileSync(join(root, path), bytes);
}

afterEach(() => {
  for (const root of temporary.splice(0)) rmSync(root, {recursive: true, force: true});
});

describe('generated-artifact layout probe', () => {
  test('[covers:F-0dafcf9d/AC-60f36f9c] resolves a projection present only at its pre-relocation path to that path', () => {
    const root = workspace();
    seed(root, 'spec/index.yaml');
    const location = resolveGeneratedArtifact(root, 'generated-index');
    expect(location.presence).toBe('old');
    expect(location.resolvedPath).toBe('spec/index.yaml');
    expect(generatedArtifactPath(root, 'generated-index')).toBe('spec/index.yaml');
    expect(generatedArtifactLayout(root).state).toBe('old');
  });

  test('[covers:F-0dafcf9d/AC-60f36f9c] resolves a projection absent from both known paths to its pre-relocation path', () => {
    const root = workspace();
    for (const id of RELOCATABLE_ARTIFACT_IDS) {
      const location = resolveGeneratedArtifact(root, id);
      expect(location.presence).toBe('none');
      expect(location.resolvedPath).toBe(relocatableArtifactPaths(id).oldPath);
      expect(generatedArtifactReadPath(root, id)).toBe(relocatableArtifactPaths(id).oldPath);
    }
    const layout = generatedArtifactLayout(root);
    expect(layout.state).toBe('old');
    expect(layout.pendingMoves).toHaveLength(0);
  });

  test('[covers:F-0dafcf9d/AC-d119310e] resolves a projection present only under the generated directory to its relocated path', () => {
    const root = workspace();
    seed(root, 'spec/generated/index.yaml');
    seed(root, 'spec/generated/attestation.yaml', 'features: {}\n');
    seed(root, 'spec/generated/_doc-links.yaml', 'documents: {}\n');
    for (const id of RELOCATABLE_ARTIFACT_IDS) {
      expect(resolveGeneratedArtifact(root, id).presence).toBe('new');
      expect(generatedArtifactPath(root, id)).toBe(relocatableArtifactPaths(id).newPath);
      expect(generatedArtifactReadPath(root, id)).toBe(relocatableArtifactPaths(id).newPath);
    }
    expect(generatedArtifactLayout(root).state).toBe('new');
  });

  test('[covers:F-0dafcf9d/AC-d119310e] reports a mixed workspace per artifact instead of one workspace-wide verdict', () => {
    const root = workspace();
    seed(root, 'spec/index.yaml');
    seed(root, 'spec/generated/attestation.yaml');
    const layout = generatedArtifactLayout(root);
    expect(layout.state).toBe('mixed');
    expect(generatedArtifactPath(root, 'generated-index')).toBe('spec/index.yaml');
    expect(generatedArtifactPath(root, 'generated-attestation')).toBe('spec/generated/attestation.yaml');
    expect(layout.pendingMoves.map((artifact) => artifact.id)).toEqual(['generated-index']);
  });

  test('[covers:F-0dafcf9d/AC-e45228ec] refuses to resolve a writer path while both known locations hold the projection', () => {
    const root = workspace();
    seed(root, 'spec/index.yaml');
    seed(root, 'spec/generated/index.yaml');
    const location = resolveGeneratedArtifact(root, 'generated-index');
    expect(location.presence).toBe('both');
    expect(location.resolvedPath).toBeUndefined();
    expect(() => generatedArtifactPath(root, 'generated-index')).toThrow(/both/);
    expect(generatedArtifactLayout(root).state).toBe('conflict');
    // A reader still degrades into information rather than a crash.
    expect(generatedArtifactReadPath(root, 'generated-index')).toBe('spec/index.yaml');
  });

  test('[covers:F-0dafcf9d/AC-e45228ec] treats a directory or symbolic link at a known location as a diagnosed obstruction', () => {
    const root = workspace();
    mkdirSync(join(root, 'spec', 'index.yaml'));
    expect(resolveGeneratedArtifact(root, 'generated-index').irregular).toEqual([{path: 'spec/index.yaml', kind: 'directory'}]);
    expect(() => generatedArtifactPath(root, 'generated-index')).toThrow(/directory or a symbolic link/);

    const linked = workspace();
    seed(linked, 'spec/other.yaml');
    symlinkSync(join(linked, 'spec', 'other.yaml'), join(linked, 'spec', 'generated', 'index.yaml'));
    expect(resolveGeneratedArtifact(linked, 'generated-index').irregular).toEqual([{path: 'spec/generated/index.yaml', kind: 'symlink'}]);
    expect(() => generatedArtifactPath(linked, 'generated-index')).toThrow(/directory or a symbolic link/);
  });

  test('[covers:F-0dafcf9d/AC-0d45a5c2] projects the post-move path map so an absent projection follows its relocated siblings', () => {
    const root = workspace();
    seed(root, 'spec/index.yaml');
    const map = postRelocationArtifactPathMap(generatedArtifactLayout(root));
    expect(map.get('generated-index')).toBe('spec/generated/index.yaml');
    // Once the index has moved, nothing in the workspace is unrelocated, so the
    // absent receipt is projected at its relocated path and the notice a second
    // apply renders is byte-identical.
    expect(map.get('generated-attestation')).toBe('spec/generated/attestation.yaml');

    // A workspace holding none of the three has moved nothing at all.
    const empty = workspace();
    const emptyMap = postRelocationArtifactPathMap(generatedArtifactLayout(empty));
    expect(emptyMap.get('generated-attestation')).toBe('spec/attestation.yaml');
  });

  test('[covers:F-0dafcf9d/AC-60f36f9c] resolves an absent projection to its relocated path when every projection that exists is relocated', () => {
    const root = workspace();
    seed(root, 'spec/generated/index.yaml');
    seed(root, 'spec/generated/_doc-links.yaml', 'documents: {}\n');
    const location = resolveGeneratedArtifact(root, 'generated-attestation');
    expect(location.presence).toBe('none');
    expect(location.resolvedPath).toBe('spec/generated/attestation.yaml');
    expect(generatedArtifactReadPath(root, 'generated-attestation')).toBe('spec/generated/attestation.yaml');
    expect(generatedArtifactPath(root, 'generated-attestation')).toBe('spec/generated/attestation.yaml');
    // The absent receipt follows its relocated siblings, so the workspace reads
    // as relocated rather than as a split between two layouts.
    expect(generatedArtifactLayout(root).state).toBe('new');
  });

  test('[covers:F-0dafcf9d/AC-60f36f9c] keeps an absent projection on its pre-relocation path while a sibling is still unrelocated', () => {
    const root = workspace();
    seed(root, 'spec/generated/index.yaml');
    seed(root, 'spec/_doc-links.yaml', 'documents: {}\n');
    const location = resolveGeneratedArtifact(root, 'generated-attestation');
    expect(location.presence).toBe('none');
    expect(location.resolvedPath).toBe('spec/attestation.yaml');
    expect(generatedArtifactReadPath(root, 'generated-attestation')).toBe('spec/attestation.yaml');
    expect(generatedArtifactPath(root, 'generated-attestation')).toBe('spec/attestation.yaml');
    // Two existing projections genuinely disagree, so the summary says so.
    expect(generatedArtifactLayout(root).state).toBe('mixed');
  });
});
