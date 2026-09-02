// Cladding · assurance closure tests.

import {describe, expect, test} from 'vitest';

import {contractClosure, runtimeDependencyClosure, subjectClosure, verificationClosure} from '../../src/assurance/closures.js';

const input = {
  schemaVersion: '0.1' as const,
  features: [{
    id: 'F-a', title: 'Feature', modules: ['src/a.ts'], dependsOn: ['F-b'], baselineIdentity: 'baseline-f',
    criteria: [
      {id: 'AC-a', text: 'Exact legacy text', ears: {condition: 'when x', action: 'shall y'}, scannerState: 'parsed' as const, legacyUnclassified: true, baselineIdentity: 'baseline-a'},
      {id: 'AC-b', text: 'Sibling'},
    ],
  }, {id: 'F-b', title: 'Dependency', modules: ['src/b.ts'], criteria: []}],
  proofInputs: [{address: 'F-a/AC-a', path: 'tests/a.test.ts', sourceBytes: 'test bytes', runnerConfig: {runner: 'vitest'}}],
  receiptIdentities: [{address: 'criterion:F-a/AC-a', identity: 'receipt-a'}, {address: 'criterion:F-a/AC-b', identity: 'receipt-sibling'}],
  runtimeDependencies: [{feature: 'F-a', module: 'src/a.ts', bytes: 'a'}, {feature: 'F-b', module: 'src/b.ts', bytes: 'b'}],
  dependencyComplete: true,
};

