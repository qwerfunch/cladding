// Cladding · impl-blind oracle for F-87bb7ed3 — authored from the spec contract only.
//
// Contract under test (given, not read from source):
//   import {unmappedArtifact} from '../../src/stages/detectors/unmapped-artifact.js';
//   const findings = unmappedArtifact.run({cwd});
//   finding: {detector: 'UNMAPPED_ARTIFACT', severity: 'error', message: string, path?: string}
//   one finding per source file in the scan universe not claimed by any features[].modules
//
// Evidence-derived universe (active only when features.length >= 8 AND architecture
// layers are declared — the legacy narrow scan is out of scope here):
//   · extensions = (known-language extensions OBSERVED anywhere in the tree)
//                  ∪ (extensions of modules CLAIMED under a root/layer path)
//   · unknown-to-vocabulary extensions (.zig …) enter ONLY by being claimed
//   · scan roots are inferred from claimed module paths: the segments BEFORE the
//     layer segment (src/main/kotlin/core/A.kt + layer 'core' → root src/main/kotlin);
//     with no teaching module the root is 'src'
//   · files scanned: <root>/<layer>/**/*<ext>; a file claimed by ANY feature is never
//     reported; spec.project.language has NO effect on the universe
//
// Fixture notes (scaffolding only — no expectation is derived from the implementation):
//   · feature ids must satisfy the spec schema's ^F-(\d{3,}|[a-f0-9]{6,})$, so the
//     padding features use hash-shaped ids rather than the brief's shorthand F-1.
//   · architecture.layers is written as the brief renders it: each entry is a sequence
//     of layer names (a tier), so layers [core, app] is `- - core` / `  - app`.
//   · a .ts control tree was used to confirm these fixtures actually reach the scan, so
//     a zero-finding result below is a behavioural gap, not a dead fixture.
//
// Severity note: the declared severity ('error') is asserted in its own dedicated case
// rather than inside the shared shape helper, so a single deviation there cannot mask
// the eight universe verdicts. It is asserted, unweakened.

import {afterAll, describe, expect, it} from 'vitest';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';

import {unmappedArtifact} from '../../src/stages/detectors/unmapped-artifact.js';

type Finding = {
	detector: string;
	severity: string;
	message: string;
	path?: string;
};

type Fixture = {
	/** spec.project.language — declared, and per contract inert for the universe. */
	language: string;
	/** architecture.layers — one layer name per entry. */
	layers: string[];
	/** modules[] per feature; padded to nine features with empty-module entries. */
	claims: string[][];
	/** source files to materialise, repo-relative. */
	files: string[];
};

const scratch: string[] = [];

afterAll(() => {
	for (const dir of scratch) rmSync(dir, {recursive: true, force: true});
});

/** architecture.layers block: one tier holding every layer name. */
function layerBlock(names: string[]): string[] {
	return names.map((name, index) => (index === 0 ? `    - - ${name}` : `      - ${name}`));
}

function makeFixture(fixture: Fixture): string {
	const dir = mkdtempSync(join(tmpdir(), 'clad-unmapped-universe-'));
	scratch.push(dir);
	mkdirSync(join(dir, 'spec', 'features'), {recursive: true});

	const featureCount = Math.max(9, fixture.claims.length);
	const featureBlocks: string[] = [];
	for (let i = 0; i < featureCount; i++) {
		const modules = fixture.claims[i] ?? [];
		const id = `F-a${String(i + 1).padStart(7, '0')}`;
		const lines = [`  - id: ${id}`, '    title: t', '    status: done'];
		if (modules.length === 0) {
			lines.push('    modules: []');
		} else {
			lines.push('    modules:');
			for (const module of modules) lines.push(`      - "${module}"`);
		}
		featureBlocks.push(lines.join('\n'));
	}

	const yaml = [
		'schema: "0.1"',
		'project:',
		'  name: x',
		`  language: ${fixture.language}`,
		'architecture:',
		'  layers:',
		...layerBlock(fixture.layers),
		'features:',
		...featureBlocks,
		'',
	].join('\n');
	writeFileSync(join(dir, 'spec.yaml'), yaml, 'utf8');

	for (const rel of fixture.files) {
		const abs = join(dir, rel);
		mkdirSync(dirname(abs), {recursive: true});
		writeFileSync(abs, '// x\n', 'utf8');
	}

	return dir;
}

/** Runs the detector and enforces the declared finding identity on every finding. */
function scan(fixture: Fixture): Finding[] {
	const findings = unmappedArtifact.run({cwd: makeFixture(fixture)}) as Finding[];
	expect(Array.isArray(findings)).toBe(true);
	for (const finding of findings) {
		expect(finding.detector).toBe('UNMAPPED_ARTIFACT');
		expect(typeof finding.message).toBe('string');
		expect(finding.message.length).toBeGreaterThan(0);
	}
	return findings;
}

