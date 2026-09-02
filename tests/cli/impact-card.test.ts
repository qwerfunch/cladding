import {describe, test, expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {formatImpactCard, editMagnitude} from '../../src/cli/hook.js';
import type {ImpactSlice} from '../../src/optimizer/reverse-slice.js';

describe('impact card', () => {
  test('[covers:F-d6b93648/AC-ee0f17] formatImpactCard renders owner, breaks, and tests for a touched file', () => {
    const slice: ImpactSlice = {
      focus: {id: 'F-abc123', title: 'Login'},
      impacted: [
        {id: 'F-one', title: 'One'},
        {id: 'F-two', title: 'Two'},
      ],
      impacted_modules: [],
      scenarios: [],
      test_refs: ['t1', 't2', 't3'],
    };

    const card = formatImpactCard(slice, 'src/login.ts');
    expect(card).not.toBe('');
    expect(card).toContain('cladding impact:');
    expect(card).toContain('src/login.ts');
    expect(card).toContain('F-abc123 Login'); // focus id + title (F-f46d5c61)
    expect(card).toContain('2 features depend on this');
    expect(card).toContain('3 tests guard it');
    // The count alone never said WHAT to run, so the fallback card names up to two paths.
    const lines = card.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('run: t1, t2 (+1 more)');
    expect(card.length).toBeLessThanOrEqual(600);

    const moduleSlice: ImpactSlice = {
      focus: {module: 'src/x.ts', owners: ['F-aaa', 'F-bbb']},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
    };

    const moduleCard = formatImpactCard(moduleSlice, 'src/x.ts');
    expect(moduleCard).not.toBe('');
    expect(moduleCard).toContain('F-aaa');
    expect(moduleCard).toContain('co-owner');
    expect(moduleCard.split('\n')).toHaveLength(1); // no regression set → the original one-liner

    // Two or fewer paths name themselves with no "+N more" tail, and a very long set is
    // still clipped to the 600-char ceiling rather than flooding the transcript.
    const two = formatImpactCard({...slice, test_refs: ['t1', 't2']}, 'src/login.ts');
    expect(two.split('\n')[1]).toBe('run: t1, t2');
    const long = formatImpactCard(
      {...slice, test_refs: [`tests/${'a'.repeat(400)}.test.ts`, `tests/${'b'.repeat(400)}.test.ts`]},
      'src/login.ts',
    );
    expect(long.length).toBe(600);
    expect(long.endsWith('…')).toBe(true);
  });

  test('[covers:F-d6b93648/AC-ee0f17] formatImpactCard is empty when the file touches no feature', () => {
    const slice: ImpactSlice = {
      focus: {module: 'src/x.ts'},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
    };

    expect(formatImpactCard(slice, 'src/x.ts')).toBe('');
  });

  test('[covers:F-c6a32fff/AC-10b1a2f8] a blank ledger discloses itself; a dense ledger does not; the empty-card path stays empty (F-c6a32fff)', () => {
    const blank: ImpactSlice = {
      focus: {module: 'src/x.ts', owners: ['F-aaa']},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
      ledger: {depends_on_edges: 0, test_ref_edges: 0},
    };
    const blankCard = formatImpactCard(blank, 'src/x.ts');
    expect(blankCard).toContain('· dependency map not yet recorded'); // empty breaks/tests ≠ verified safe
    expect(blankCard.split('\n')).toHaveLength(1); // stays a one-line card

    const dense: ImpactSlice = {
      focus: {module: 'src/x.ts', owners: ['F-aaa']},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
      ledger: {depends_on_edges: 246, test_ref_edges: 316},
    };
    expect(formatImpactCard(dense, 'src/x.ts')).not.toContain('dependency map'); // verified leaf, no noise

    // ownerless slice: the '' contract survives even with a blank ledger.
    const ownerless: ImpactSlice = {
      focus: {module: 'src/x.ts'},
      impacted: [],
      impacted_modules: [],
      scenarios: [],
      test_refs: [],
      ledger: {depends_on_edges: 0, test_ref_edges: 0},
    };
    expect(formatImpactCard(ownerless, 'src/x.ts')).toBe('');
  });

  test('[covers:F-d6b93648/AC-e49483] editMagnitude measures Edit, Write, and MultiEdit changed-char size', () => {
    expect(editMagnitude({content: 'abcde'})).toBe(5);
    expect(editMagnitude({new_string: 'abc'})).toBe(3);
    expect(
      editMagnitude({edits: [{new_string: 'ab'}, {new_string: 'cde'}]}),
    ).toBe(5);
    expect(editMagnitude({})).toBe(0);
  });

  test('[covers:F-d6b93648/AC-a42705] ai_hints and the developer persona steer agents to the working-set tools', () => {
    const specText = readFileSync('spec.yaml', 'utf8');
    expect(specText).toContain('clad_get_working_set');

    const developerText = readFileSync('src/agents/developer.md', 'utf8');
    expect(developerText).toContain('clad_get_working_set');
  });
});
