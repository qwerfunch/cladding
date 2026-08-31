// Cladding · Spec 0.2 F1 · artifact registry contract tests.

import {describe, expect, test} from 'vitest';

import {
  ARTIFACT_DESCRIPTORS,
  renderArtifactRegistryTable,
  renderGeneratedDirectoryNotice,
  resolveArtifactDescriptors,
  resolveManagedWrite,
} from '../../../src/spec/compiler/artifact-registry.js';

describe('Spec 0.2 artifact registry', () => {
  test('keeps descriptor ids unique and root-file regions separate', () => {
    expect(new Set(ARTIFACT_DESCRIPTORS.map((descriptor) => descriptor.id)).size).toBe(ARTIFACT_DESCRIPTORS.length);
    expect(resolveArtifactDescriptors('spec.yaml', 'project').map((descriptor) => descriptor.id)).toEqual(['spec-project-region']);
    expect(resolveArtifactDescriptors('spec.yaml', 'inventory').map((descriptor) => descriptor.id)).toEqual(['spec-inventory-region']);
    expect(resolveArtifactDescriptors('spec.yaml', 'schema').map((descriptor) => descriptor.id)).toEqual(['spec-schema-region']);
    expect(resolveArtifactDescriptors('package.json', 'scripts').map((descriptor) => descriptor.id)).toEqual(['package-scripts-region']);
    expect(resolveArtifactDescriptors('conformance/fixtures.yaml').map((descriptor) => descriptor.id)).toEqual(['conformance-fixture-registry']);
    expect(resolveArtifactDescriptors('docs/design/spec-0.2/proof-and-editing.md').map((descriptor) => descriptor.id)).toEqual(['spec-02-design-document']);
    expect(resolveArtifactDescriptors('docs/project-context.md').map((descriptor) => descriptor.id)).toEqual(['project-context']);
    expect(() => resolveManagedWrite({path: 'spec.yaml', operation: 'update'})).toThrow(/requires an explicit region/);
    expect(() => resolveManagedWrite({path: 'package.json', operation: 'update'})).toThrow(/requires an explicit region/);
    expect(resolveManagedWrite({path: 'spec.yaml', region: 'project', operation: 'update'}).id).toBe('spec-project-region');
    expect(resolveManagedWrite({path: 'spec.yaml', region: 'inventory', operation: 'update'}).id).toBe('spec-inventory-region');
    expect(resolveManagedWrite({path: 'spec.yaml', region: 'schema', operation: 'update'}).id).toBe('spec-schema-region');
    expect(resolveManagedWrite({path: 'package.json', region: 'scripts', operation: 'update'}).id).toBe('package-scripts-region');
    expect(resolveManagedWrite({path: '.cladding/events.log.jsonl', operation: 'update'}).id).toBe('event-ledger');
  });

  test('enforces one managed owner and create-only evidence receipts', () => {
    const receipt = 'spec/evidence/F-182eaa53/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.yaml';
    expect(resolveManagedWrite({path: receipt, operation: 'create'}).id).toBe('evidence-receipt');
    expect(() => resolveManagedWrite({path: receipt, operation: 'update'})).toThrow(/does not permit update/);
    expect(() => resolveManagedWrite({path: 'spec/evidence/F-182eaa53/not-a-digest.yaml', operation: 'create'})).toThrow(/not unique/);
    expect(() => resolveManagedWrite({path: 'src/spec/load.ts', operation: 'update'})).toThrow(/not unique/);
    const baseline = 'spec/generated/migration-baseline-0.1-to-0.2.yaml';
    expect(resolveManagedWrite({path: baseline, operation: 'create'}).id).toBe('migration-baseline');
    expect(() => resolveManagedWrite({path: baseline, operation: 'update'})).toThrow(/does not permit update/);
  });

  test('projects artifact prose and generated-directory notice from registry data', () => {
    const table = renderArtifactRegistryTable();
    const notice = renderGeneratedDirectoryNotice();
    expect(table).toContain('| evidence-receipt | `spec/evidence/<F-id>/<sha256>.yaml` | evidence |');
    expect(notice).toContain('This notice is projected from the executable artifact registry.');
    expect(notice).toContain('`spec/generated/index.yaml` — generated-index; on sync.');
    expect(notice).toContain('`spec/generated/migration-baseline-0.1-to-0.2.yaml` — migration-baseline; one immutable upgrade receipt.');
    expect(table).toContain('| generated-directory-notice | `spec/generated/README.md` | generated | on artifact registry change |');
    expect(notice).toContain('`spec/generated/README.md` — generated-directory-notice; on artifact registry change.');
    expect(ARTIFACT_DESCRIPTORS.find((descriptor) => descriptor.id === 'workspace-audit')).toMatchObject({authority: 'transient'});
  });
});