/** Sorted, separator-normalised path set of the findings. */
function reported(findings: Finding[]): string[] {
	return findings
		.map(finding => (finding.path ?? '').replace(/\\/g, '/').replace(/^\.\//, ''))
		.sort();
}

/** The findings' own messages, echoed as failure context. */
function said(findings: Finding[]): string {
	if (findings.length === 0) return 'detector reported no findings';
	return findings.map(finding => `[${finding.severity}] ${finding.message}`).join(' || ');
}

function expectExactly(findings: Finding[], expected: string[]): void {
	expect(reported(findings), said(findings)).toEqual([...expected].sort());
}

const CASE_1_TREE = {
	layers: ['core'],
	claims: [['src/core/rasp.cpp']],
	files: ['src/core/rasp.cpp', 'src/core/extra.cpp', 'src/core/util.h'],
} as const;

function caseOneFixture(language: string): Fixture {
	return {
		language,
		layers: [...CASE_1_TREE.layers],
		claims: CASE_1_TREE.claims.map(modules => [...modules]),
		files: [...CASE_1_TREE.files],
	};
}

describe('UNMAPPED_ARTIFACT · evidence-derived scan universe (F-87bb7ed3)', () => {
	it('reports native sources the spec never claims (cpp tree, was vacuous)', () => {
		const findings = scan(caseOneFixture('cpp'));

		expectExactly(findings, ['src/core/extra.cpp', 'src/core/util.h']);
		expect(reported(findings)).toEqual(
			expect.arrayContaining(['src/core/extra.cpp', 'src/core/util.h']),
		);
		expect(reported(findings)).not.toContain('src/core/rasp.cpp');
	});

	it('still sees native sources when every claimed module is another language', () => {
		const findings = scan({
			language: 'cpp',
			layers: ['core', 'app'],
			claims: [['src/core/Main.java', 'src/app/App.java']],
			files: [
				'src/core/Main.java',
				'src/app/App.java',
				'src/core/a.cpp',
				'src/core/b.cpp',
			],
		});

		// .cpp is a known-language extension observed in the tree, so it is in the
		// universe even though no module ever claims a .cpp file.
		expectExactly(findings, ['src/core/a.cpp', 'src/core/b.cpp']);
	});

	it('lets a claimed module teach an extension unknown to the vocabulary', () => {
		const findings = scan({
			language: 'zig',
			layers: ['core'],
			claims: [['src/core/a.zig']],
			files: ['src/core/a.zig', 'src/core/b.zig'],
		});

		expectExactly(findings, ['src/core/b.zig']);
	});

	it('keeps an untaught unknown extension out of the universe', () => {
		const findings = scan({
			language: 'zig',
			layers: ['core'],
			claims: [['src/core/a.ts']],
			files: ['src/core/a.ts', 'src/core/b.zig', 'src/core/c.ts'],
		});

		// .zig is neither observed-known nor claimed → invisible; .ts enters as both.
		expectExactly(findings, ['src/core/c.ts']);
		expect(reported(findings)).not.toContain('src/core/b.zig');
	});

	it('infers the scan root from the claimed module path (kotlin layout)', () => {
		const findings = scan({
			language: 'kotlin',
			layers: ['core'],
			claims: [['src/main/kotlin/core/A.kt']],
			files: ['src/main/kotlin/core/A.kt', 'src/main/kotlin/core/B.kt'],
		});

		expectExactly(findings, ['src/main/kotlin/core/B.kt']);
	});

	it('derives the universe from evidence, not from the declared language label', () => {
		const asCpp = scan(caseOneFixture('cpp'));
		const asJava = scan(caseOneFixture('java'));

		expectExactly(asJava, ['src/core/extra.cpp', 'src/core/util.h']);
		expect(reported(asJava), said(asJava)).toEqual(reported(asCpp));
	});

	it('reports nothing once every scanned file is claimed by some feature', () => {
		const findings = scan({
			language: 'cpp',
			layers: [...CASE_1_TREE.layers],
			claims: [['src/core/rasp.cpp'], ['src/core/extra.cpp'], ['src/core/util.h']],
			files: [...CASE_1_TREE.files],
		});

		expectExactly(findings, []);
		expect(findings, said(findings)).toHaveLength(0);
	});

	it('unions every observed known extension into one scan universe', () => {
		const findings = scan({
			language: 'cpp',
			layers: ['core'],
			claims: [['src/core/a.cpp']],
			files: ['src/core/a.cpp', 'src/core/b.h', 'src/core/c.ts'],
		});

		expectExactly(findings, ['src/core/b.h', 'src/core/c.ts']);
	});

	it('raises each unmapped artifact at the declared severity', () => {
		const findings = scan(caseOneFixture('cpp'));

		expect(findings.length, said(findings)).toBeGreaterThan(0);
		for (const finding of findings) {
			expect(finding.severity, said(findings)).toBe('error');
		}
	});
});
