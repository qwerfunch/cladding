import {describe, test, expect} from 'vitest';
import {
	buildReverseIndex,
	reverseIndexOf,
	type ReverseIndex,
} from '../../src/spec/reverse-index.js';
import type {Spec} from '../../src/spec/types.js';

type FixtureFeature = {
	id: string;
	title: string;
	status: 'done';
	depends_on?: string[];
	modules?: string[];
	acceptance_criteria?: {id: string; test_refs?: string[]}[];
};

function mkSpec(features: FixtureFeature[]): Spec {
	return {
		schema: '0.1',
		project: {name: 'x', language: 'typescript'},
		features,
	} as unknown as Spec;
}

describe('reverse-index (F-ee47fc2b)', () => {
	test('inverts depends_on into a direct-dependents map', () => {
		const spec = mkSpec([
			{id: 'A', title: 'A', status: 'done'},
			{id: 'B', title: 'B', status: 'done', depends_on: ['A']},
			{id: 'C', title: 'C', status: 'done', depends_on: ['A']},
		]);

		const index: ReverseIndex = buildReverseIndex(spec);

		const depsOfA = index.dependents.get('A');
		expect(depsOfA).toBeDefined();
		expect([...depsOfA!].sort()).toEqual(['B', 'C']);

		// Nothing depends on B.
		expect(index.dependents.get('B')).toBeUndefined();

		// Only DIRECT (one-hop) edges: with a chain C -> B -> A,
		// dependents.get('A') must contain B only, NOT C.
		const chainSpec = mkSpec([
			{id: 'A', title: 'A', status: 'done'},
			{id: 'B', title: 'B', status: 'done', depends_on: ['A']},
			{id: 'C', title: 'C', status: 'done', depends_on: ['B']},
		]);
		const chainIndex = buildReverseIndex(chainSpec);

		const chainDepsOfA = chainIndex.dependents.get('A');
		expect(chainDepsOfA).toBeDefined();
		expect([...chainDepsOfA!].sort()).toEqual(['B']);

		const chainDepsOfB = chainIndex.dependents.get('B');
		expect(chainDepsOfB).toBeDefined();
		expect([...chainDepsOfB!].sort()).toEqual(['C']);
	});

	test('maps each module path to all owning features (many-to-many)', () => {
		const spec = mkSpec([
			{
				id: 'F1',
				title: 'F1',
				status: 'done',
				modules: ['src/a.ts', 'src/shared.ts'],
			},
			{
				id: 'F2',
				title: 'F2',
				status: 'done',
				modules: ['src/shared.ts'],
			},
		]);

		const index = buildReverseIndex(spec);

		const sharedOwners = index.moduleOwners.get('src/shared.ts');
		expect(sharedOwners).toBeDefined();
		expect([...sharedOwners!].sort()).toEqual(['F1', 'F2']);

		const aOwners = index.moduleOwners.get('src/a.ts');
		expect(aOwners).toBeDefined();
		expect([...aOwners!].sort()).toEqual(['F1']);
	});

	test('memoizes per spec instance', () => {
		const spec = mkSpec([
			{id: 'A', title: 'A', status: 'done'},
			{id: 'B', title: 'B', status: 'done', depends_on: ['A']},
		]);

		// Same spec object identity -> SAME reference (memoised).
		expect(reverseIndexOf(spec)).toBe(reverseIndexOf(spec));

		// A DIFFERENT but structurally-equal spec -> DIFFERENT reference.
		const otherSpec = mkSpec([
			{id: 'A', title: 'A', status: 'done'},
			{id: 'B', title: 'B', status: 'done', depends_on: ['A']},
		]);
		expect(reverseIndexOf(otherSpec)).not.toBe(reverseIndexOf(spec));

		// buildReverseIndex is NOT memoised: fresh object every call.
		expect(buildReverseIndex(spec)).not.toBe(buildReverseIndex(spec));
	});

	test('skips prefixed pseudo-refs and strips anchors in test citations', () => {
		const spec = mkSpec([
			{
				id: 'F',
				title: 'F',
				status: 'done',
				acceptance_criteria: [
					{
						id: 'F-ac1',
						test_refs: [
							'tests/x.test.ts#some title',
							'tests/x.test.ts#another title',
							'derived:tests/y.test.ts',
							'fixture:foo',
							'script:build',
						],
					},
				],
			},
		]);

		const index = buildReverseIndex(spec);

		// Anchor stripped; both refs collapse to one key.
		const xCitations = index.testRefCitations.get('tests/x.test.ts');
		expect(xCitations).toBeDefined();
		expect([...xCitations!].sort()).toEqual(['F']);

		// derived: pseudo-ref is skipped entirely (not keyed even after strip).
		expect(index.testRefCitations.has('tests/y.test.ts')).toBe(false);
		expect(index.testRefCitations.has('derived:tests/y.test.ts')).toBe(false);

		// fixture: / script: pseudo-refs skipped (neither prefixed nor bare key).
		expect(index.testRefCitations.has('fixture:foo')).toBe(false);
		expect(index.testRefCitations.has('foo')).toBe(false);
		expect(index.testRefCitations.has('script:build')).toBe(false);
		expect(index.testRefCitations.has('build')).toBe(false);
	});
});