describe('F6 closure authority', () => {
  test('seals schema 0.1 and 0.2 closures with selective freshness and explicit missing sentinels', () => {
    const legacy = contractClosure(input, 'F-a');
    expect(JSON.stringify(legacy.records)).toContain('Exact legacy text');
    expect(JSON.stringify(legacy.records)).not.toContain('purpose');
    expect(runtimeDependencyClosure(input, 'F-a').complete).toBe(true);
    expect(runtimeDependencyClosure({...input, runtimeDependencies: input.runtimeDependencies.slice(0, 1)}, 'F-a').complete).toBe(false);
    expect(verificationClosure(input, 'F-a/AC-a').records.map((entry) => entry.address)).toContain('receipt:receipt-a');
  });

  test('does not stale a criterion subject closure for an unrelated sibling criterion', () => {
    const before = subjectClosure(input, 'F-a/AC-a').sha256;
    const changed = {...input, features: [{...input.features[0], criteria: [input.features[0].criteria[0], {...input.features[0].criteria[1], text: 'Changed sibling'}]}, input.features[1]]};
    expect(subjectClosure(changed, 'F-a/AC-a').sha256).toBe(before);
  });

  test('seals the compiler-adapted migration receipt scalar into every schema-0.2 contract closure', () => {
    const schema02 = {
      schemaVersion: '0.2' as const,
      features: [{id: 'F-a', title: 'Feature', purpose: 'Seal receipt authority.', criteria: []}],
      migrationBaselineReceiptSha256: 'a'.repeat(64),
    };
    const before = contractClosure(schema02, 'F-a');
    const changed = contractClosure({...schema02, migrationBaselineReceiptSha256: 'b'.repeat(64)}, 'F-a');
    const absent = contractClosure({...schema02, migrationBaselineReceiptSha256: null}, 'F-a');
    expect(before.records).toContainEqual({address: 'migration_baseline:receipt', value: 'a'.repeat(64)});
    expect(before.sha256).not.toBe(changed.sha256);
    expect(absent.records).toContainEqual({address: 'migration_baseline:receipt', value: null});
  });

  test('seals reviewed whole-file test inputs and makes a byte-mismatched carry-forward incomplete', () => {
    const reviewed = {
      ...input,
      proofInputs: [{
        address: 'F-a/AC-a', path: 'tests/reviewed.test.ts', selector: 'historic case',
        sourceBytes: 'reviewed bytes', bindingState: 'available' as const,
        expectedBindingSha256: 'a'.repeat(64), bindingProvenance: 'reviewed_carry_forward' as const, runnerConfig: {runner: 'vitest'},
      }],
    };
    const available = verificationClosure(reviewed, 'F-a/AC-a');
    const changedBytes = verificationClosure({...reviewed, proofInputs: [{...reviewed.proofInputs[0], sourceBytes: 'changed reviewed bytes'}]}, 'F-a/AC-a');
    const changedExpected = verificationClosure({...reviewed, proofInputs: [{...reviewed.proofInputs[0], expectedBindingSha256: 'b'.repeat(64)}]}, 'F-a/AC-a');
    const stale = verificationClosure({...reviewed, proofInputs: [{...reviewed.proofInputs[0], bindingState: 'stale' as const}]}, 'F-a/AC-a');
    expect(JSON.stringify(available.records)).toContain('reviewed_carry_forward');
    expect(changedBytes.sha256).not.toBe(available.sha256);
    expect(changedExpected.sha256).not.toBe(available.sha256);
    expect(stale.sha256).not.toBe(available.sha256);
    expect(stale.complete).toBe(true);
  });

  test('[covers:F-022/AC-034] missing live proof remains unobserved in verificationClosure', () => {
    const missing = verificationClosure({...input, proofInputs: []}, 'F-a/AC-a');
    expect(missing.complete).toBe(true);
    expect(missing.records).toContainEqual({address: 'missing:proof:F-a/AC-a', value: '<missing>'});
    expect(missing.records).not.toContainEqual(expect.objectContaining({value: 'green'}));

    const stale = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], bindingState: 'stale' as const, sourceBytes: undefined,
    }]}, 'F-a/AC-a');
    expect(stale.complete).toBe(true);
    expect(JSON.stringify(stale.records)).toContain('<missing-source>');

    const pathOnly = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], selector: undefined, bindingState: 'available' as const,
      runnerConfig: {complete: true},
    }]}, 'F-a/AC-a');
    expect(pathOnly.complete).toBe(true);

    const unreadable = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], sourceBytes: undefined,
    }]}, 'F-a/AC-a');
    const unsafe = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], bindingState: 'unsafe' as const,
    }]}, 'F-a/AC-a');
    expect(unreadable.complete).toBe(false);
    expect(unsafe.complete).toBe(false);
  });

  test('[covers:F-6f0a2106/AC-6f0a2112] an unresolved oracle or evidence declaration seals a negative fact instead of an unknown', () => {
    // An authored declaration resolves through its own channel, so the closure
    // reads the very same bytes for `source` and for the channel record.
    const unresolvedOracle = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], path: 'script:missing', sourceBytes: undefined,
      oracle: {declaration: 'script:missing'},
    }]}, 'F-a/AC-a');
    const unresolvedEvidence = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], path: 'self-dogfood:stage:commit-postcommit', sourceBytes: undefined,
      evidence: {declaration: 'self-dogfood:stage:commit-postcommit'},
    }]}, 'F-a/AC-a');

    expect(unresolvedOracle.complete).toBe(true);
    expect(unresolvedEvidence.complete).toBe(true);
    expect(JSON.stringify(unresolvedOracle.records)).toContain('<missing-oracle>');
    expect(JSON.stringify(unresolvedOracle.records)).toContain('<missing-source>');
    expect(JSON.stringify(unresolvedEvidence.records)).toContain('<missing-evidence>');
    expect(JSON.stringify(unresolvedEvidence.records)).toContain('<missing-source>');

    // The sentinel is a digest input, so the seal still moves the moment the
    // declared target appears.
    const resolvedEvidence = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], path: 'self-dogfood:stage:commit-postcommit', sourceBytes: 'declared bytes',
      evidence: {declaration: 'self-dogfood:stage:commit-postcommit', resolvedBytes: 'declared bytes'},
    }]}, 'F-a/AC-a');
    expect(resolvedEvidence.sha256).not.toBe(unresolvedEvidence.sha256);

    // A live test binding still owes readable source, and an unsafe binding
    // stays unenumerable through either channel.
    const unreadableLive = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], sourceBytes: undefined,
    }]}, 'F-a/AC-a');
    const unsafeEvidence = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], sourceBytes: undefined, bindingState: 'unsafe' as const,
      evidence: {declaration: 'self-dogfood:stage:commit-postcommit'},
    }]}, 'F-a/AC-a');
    const unknownRunner = verificationClosure({...input, proofInputs: [{
      ...input.proofInputs[0], sourceBytes: undefined, runnerConfig: {complete: false},
      evidence: {declaration: 'self-dogfood:stage:commit-postcommit'},
    }]}, 'F-a/AC-a');
    expect(unreadableLive.complete).toBe(false);
    expect(unsafeEvidence.complete).toBe(false);
    expect(unknownRunner.complete).toBe(false);
  });

  test('hashes exact required scenario intent for every referenced criterion while excluding off advisory and unrelated scenarios', () => {
    const schema02 = {
      schemaVersion: '0.2' as const,
      features: [
        {
          id: 'F-a', title: 'Feature A', purpose: 'Keep closure scope exact.',
          criteria: [
            {id: 'AC-a', kind: 'behavior', statement: 'The system shall bind required scenarios.'},
            {id: 'AC-b', kind: 'behavior', statement: 'The system shall retain every referenced criterion.'},
          ],
        },
        {id: 'F-b', title: 'Feature B', purpose: 'Keep unrelated scenario scope out.', criteria: [{id: 'AC-c', kind: 'behavior', statement: 'The system shall exclude unrelated scenario intent.'}]},
      ],
      architectureRules: [{from: 'core', to: 'core'}],
      scenarios: [{
        id: 'S-a',
        // The closure boundary receives compiler-normalized applicability and
        // intent. Title is retained as a negative control: D09/D13 require
        // only identity plus actor, goal, success, and ordered steps to seal.
        features: ['F-a'],
        intent: {
          title: 'Verify scenario seals', actor: 'maintainer', goal: 'verify closure scope',
          success: 'the current criteria are sealed', steps: ['open the feature', 'inspect the receipt'],
        },
      }],
      scenarioPolicy: 'required' as const,
    };
    const requiredContract = contractClosure(schema02, 'F-a');
    const requiredA = subjectClosure(schema02, 'F-a/AC-a');
    const requiredB = subjectClosure(schema02, 'F-a/AC-b');
    const unrelatedBefore = subjectClosure(schema02, 'F-b/AC-c');
    expect(requiredContract.records).toEqual(expect.arrayContaining([
      expect.objectContaining({
        address: 'scenario:S-a',
        value: {
          id: 'S-a',
          intent: {
            actor: 'maintainer', goal: 'verify closure scope', success: 'the current criteria are sealed',
            steps: ['open the feature', 'inspect the receipt'],
          },
        },
      }),
    ]));
    expect(requiredA.records.map((record) => record.address)).toContain('scenario:S-a');
    expect(requiredB.records.map((record) => record.address)).toContain('scenario:S-a');

    const changedIntents = [
      {actor: 'reviewer'},
      {goal: 'confirm closure scope'},
      {success: 'the verified criteria are sealed'},
      {steps: ['open the feature', 'inspect the receipt', 'record the review']},
    ] as const;
    for (const change of changedIntents) {
      const changedIntent = {
        ...schema02,
        scenarios: [{...schema02.scenarios[0], intent: {...schema02.scenarios[0].intent, ...change}}],
      };
      expect(contractClosure(changedIntent, 'F-a').sha256).not.toBe(requiredContract.sha256);
      expect(subjectClosure(changedIntent, 'F-a/AC-a').sha256).not.toBe(requiredA.sha256);
      expect(subjectClosure(changedIntent, 'F-a/AC-b').sha256).not.toBe(requiredB.sha256);
      expect(subjectClosure(changedIntent, 'F-b/AC-c').sha256).toBe(unrelatedBefore.sha256);
    }

    const changedIntent = {
      ...schema02,
      scenarios: [{
        ...schema02.scenarios[0],
        intent: {...schema02.scenarios[0].intent, steps: ['open the feature', 'inspect the receipt', 'record the review']},
      }],
    };
    const retitled = {
      ...schema02,
      scenarios: [{...schema02.scenarios[0], intent: {...schema02.scenarios[0].intent, title: 'A relabeled scenario'}}],
    };
    expect(contractClosure(retitled, 'F-a').sha256).toBe(requiredContract.sha256);
    expect(subjectClosure(retitled, 'F-a/AC-a').sha256).toBe(requiredA.sha256);

    const movedReference = {...schema02, scenarios: [{...schema02.scenarios[0], features: ['F-b']}]};
    expect(subjectClosure(movedReference, 'F-a/AC-a').sha256).not.toBe(requiredA.sha256);
    expect(subjectClosure(movedReference, 'F-b/AC-c').sha256).not.toBe(unrelatedBefore.sha256);

    const unrelatedScenario = {
      ...schema02,
      scenarios: [...schema02.scenarios, {
        id: 'S-b', features: ['F-b'],
        intent: {
          title: 'Unrelated scenario', actor: 'operator', goal: 'inspect another feature',
          success: 'the other feature is sealed', steps: ['open feature B'],
        },
      }],
    };
    expect(contractClosure(unrelatedScenario, 'F-a').sha256).toBe(requiredContract.sha256);
    expect(subjectClosure(unrelatedScenario, 'F-a/AC-a').sha256).toBe(requiredA.sha256);

    for (const policy of ['off', 'advisory'] as const) {
      const before = {...schema02, scenarioPolicy: policy};
      const after = {...changedIntent, scenarioPolicy: policy};
      expect(contractClosure(after, 'F-a').sha256).toBe(contractClosure(before, 'F-a').sha256);
      expect(subjectClosure(after, 'F-a/AC-a').sha256).toBe(subjectClosure(before, 'F-a/AC-a').sha256);
    }
  });

  test('fans shared prerequisites into each runtime closure and retains missing and unknown sentinels', () => {
    const graph = {
      schemaVersion: '0.2' as const,
      features: [
        {id: 'F-a', title: 'A', modules: ['src/a.ts'], dependsOn: ['F-shared'], criteria: []},
        {id: 'F-b', title: 'B', modules: ['src/b.ts'], dependsOn: ['F-shared'], criteria: []},
        {id: 'F-shared', title: 'Shared', modules: ['src/shared.ts'], criteria: []},
      ],
      runtimeDependencies: [
        {feature: 'F-a', module: 'src/a.ts', bytes: 'a'},
        {feature: 'F-b', module: 'src/b.ts', bytes: 'b'},
        {feature: 'F-shared', module: 'src/shared.ts', state: 'unknown' as const},
      ],
      dependencyComplete: true,
    };
    const a = runtimeDependencyClosure(graph, 'F-a');
    const b = runtimeDependencyClosure(graph, 'F-b');
    expect(a.complete).toBe(false);
    expect(b.complete).toBe(false);
    expect(a.records.map((record) => record.address)).toContain('runtime:F-shared:src/shared.ts');
    expect(b.records.map((record) => record.address)).toContain('runtime:F-shared:src/shared.ts');
    const missing = runtimeDependencyClosure({...graph, runtimeDependencies: graph.runtimeDependencies.slice(0, 2)}, 'F-a');
    expect(JSON.stringify(missing.records)).toContain('<unknown-runtime-input>');
  });

  test('keeps trailing runtime-directory spelling as authored closure identity', () => {
    const directory = {
      schemaVersion: '0.2' as const,
      features: [{id: 'F-directory', title: 'Directory', modules: ['src/runtime'], criteria: []}],
      runtimeDependencies: [{feature: 'F-directory', module: 'src/runtime', bytes: 'recursive directory bytes'}],
      dependencyComplete: true,
    };
    const trailing = {
      ...directory,
      features: [{...directory.features[0], modules: ['src/runtime/']}],
      runtimeDependencies: [{feature: 'F-directory', module: 'src/runtime/', bytes: 'recursive directory bytes'}],
    };
    const withoutSeparator = runtimeDependencyClosure(directory, 'F-directory');
    const withSeparator = runtimeDependencyClosure(trailing, 'F-directory');
    expect(withoutSeparator.complete).toBe(true);
    expect(withSeparator.complete).toBe(true);
    expect(withoutSeparator.records.map((record) => record.address)).toContain('runtime:F-directory:src/runtime');
    expect(withSeparator.records.map((record) => record.address)).toContain('runtime:F-directory:src/runtime/');
    expect(withSeparator.sha256).not.toBe(withoutSeparator.sha256);
  });
});
